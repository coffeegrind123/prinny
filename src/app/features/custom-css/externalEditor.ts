/**
 * "Edit in your text editor" - one entry point, four platform backends.
 *
 *   Tauri desktop   Rust writes the file to the app data dir, opens it with the
 *                   OS default editor, and watches it; every save arrives as a
 *                   `custom-css-changed` event and is imported immediately.
 *   Android         Kotlin writes it to app-private storage, shares it to an
 *                   editor through the FileProvider with ACTION_EDIT, and reads
 *                   it back when the editor returns. Export/Import through the
 *                   system file picker covers editors that do not write back.
 *   Chromium web    File System Access: the user picks where to save, and the
 *                   page keeps the handle and polls it, so saves apply live.
 *   Other browsers  Download, then upload the edited file.
 */
import { isTauri } from '../../utils/desktop-notifications';
import { getTauriPlatform } from '../../utils/platform';
import { buildEditableFile, importEditedFile, ImportResult } from './customCssStore';

export enum EditorBackend {
  TauriDesktop = 'tauri-desktop',
  Android = 'android',
  FileSystemAccess = 'file-system-access',
  Download = 'download',
}

export const FILE_NAME = 'prinny.css';

/** Upper bound on an imported file; the full stylesheet is ~0.3 MB. */
export const MAX_FILE_BYTES = 8 * 1024 * 1024;

const DESKTOP_CHANGED_EVENT = 'custom-css-changed';
const ANDROID_PLUGIN = 'plugin:custom-css-editor';

// How often the web backend checks the picked file for a save.
const POLL_INTERVAL_MS = 1000;

// File System Access is not in TypeScript's DOM lib (it is a WICG spec).
type FileHandle = {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
};
type SaveFilePicker = (options: {
  suggestedName: string;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<FileHandle>;

const saveFilePicker = (): SaveFilePicker | undefined =>
  (window as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;

export const detectBackend = async (): Promise<EditorBackend> => {
  if (isTauri()) {
    const platform = await getTauriPlatform();
    if (platform === 'android') {
      return EditorBackend.Android;
    }
    if (platform === 'windows' || platform === 'macos' || platform === 'linux') {
      return EditorBackend.TauriDesktop;
    }
  }
  if (saveFilePicker() && window.isSecureContext) {
    return EditorBackend.FileSystemAccess;
  }
  return EditorBackend.Download;
};

// ---------------------------------------------------------------------------
// Session: which file is currently being watched, for the settings UI
// ---------------------------------------------------------------------------

export type EditSession = {
  backend: EditorBackend;
  /** Where the file is, for display: a path on desktop, a name on the web. */
  location: string;
  lastImport?: ImportResult & { at: number };
  error?: string;
};

let session: EditSession | undefined;
const sessionListeners = new Set<() => void>();

const setSession = (next: EditSession | undefined) => {
  session = next;
  sessionListeners.forEach((listener) => listener());
};

export const getEditSession = (): EditSession | undefined => session;

export const subscribeEditSession = (listener: () => void): (() => void) => {
  sessionListeners.add(listener);
  return () => {
    sessionListeners.delete(listener);
  };
};

const recordImport = async (text: string) => {
  try {
    const result = await importEditedFile(text);
    if (session) {
      setSession({ ...session, lastImport: { ...result, at: Date.now() }, error: undefined });
    }
    return result;
  } catch (err) {
    if (session) {
      setSession({ ...session, error: err instanceof Error ? err.message : String(err) });
    }
    throw err;
  }
};

// ---------------------------------------------------------------------------
// Tauri desktop
// ---------------------------------------------------------------------------

type DesktopChange = { content: string };

let desktopListening = false;

/**
 * Listens for saves from the desktop editor for the life of the page, so edits
 * apply with the settings screen closed too. Safe to call more than once.
 */
export const listenForDesktopEdits = async () => {
  if (desktopListening || !isTauri()) {
    return;
  }
  desktopListening = true;
  const { listen } = await import('@tauri-apps/api/event');
  await listen<DesktopChange>(DESKTOP_CHANGED_EVENT, (evt) => {
    if (typeof evt.payload?.content !== 'string') {
      console.warn('[custom-css] ignoring malformed change event', typeof evt.payload);
      return;
    }
    recordImport(evt.payload.content).catch((err) => {
      console.error('[custom-css] importing the saved file failed:', err);
    });
  });
};

const editOnDesktop = async (content: string) => {
  const { invoke } = await import('@tauri-apps/api/core');
  await listenForDesktopEdits();
  const path = await invoke<string>('custom_css_edit', { content });
  setSession({ backend: EditorBackend.TauriDesktop, location: path });
};

// ---------------------------------------------------------------------------
// Android
// ---------------------------------------------------------------------------

type AndroidFile = { content: string };

const androidInvoke = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(`${ANDROID_PLUGIN}|${command}`, args);
};

const editOnAndroid = async (content: string) => {
  setSession({ backend: EditorBackend.Android, location: FILE_NAME });
  // Resolves when the user comes back from the editor.
  const edited = await androidInvoke<AndroidFile>('edit', { content });
  await recordImport(edited.content);
};

/** Android: reads back the last file handed to an editor, e.g. after the app was killed meanwhile. */
export const reloadAndroidFile = async (): Promise<ImportResult> => {
  const edited = await androidInvoke<AndroidFile>('read_file');
  return importEditedFile(edited.content);
};

// ---------------------------------------------------------------------------
// Web: File System Access
// ---------------------------------------------------------------------------

let pollTimer: number | undefined;

const stopPolling = () => {
  if (pollTimer !== undefined) {
    window.clearInterval(pollTimer);
    pollTimer = undefined;
  }
};

const editWithFileSystemAccess = async (content: string) => {
  const picker = saveFilePicker();
  if (!picker) {
    throw new Error('This browser cannot save files directly.');
  }
  const handle = await picker({
    suggestedName: FILE_NAME,
    types: [{ description: 'CSS stylesheet', accept: { 'text/css': ['.css'] } }],
  });

  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();

  stopPolling();
  let lastModified = (await handle.getFile()).lastModified;
  setSession({ backend: EditorBackend.FileSystemAccess, location: handle.name });

  let checking = false;
  pollTimer = window.setInterval(() => {
    if (checking) {
      return;
    }
    checking = true;
    handle
      .getFile()
      .then(async (file) => {
        if (file.lastModified === lastModified) {
          return;
        }
        lastModified = file.lastModified;
        if (file.size > MAX_FILE_BYTES) {
          throw new Error(`${file.name} is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB.`);
        }
        await recordImport(await file.text());
      })
      .catch((err) => {
        // Permission revoked or the file was moved: stop quietly, say why.
        stopPolling();
        if (session) {
          setSession({ ...session, error: err instanceof Error ? err.message : String(err) });
        }
      })
      .finally(() => {
        checking = false;
      });
  }, POLL_INTERVAL_MS);
};

// ---------------------------------------------------------------------------
// Web: download / upload
// ---------------------------------------------------------------------------

export const downloadFile = (content: string) => {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/css' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = FILE_NAME;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on the next tick: revoking synchronously can cancel the download.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const startExternalEdit = async (backend: EditorBackend): Promise<void> => {
  const content = await buildEditableFile();

  switch (backend) {
    case EditorBackend.TauriDesktop:
      return editOnDesktop(content);
    case EditorBackend.Android:
      return editOnAndroid(content);
    case EditorBackend.FileSystemAccess:
      return editWithFileSystemAccess(content);
    case EditorBackend.Download:
      downloadFile(content);
      return undefined;
    default:
      throw new Error(`Unknown editor backend: ${backend satisfies never}`);
  }
};

export const stopExternalEdit = async () => {
  const current = session;
  stopPolling();
  setSession(undefined);
  if (current?.backend === EditorBackend.TauriDesktop) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('custom_css_stop');
  }
};

/** Export through the platform's own save flow (the system file picker on Android). */
export const exportFile = async (backend: EditorBackend) => {
  const content = await buildEditableFile();
  if (backend === EditorBackend.Android) {
    await androidInvoke('export_file', { content, fileName: FILE_NAME });
    return;
  }
  downloadFile(content);
};

/** Android: pick a file with the system picker and import it. */
export const importAndroidFile = async (): Promise<ImportResult> => {
  const picked = await androidInvoke<AndroidFile>('import_file');
  return importEditedFile(picked.content);
};

/** Web / desktop: import a file the user picked with an <input type="file">. */
export const importPickedFile = async (file: File): Promise<ImportResult> => {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`${file.name} is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB.`);
  }
  return importEditedFile(await file.text());
};

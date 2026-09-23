import {
  ChangeEventHandler,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import { Box, Button, color, config, Spinner, Text, TextArea } from 'folds';
import { SequenceCard } from '../../components/sequence-card';
import { SettingTile } from '../../components/setting-tile';
import { SequenceCardStyle } from '../settings/styles.css';
import { AsyncState, AsyncStatus, useAsyncCallback } from '../../hooks/useAsyncCallback';
import { useFilePicker } from '../../hooks/useFilePicker';
import {
  getCustomCssState,
  ImportResult,
  overrideCount,
  resetFileEdits,
  saveSnippets,
  subscribeCustomCss,
} from './customCssStore';
import {
  detectBackend,
  EditorBackend,
  exportFile,
  getEditSession,
  importAndroidFile,
  importPickedFile,
  reloadAndroidFile,
  startExternalEdit,
  stopExternalEdit,
  subscribeEditSession,
} from './externalEditor';

const CSS_ACCEPT = '.css,text/css,text/plain';

const SNIPPET_PLACEHOLDER = `/* Applied after everything else, e.g. */
.RoomViewHeader_HeaderTopic {
  color: tomato;
}`;

const MONOSPACE = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' };

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

// The file picker and Android's pickers reject on cancel; that is not an error to show.
const isCancel = (error: unknown): boolean => /cancel|abort/i.test(errorText(error));

// useAsyncCallback records the failure in its state (shown by ErrorLine) and
// also rethrows; this swallows the rethrow so it is not an unhandled rejection.
const shownInState = () => undefined;

const pluralChanges = (n: number) => `${n} ${n === 1 ? 'change' : 'changes'}`;

function ErrorLine({ state }: { state: AsyncState<unknown, unknown> }) {
  if (state.status !== AsyncStatus.Error || isCancel(state.error)) {
    return null;
  }
  return (
    <Text size="T200" style={{ color: color.Critical.Main }}>
      {errorText(state.error)}
    </Text>
  );
}

const EDIT_LABEL: Record<EditorBackend, string> = {
  [EditorBackend.TauriDesktop]: 'Edit in Text Editor',
  [EditorBackend.Android]: 'Edit in Text Editor',
  [EditorBackend.FileSystemAccess]: 'Edit in Text Editor',
  [EditorBackend.Download]: 'Download CSS File',
};

const EDIT_DESCRIPTION: Record<EditorBackend, string> = {
  [EditorBackend.TauriDesktop]:
    "Opens Prinny's full stylesheet in your default editor. Every save applies immediately.",
  [EditorBackend.Android]:
    "Opens Prinny's full stylesheet in an editor app; changes apply when you come back. If your editor saves a copy instead, use Export and Import.",
  [EditorBackend.FileSystemAccess]:
    "Saves Prinny's full stylesheet where you choose, then applies it every time you save that file.",
  [EditorBackend.Download]:
    "Downloads Prinny's full stylesheet. Edit it in any editor, then import it back.",
};

function FileEditing() {
  const { overrides } = useSyncExternalStore(subscribeCustomCss, getCustomCssState);
  const session = useSyncExternalStore(subscribeEditSession, getEditSession);
  const [backend, setBackend] = useState<EditorBackend>();
  const [lastImport, setLastImport] = useState<ImportResult>();

  useEffect(() => {
    let live = true;
    detectBackend().then((detected) => {
      if (live) {
        setBackend(detected);
      }
    });
    return () => {
      live = false;
    };
  }, []);

  const changes = useMemo(() => overrideCount(overrides), [overrides]);

  const [editState, edit] = useAsyncCallback(
    useCallback(async () => {
      if (backend) {
        await startExternalEdit(backend);
      }
    }, [backend]),
  );

  const [exportState, runExport] = useAsyncCallback(
    useCallback(async () => {
      if (backend) {
        await exportFile(backend);
      }
    }, [backend]),
  );

  const [importState, runImport] = useAsyncCallback(
    useCallback(async (read: () => Promise<ImportResult>) => {
      const result = await read();
      setLastImport(result);
      return result;
    }, []),
  );

  const pickFile = useFilePicker(
    useCallback(
      (file: File) => {
        runImport(() => importPickedFile(file)).catch(shownInState);
      },
      [runImport],
    ),
  );

  const handleImport = () => {
    if (backend === EditorBackend.Android) {
      runImport(importAndroidFile).catch(shownInState);
      return;
    }
    pickFile(CSS_ACCEPT);
  };

  const busy = editState.status === AsyncStatus.Loading;
  const watching = session && session.backend !== EditorBackend.Android;
  const shownImport = session?.lastImport ?? lastImport;

  if (!backend) {
    return null;
  }

  return (
    <SequenceCard
      className={SequenceCardStyle}
      variant="SurfaceVariant"
      direction="Column"
      gap="400"
    >
      <SettingTile
        title="Full Stylesheet"
        description={EDIT_DESCRIPTION[backend]}
        after={
          <Button
            size="300"
            radii="300"
            variant="Primary"
            onClick={() => edit().catch(shownInState)}
            disabled={busy}
            before={busy && <Spinner size="100" variant="Primary" fill="Solid" />}
          >
            <Text size="B300">{EDIT_LABEL[backend]}</Text>
          </Button>
        }
      />
      <ErrorLine state={editState} />

      {watching && (
        <Box direction="Column" gap="100">
          <Text size="T200" priority="300" style={{ wordBreak: 'break-all' }}>
            Watching <code>{session.location}</code>
          </Text>
          <Box>
            <Button
              size="300"
              radii="300"
              variant="Secondary"
              fill="Soft"
              onClick={() => {
                stopExternalEdit().catch((err) => {
                  console.error('[custom-css] stopping the watcher failed:', err);
                });
              }}
            >
              <Text size="B300">Stop Watching</Text>
            </Button>
          </Box>
        </Box>
      )}
      {session?.error && (
        <Text size="T200" style={{ color: color.Critical.Main }}>
          {session.error}
        </Text>
      )}

      <Box gap="200" wrap="Wrap">
        <Button
          size="300"
          radii="300"
          variant="Secondary"
          fill="Soft"
          onClick={() => runExport().catch(shownInState)}
          disabled={exportState.status === AsyncStatus.Loading}
        >
          <Text size="B300">Export File</Text>
        </Button>
        <Button
          size="300"
          radii="300"
          variant="Secondary"
          fill="Soft"
          onClick={handleImport}
          disabled={importState.status === AsyncStatus.Loading}
        >
          <Text size="B300">Import File</Text>
        </Button>
        {backend === EditorBackend.Android && (
          <Button
            size="300"
            radii="300"
            variant="Secondary"
            fill="Soft"
            onClick={() => runImport(reloadAndroidFile).catch(shownInState)}
            disabled={importState.status === AsyncStatus.Loading}
          >
            <Text size="B300">Reload Last Edit</Text>
          </Button>
        )}
      </Box>
      <ErrorLine state={exportState} />
      <ErrorLine state={importState} />

      <SettingTile
        title={changes > 0 ? `${pluralChanges(changes)} active` : 'No changes from the file'}
        description={
          shownImport
            ? `Last import: ${pluralChanges(shownImport.changes)} from the defaults.`
            : 'Only what differs from the defaults is kept, so Prinny updates still reach everything you did not change.'
        }
        after={
          changes > 0 && (
            <Button size="300" radii="300" variant="Critical" fill="Soft" onClick={resetFileEdits}>
              <Text size="B300">Reset</Text>
            </Button>
          )
        }
      />
    </SequenceCard>
  );
}

function Snippets() {
  const { snippets } = useSyncExternalStore(subscribeCustomCss, getCustomCssState);
  const [draft, setDraft] = useState(snippets);
  const [error, setError] = useState<string>();

  // Follow external changes (another tab) unless the user is mid-edit.
  const [synced, setSynced] = useState(snippets);
  if (snippets !== synced) {
    setSynced(snippets);
    if (draft === synced) {
      setDraft(snippets);
    }
  }

  const handleChange: ChangeEventHandler<HTMLTextAreaElement> = (evt) => setDraft(evt.target.value);

  const save = (value: string) => {
    try {
      saveSnippets(value);
      setError(undefined);
    } catch (err) {
      setError(errorText(err));
    }
  };

  const dirty = draft !== snippets;

  return (
    <SequenceCard
      className={SequenceCardStyle}
      variant="SurfaceVariant"
      direction="Column"
      gap="300"
    >
      <SettingTile
        title="Snippets"
        description="Small CSS applied after everything else, including your stylesheet edits."
      />
      <TextArea
        value={draft}
        onChange={handleChange}
        placeholder={SNIPPET_PLACEHOLDER}
        variant="Secondary"
        radii="300"
        rows={6}
        spellCheck={false}
        style={{ ...MONOSPACE, fontSize: config.fontSize.T200 }}
      />
      {error && (
        <Text size="T200" style={{ color: color.Critical.Main }}>
          {error}
        </Text>
      )}
      <Box gap="200">
        <Button
          size="300"
          radii="300"
          variant="Success"
          onClick={() => save(draft)}
          disabled={!dirty}
        >
          <Text size="B300">Save</Text>
        </Button>
        <Button
          size="300"
          radii="300"
          variant="Secondary"
          fill="Soft"
          onClick={() => setDraft(snippets)}
          disabled={!dirty}
        >
          <Text size="B300">Revert</Text>
        </Button>
        <Button
          size="300"
          radii="300"
          variant="Critical"
          fill="Soft"
          onClick={() => {
            setDraft('');
            save('');
          }}
          disabled={!snippets && !draft}
        >
          <Text size="B300">Clear</Text>
        </Button>
      </Box>
    </SequenceCard>
  );
}

export function CustomCssSettings() {
  return (
    <Box direction="Column" gap="100">
      <Text size="L400">Custom CSS</Text>
      <FileEditing />
      <Snippets />
    </Box>
  );
}

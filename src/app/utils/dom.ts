export const targetFromEvent = (evt: Event, selector: string): Element | undefined => {
  const targets = evt.composedPath() as Element[];
  return targets.find((target) => target.matches?.(selector));
};

export const editableActiveElement = (): boolean =>
  !!document.activeElement &&
  (document.activeElement.nodeName.toLowerCase() === 'input' ||
    document.activeElement.nodeName.toLowerCase() === 'textarea' ||
    document.activeElement.getAttribute('contenteditable') === 'true' ||
    document.activeElement.getAttribute('role') === 'input' ||
    document.activeElement.getAttribute('role') === 'textarea');

export const isIntersectingScrollView = (
  scrollElement: HTMLElement,
  childElement: HTMLElement,
): boolean => {
  const scrollTop = scrollElement.offsetTop + scrollElement.scrollTop;
  const scrollBottom = scrollTop + scrollElement.offsetHeight;

  const childTop = childElement.offsetTop;
  const childBottom = childTop + childElement.clientHeight;

  if (childTop >= scrollTop && childTop < scrollBottom) return true;
  if (childBottom > scrollTop && childBottom <= scrollBottom) return true;
  if (childTop < scrollTop && childBottom > scrollBottom) return true;
  return false;
};

export const isInScrollView = (scrollElement: HTMLElement, childElement: HTMLElement): boolean => {
  const scrollTop = scrollElement.offsetTop + scrollElement.scrollTop;
  const scrollBottom = scrollTop + scrollElement.offsetHeight;
  return (
    childElement.offsetTop >= scrollTop &&
    childElement.offsetTop + childElement.offsetHeight <= scrollBottom
  );
};

export const canFitInScrollView = (
  scrollElement: HTMLElement,
  childElement: HTMLElement,
): boolean => childElement.offsetHeight < scrollElement.offsetHeight;

export type FilesOrFile<T extends boolean | undefined = undefined> = T extends true ? File[] : File;

export const getFilesFromFileList = (fileList: FileList): File[] => {
  const files: File[] = [];

  for (let i = 0; i < fileList.length; i += 1) {
    const file: File | undefined = fileList[i];
    if (file instanceof File) files.push(file);
  }

  return files;
};

// `accept` must be a valid MIME pattern. A bare `*` is not one; `*/*` is.
//
// Browsers ignore an unparseable `accept` entry, so a bare `*` behaves fine on
// web and desktop. Android does not have that luxury: the WebView hands
// `acceptTypes` to `FileChooserParams.createIntent()`, which sets it as the
// intent's MIME type. A bare `*` matches no intent filter, so no activity
// resolves, wry's `onShowFileChooser` catches the ActivityNotFoundException and
// calls back with null — the picker simply never appears. Tapping attach on
// Android did nothing at all, and reported no error anywhere.
const normalizeAccept = (accept: string): string => (accept === '*' ? '*/*' : accept);

export const selectFile = <M extends boolean | undefined = undefined>(
  accept: string,
  multiple?: M,
): Promise<FilesOrFile<M> | undefined> =>
  new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (accept) input.accept = normalizeAccept(accept);
    if (multiple) input.multiple = true;

    const changeHandler = () => {
      const fileList = input.files;
      if (!fileList) {
        resolve(undefined);
      } else {
        const files: File[] = getFilesFromFileList(fileList);
        resolve((multiple ? files : files[0]) as FilesOrFile<M>);
      }
      input.removeEventListener('change', changeHandler);
    };

    input.addEventListener('change', changeHandler);
    input.click();
  });

export const getDataTransferFiles = (dataTransfer: DataTransfer): File[] | undefined => {
  const fileList = dataTransfer.files;
  const files: File[] = getFilesFromFileList(fileList);
  if (files.length === 0) return undefined;
  return files;
};

export const renameFile = (file: File, name: string): File =>
  new File([file], name, { type: file.type });

export const getImageUrlBlob = async (url: string) => {
  const res = await fetch(url);
  const blob = await res.blob();
  return blob;
};

export const getImageFileUrl = (fileOrBlob: File | Blob) => URL.createObjectURL(fileOrBlob);

export const getVideoFileUrl = (fileOrBlob: File | Blob) => URL.createObjectURL(fileOrBlob);

export const loadImageElement = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = document.createElement('img');
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = url;
  });

export const loadVideoElement = (url: string): Promise<HTMLVideoElement> =>
  new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.playsInline = true;
    video.muted = true;

    video.onloadeddata = () => {
      resolve(video);
      video.pause();
    };
    video.onerror = (e) => {
      reject(e);
    };

    video.src = url;
    video.load();
    video.play();
  });

export const getThumbnailDimensions = (width: number, height: number): [number, number] => {
  const MAX_WIDTH = 400;
  const MAX_HEIGHT = 300;
  let targetWidth = width;
  let targetHeight = height;
  if (targetHeight > MAX_HEIGHT) {
    targetWidth = Math.floor(targetWidth * (MAX_HEIGHT / targetHeight));
    targetHeight = MAX_HEIGHT;
  }
  if (targetWidth > MAX_WIDTH) {
    targetHeight = Math.floor(targetHeight * (MAX_WIDTH / targetWidth));
    targetWidth = MAX_WIDTH;
  }
  return [targetWidth, targetHeight];
};

export const getThumbnail = (
  img: HTMLImageElement | SVGImageElement | HTMLVideoElement,
  width: number,
  height: number,
  thumbnailMimeType?: string,
): Promise<Blob | undefined> =>
  new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      resolve(undefined);
      return;
    }
    context.drawImage(img, 0, 0, width, height);

    canvas.toBlob((thumbnail) => {
      resolve(thumbnail ?? undefined);
    }, thumbnailMimeType ?? 'image/jpeg');
  });

export type ScrollInfo = {
  offsetTop: number;
  top: number;
  height: number;
  viewHeight: number;
  scrollable: boolean;
};
export const getScrollInfo = (target: HTMLElement): ScrollInfo => ({
  offsetTop: Math.round(target.offsetTop),
  top: Math.round(target.scrollTop),
  height: Math.round(target.scrollHeight),
  viewHeight: Math.round(target.offsetHeight),
  scrollable: target.scrollHeight > target.offsetHeight,
});

export const scrollToBottom = (scrollEl: HTMLElement, behavior?: 'auto' | 'instant' | 'smooth') => {
  scrollEl.scrollTo({
    top: Math.round(scrollEl.scrollHeight - scrollEl.offsetHeight),
    behavior,
  });
};

/**
 * The pre-Clipboard-API path: put the text in an off-screen field, select it,
 * and let `execCommand` copy the selection.
 *
 * A TEXTAREA, not an input. `HTMLInputElement.value` runs the "value sanitization
 * algorithm", which STRIPS every CR and LF from the string — so copying a
 * multi-line code block through an `<input>` silently produced a single line
 * with the newlines gone, and the paste looked like the message itself had
 * been flattened. A textarea holds line breaks.
 *
 * The selection is saved and restored because `select()` replaces whatever the
 * user had highlighted, and copying a message should not clear the text they
 * were part-way through selecting.
 */
const legacyCopyToClipboard = (text: string): boolean => {
  const field = document.createElement('textarea');
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.top = '0';
  field.style.opacity = '0';
  field.style.pointerEvents = 'none';
  field.value = text;
  document.body.append(field);

  const selection = document.getSelection();
  const previous = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : undefined;

  field.select();
  // `text.length`, not a fixed 99999: a long code block would otherwise be
  // copied truncated, which is worse than not copying it.
  field.setSelectionRange(0, text.length);

  let copied: boolean;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }

  field.remove();
  if (selection && previous) {
    selection.removeAllRanges();
    selection.addRange(previous);
  }
  return copied;
};

/**
 * Copies text, and says whether it worked.
 *
 * `navigator.clipboard.writeText` returns a promise that REJECTS when the
 * document is not focused, when the permission is refused, or in an insecure
 * context. The old code neither awaited nor caught it, so every one of those
 * failures was silent — the caller still showed "Copied", and the clipboard
 * still held whatever was in it before. A copy that quietly does nothing while
 * claiming success is worse than one that fails visibly, because the next
 * paste produces stale content and nothing points at the copy as the cause.
 *
 * The legacy path is kept as a fallback rather than an alternative: it runs
 * when the modern one is missing AND when it rejects, which is the case that
 * actually bites inside a WebView.
 */
export const copyToClipboard = async (text: string): Promise<boolean> => {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through — the legacy path does not need focus or a permission.
    }
  }
  return legacyCopyToClipboard(text);
};

export const setFavicon = (url: string): void => {
  const favicon = document.querySelector('#favicon');
  if (!favicon) return;
  favicon.setAttribute('href', url);
};

export const tryDecodeURIComponent = (encodedURIComponent: string): string => {
  try {
    return decodeURIComponent(encodedURIComponent);
  } catch {
    return encodedURIComponent;
  }
};

export const syntaxErrorPosition = (error: SyntaxError): number | undefined => {
  const match = error.message.match(/position\s(\d+)\s/);
  if (!match) return undefined;

  const posStr = match[1];
  const position = parseInt(posStr, 10);
  if (Number.isNaN(position)) return undefined;
  return position;
};

export const notificationPermission = (permission: NotificationPermission) => {
  if ('Notification' in window) {
    return window.Notification.permission === permission;
  }
  try {
    // https://stackoverflow.com/questions/29774836/failed-to-construct-notification-illegal-constructor
    // https://issues.chromium.org/issues/40415865
    // eslint-disable-next-line no-new
    new Notification('');
  } catch {
    return false;
  }
  return true;
};

export const getMouseEventCords = (event: MouseEvent) => ({
  x: event.clientX,
  y: event.clientY,
  width: 0,
  height: 0,
});

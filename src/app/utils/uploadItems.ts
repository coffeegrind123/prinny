import { Room } from 'matrix-js-sdk';
import { TUploadItem } from '../state/room/roomInputDrafts';
import { encryptFile } from './matrix';
import { safeFile } from './mimeTypes';
import { fulfilledPromiseSettledResult } from './common';

/**
 * Turns picked/dropped/pasted/shared files into composer attachment items,
 * encrypting them first when the destination room is encrypted.
 *
 * Shared by every path that puts a file into a composer — the paperclip
 * button, drag-and-drop, paste, and the Android share sheet — so that the
 * encryption decision cannot be made in one place and forgotten in another.
 * Getting that wrong in a new caller would upload plaintext into an encrypted
 * room, which is not a failure anything downstream would report.
 *
 * `safeFile` first: the MIME type a picker (or another Android app) attaches to
 * a file is not trustworthy, and it is what decides how the file renders for
 * everyone in the room.
 *
 * A file whose encryption rejects is dropped rather than sent in the clear —
 * that is what `fulfilledPromiseSettledResult` is doing here.
 */
export const filesToUploadItems = async (room: Room, files: File[]): Promise<TUploadItem[]> => {
  const safeFiles = files.map(safeFile);

  if (room.hasEncryptionStateEvent()) {
    const encryptedFiles = fulfilledPromiseSettledResult(
      await Promise.allSettled(safeFiles.map((f) => encryptFile(f))),
    );
    return encryptedFiles.map((ef) => ({
      ...ef,
      metadata: {
        markedAsSpoiler: false,
      },
    }));
  }

  return safeFiles.map((f) => ({
    file: f,
    originalFile: f,
    encInfo: undefined,
    metadata: {
      markedAsSpoiler: false,
    },
  }));
};

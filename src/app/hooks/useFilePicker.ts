import { useCallback } from 'react';
import { selectFile } from '../utils/dom';
import { stripMetadata } from '../utils/stripMetadata';

export const useFilePicker = <M extends boolean | undefined = undefined>(
  onSelect: (file: M extends true ? File[] : File) => void,
  multiple?: M,
) =>
  useCallback(
    async (accept: string) => {
      const file = await selectFile(accept, multiple);
      if (!file) return;
      // Avatars, room icons and pack images are picked here and uploaded
      // without passing through the composer, so their metadata goes here.
      const clean = Array.isArray(file)
        ? await Promise.all(file.map(stripMetadata))
        : await stripMetadata(file);
      onSelect(clean as M extends true ? File[] : File);
    },
    [multiple, onSelect],
  );

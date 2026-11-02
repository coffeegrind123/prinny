import { useMemo, useSyncExternalStore } from 'react';
import { useMatrixClient } from './useMatrixClient';
import {
  NotesState,
  ProfileNotesService,
  getProfileNotesService,
} from '../utils/profileNotesService';
import { NoteText, readNote } from '../utils/profileNotes';

export type ProfileNote = {
  state: NotesState;
  /** The note on this user, when notes are readable and one exists. */
  note: NoteText | undefined;
  service: ProfileNotesService;
};

export const useProfileNote = (userId: string): ProfileNote => {
  const mx = useMatrixClient();
  const service = getProfileNotesService(mx);
  const state = useSyncExternalStore(service.subscribe, service.getState);

  const note = useMemo(
    () => (state.kind === 'ready' ? readNote(state.annotations, userId) : undefined),
    [state, userId],
  );

  return { state, note, service };
};

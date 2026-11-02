import {
  KeyboardEventHandler,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import parse from 'html-react-parser';
import { Box, Button, Icon, Icons, Spinner, Text, TextArea, color, config } from 'folds';
import * as css from './styles.css';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { useProfileNote } from '../../hooks/useProfileNotes';
import {
  useSecretStorageDefaultKeyId,
  useSecretStorageKeyContent,
} from '../../hooks/useSecretStorage';
import { parseBlockMD, parseInlineMD } from '../../plugins/markdown';
import { LINKIFY_OPTS, getReactCustomHtmlParser } from '../../plugins/react-custom-html-parser';
import { sanitizeCustomHtml, sanitizeText } from '../../utils/sanitize';
import { NOTE_MAX_LENGTH, NoteText } from '../../utils/profileNotes';
import {
  LostReason,
  NeedsRecoveryKeyError,
  ProfileNotesService,
} from '../../utils/profileNotesService';
import { errorMessage } from '../../utils/errorMessage';
import { SecretStorageRecoveryKey, SecretStorageRecoveryPassphrase } from '../SecretStorage';

/** Marks the note editor so the profile popout's focus trap leaves Escape to it. */
const NOTE_EDITOR_ATTR = 'data-profile-note-editor';

export const isProfileNoteEditor = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && target.hasAttribute(NOTE_EDITOR_ATTR);

/** Show the remaining-characters counter once this much of the limit is used. */
const COUNTER_THRESHOLD = 0.8;

const NOTE_MAX_HEIGHT = '12lh';

/**
 * The same markdown pass a biography gets. Escaping first means only markdown,
 * never raw HTML typed into the note, produces tags; a leading `>` is restored
 * so quotes still parse.
 */
const markdownToHtml = (plain: string): string =>
  parseBlockMD(sanitizeText(plain).replace(/^((?:\\)*)&gt;/gm, '$1>'), parseInlineMD);

/**
 * The HTML representation to store beside the typed text, or undefined when
 * the markdown pass changed nothing but line breaks (then plain text says it
 * all and other clients need not be handed HTML).
 */
export const noteHtml = (plain: string): string | undefined => {
  const html = markdownToHtml(plain);
  return html.replace(/<br\/>/g, '\n') === sanitizeText(plain) ? undefined : html;
};

/** Editable source for a note another client stored as HTML only. */
const htmlToText = (html: string): string => {
  const doc = new DOMParser().parseFromString(
    html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|blockquote|h\d)>/gi, '$&\n'),
    'text/html',
  );
  return (doc.body.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
};

const editableText = (note: NoteText | undefined): string => {
  if (!note) {
    return '';
  }
  if (note.plain !== undefined) {
    return note.plain;
  }
  return note.html ? htmlToText(note.html) : '';
};

function NoteContent({ note }: { note: NoteText }) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();

  const content = useMemo(() => {
    // A writer's HTML wins (MSC1767 order); it is sanitised like any message.
    const html = note.html ?? markdownToHtml(note.plain ?? '');
    return parse(
      sanitizeCustomHtml(html),
      getReactCustomHtmlParser(mx, undefined, { linkifyOpts: LINKIFY_OPTS, useAuthentication }),
    );
  }, [mx, note, useAuthentication]);

  return content;
}

const LOST_MESSAGES: Record<LostReason, string> = {
  [LostReason.NoAdk]:
    'Your notes were encrypted by another app whose key has not reached your secret storage yet. Open that app and enter your recovery key there, then come back.',
  [LostReason.StaleRecoveryKey]:
    'Your notes are encrypted with a key saved under a recovery key you have since replaced, so they can no longer be opened.',
  [LostReason.WrongAdk]:
    'Your notes are encrypted with a key that is not the one in your secret storage, so they cannot be opened.',
  [LostReason.NoSecretStorage]:
    'Your notes are encrypted, but this account has no secret storage to hold the key. Set up a recovery key in Settings → Devices, or start over.',
  [LostReason.Corrupt]: 'Your stored notes are damaged and cannot be read.',
};

function NoteUnlock({
  service,
  onUnlocked,
}: {
  service: ProfileNotesService;
  onUnlocked: () => void;
}) {
  const keyId = useSecretStorageDefaultKeyId();
  const keyContent = useSecretStorageKeyContent(keyId ?? '');
  const [usePassphrase, setUsePassphrase] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState<string>();

  const handleKey = useCallback(
    (recoveryKey: Uint8Array) => {
      setUnlocking(true);
      setError(undefined);
      service
        .unlock(recoveryKey)
        .then(onUnlocked)
        .catch((e) => setError(errorMessage(e)))
        .finally(() => setUnlocking(false));
    },
    [service, onUnlocked],
  );

  if (!keyId || !keyContent) {
    return (
      <Text size="T200" priority="300">
        Loading secret storage…
      </Text>
    );
  }

  return (
    <Box direction="Column" gap="200">
      {usePassphrase && keyContent.passphrase ? (
        <SecretStorageRecoveryPassphrase
          processing={unlocking}
          keyContent={keyContent}
          passphraseContent={keyContent.passphrase}
          onDecodedRecoveryKey={handleKey}
        />
      ) : (
        <SecretStorageRecoveryKey
          processing={unlocking}
          keyContent={keyContent}
          onDecodedRecoveryKey={handleKey}
        />
      )}
      {keyContent.passphrase && (
        <Text
          as="button"
          type="button"
          size="T200"
          priority="400"
          onClick={() => setUsePassphrase((p) => !p)}
          style={{
            alignSelf: 'flex-start',
            cursor: 'pointer',
            background: 'none',
            border: 'none',
            padding: 0,
            textDecoration: 'underline',
          }}
        >
          {usePassphrase ? 'Use recovery key instead' : 'Use recovery passphrase instead'}
        </Text>
      )}
      {error && (
        <Text size="T200" style={{ color: color.Critical.Main }}>
          <b>{error}</b>
        </Text>
      )}
    </Box>
  );
}

function NoteStartOver({ service, reason }: { service: ProfileNotesService; reason: LostReason }) {
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  const [needsKey, setNeedsKey] = useState(false);
  const [error, setError] = useState<string>();

  const startOver = useCallback(() => {
    setWorking(true);
    setError(undefined);
    service
      .startOver()
      .catch((e) => {
        if (e instanceof NeedsRecoveryKeyError) {
          setNeedsKey(true);
          return;
        }
        setError(errorMessage(e));
      })
      .finally(() => setWorking(false));
  }, [service]);

  return (
    <Box direction="Column" gap="200">
      <Text size="T200" priority="300">
        {LOST_MESSAGES[reason]}
      </Text>
      {needsKey && (
        <>
          <Text size="T200" priority="300">
            Enter your recovery key so the new notes key can be saved in your secret storage.
          </Text>
          <NoteUnlock
            service={service}
            onUnlocked={() => {
              setNeedsKey(false);
              startOver();
            }}
          />
        </>
      )}
      {!needsKey && reason !== LostReason.NoAdk && !confirming && (
        <Button
          size="300"
          variant="Critical"
          fill="Soft"
          radii="300"
          onClick={() => setConfirming(true)}
          style={{ alignSelf: 'flex-start' }}
        >
          <Text size="B300">Start over</Text>
        </Button>
      )}
      {!needsKey && confirming && (
        <Box direction="Column" gap="200">
          <Text size="T200" style={{ color: color.Critical.Main }}>
            This permanently deletes the notes you have on every user. Continue?
          </Text>
          <Box gap="200">
            <Button
              size="300"
              variant="Critical"
              radii="300"
              disabled={working}
              before={working && <Spinner size="100" variant="Critical" fill="Solid" />}
              onClick={startOver}
            >
              <Text size="B300">Delete and start over</Text>
            </Button>
            <Button
              size="300"
              variant="Secondary"
              fill="Soft"
              radii="300"
              disabled={working}
              onClick={() => setConfirming(false)}
            >
              <Text size="B300">Cancel</Text>
            </Button>
          </Box>
        </Box>
      )}
      {error && (
        <Text size="T200" style={{ color: color.Critical.Main }}>
          <b>{error}</b>
        </Text>
      )}
    </Box>
  );
}

type UserNoteProps = {
  userId: string;
};

/**
 * A private note on another user, like Discord's: click to write, Enter or
 * clicking away saves, Shift+Enter is a new line, Escape discards. Only the
 * author can read it. Stored as MSC4441 profile annotations, encrypted with
 * MSC4483 when the account has secret storage.
 */
export function UserNote({ userId }: UserNoteProps) {
  const { state, note, service } = useProfileNote(userId);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  /** A save that hit a locked key; replayed once the recovery key is entered. */
  const [pending, setPending] = useState<string>();
  const [showUnlock, setShowUnlock] = useState(false);

  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const original = editableText(note);

  /** The draft a save is in flight for, so blur, Enter and unmount never send it twice. */
  const inFlightRef = useRef<string | undefined>(undefined);
  /** Set by Escape so the blur that follows the editor closing does not save. */
  const discardRef = useRef(false);

  // Survives unmount: closing the popout while typing still saves, as
  // clicking away inside it would.
  const unsavedRef = useRef<{ draft: string; original: string } | undefined>(undefined);
  useEffect(() => {
    unsavedRef.current = editing ? { draft, original } : undefined;
  }, [editing, draft, original]);
  useEffect(
    () => () => {
      const unsaved = unsavedRef.current;
      if (
        !unsaved ||
        unsaved.draft.trim() === unsaved.original.trim() ||
        inFlightRef.current === unsaved.draft
      ) {
        return;
      }
      service.saveNote(userId, unsaved.draft, noteHtml(unsaved.draft.trim())).catch((e) => {
        console.warn('[profile-notes] note typed before the profile closed was not saved:', e);
      });
    },
    [service, userId],
  );

  const autoSize = useCallback(() => {
    const el = textAreaRef.current;
    if (!el) {
      return;
    }
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useLayoutEffect(() => {
    if (!editing) {
      return;
    }
    autoSize();
    const el = textAreaRef.current;
    if (el && document.activeElement !== el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [editing, autoSize]);

  const startEditing = () => {
    discardRef.current = false;
    setDraft(original);
    setError(undefined);
    setEditing(true);
  };

  const save = useCallback(
    (text: string) => {
      if (text.trim() === original.trim()) {
        setEditing(false);
        return;
      }
      if (inFlightRef.current === text) {
        return;
      }
      inFlightRef.current = text;
      setSaving(true);
      setError(undefined);
      service
        .saveNote(userId, text, noteHtml(text.trim()))
        .then(() => {
          setEditing(false);
          setPending(undefined);
        })
        .catch((e) => {
          if (e instanceof NeedsRecoveryKeyError) {
            setPending(text);
            setShowUnlock(true);
            setEditing(false);
            return;
          }
          setError(errorMessage(e));
        })
        .finally(() => {
          inFlightRef.current = undefined;
          setSaving(false);
        });
    },
    [service, userId, original],
  );

  const handleKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = (evt) => {
    if (evt.key === 'Escape') {
      evt.preventDefault();
      evt.stopPropagation();
      discardRef.current = true;
      setEditing(false);
      setError(undefined);
      return;
    }
    if (evt.key === 'Enter' && !evt.shiftKey && !evt.nativeEvent.isComposing) {
      evt.preventDefault();
      save(draft);
    }
  };

  const handleUnlocked = useCallback(() => {
    setShowUnlock(false);
    if (pending !== undefined) {
      setDraft(pending);
      setEditing(true);
      save(pending);
    }
  }, [pending, save]);

  const heading = (
    <Box alignItems="Center" gap="100">
      <Text size="L400">Note</Text>
      {(state.kind === 'locked' || (state.kind === 'ready' && state.encrypted)) && (
        <Icon size="50" src={Icons.Lock} aria-label="Encrypted" />
      )}
      {(state.kind === 'loading' || saving) && <Spinner size="50" />}
    </Box>
  );

  if (state.kind === 'loading') {
    return heading;
  }

  if (state.kind === 'error') {
    return (
      <Box direction="Column" gap="100">
        {heading}
        <Text size="T200" style={{ color: color.Critical.Main }}>
          {state.message}
        </Text>
        <Text
          as="button"
          type="button"
          size="T200"
          priority="400"
          onClick={() => service.refresh()}
          style={{
            alignSelf: 'flex-start',
            cursor: 'pointer',
            background: 'none',
            border: 'none',
            padding: 0,
            textDecoration: 'underline',
          }}
        >
          Try again
        </Text>
      </Box>
    );
  }

  if (state.kind === 'lost') {
    return (
      <Box direction="Column" gap="100">
        {heading}
        <NoteStartOver service={service} reason={state.reason} />
      </Box>
    );
  }

  if (state.kind === 'locked' || showUnlock) {
    return (
      <Box direction="Column" gap="200">
        {heading}
        <Text size="T200" priority="300">
          {pending !== undefined
            ? 'Enter your recovery key to save this note. It is encrypted so only you can read it.'
            : 'Your notes are encrypted. Enter your recovery key to read and edit them on this device.'}
        </Text>
        {showUnlock || pending !== undefined ? (
          <NoteUnlock service={service} onUnlocked={handleUnlocked} />
        ) : (
          <Button
            size="300"
            variant="Secondary"
            fill="Soft"
            radii="300"
            onClick={() => setShowUnlock(true)}
            before={<Icon size="50" src={Icons.Lock} />}
            style={{ alignSelf: 'flex-start' }}
          >
            <Text size="B300">Unlock notes</Text>
          </Button>
        )}
        {pending !== undefined && (
          <Text
            as="button"
            type="button"
            size="T200"
            priority="400"
            onClick={() => {
              setPending(undefined);
              setShowUnlock(false);
            }}
            style={{
              alignSelf: 'flex-start',
              cursor: 'pointer',
              background: 'none',
              border: 'none',
              padding: 0,
              textDecoration: 'underline',
            }}
          >
            Discard this note
          </Text>
        )}
      </Box>
    );
  }

  if (editing) {
    const remaining = NOTE_MAX_LENGTH - draft.length;
    return (
      <Box direction="Column" gap="100">
        {heading}
        <TextArea
          ref={textAreaRef}
          {...{ [NOTE_EDITOR_ATTR]: '' }}
          aria-label="Note"
          value={draft}
          maxLength={NOTE_MAX_LENGTH}
          rows={1}
          variant="Secondary"
          size="300"
          radii="300"
          resize="None"
          readOnly={saving}
          placeholder="Click to add a note"
          onChange={(evt) => {
            setDraft(evt.currentTarget.value);
            autoSize();
          }}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            if (!discardRef.current) {
              save(draft);
            }
          }}
          style={{ maxHeight: NOTE_MAX_HEIGHT, overflowY: 'auto' }}
        />
        <Box justifyContent="SpaceBetween" gap="200">
          <Text size="T200" priority="300">
            {state.encrypted
              ? 'Only you can see this note.'
              : 'Only you can see this note, but it is stored unencrypted on your homeserver. Set up a recovery key in Settings → Devices to encrypt it.'}
          </Text>
          {remaining <= NOTE_MAX_LENGTH * (1 - COUNTER_THRESHOLD) && (
            <Text
              size="T200"
              priority="300"
              style={{ flexShrink: 0, color: remaining <= 0 ? color.Critical.Main : undefined }}
            >
              {remaining}
            </Text>
          )}
        </Box>
        {error && (
          <Text size="T200" style={{ color: color.Critical.Main }}>
            <b>{error}</b>
          </Text>
        )}
      </Box>
    );
  }

  return (
    <Box direction="Column" gap="100">
      {heading}
      <Text
        as="div"
        role="button"
        tabIndex={0}
        aria-label={note ? 'Edit note' : 'Add a note'}
        className={css.Biography}
        size="T300"
        priority={note ? '300' : '400'}
        onClick={(evt) => {
          // Let links inside the note work without opening the editor.
          if ((evt.target as HTMLElement).closest('a')) {
            return;
          }
          startEditing();
        }}
        onKeyDown={(evt) => {
          if (evt.key === 'Enter' || evt.key === ' ') {
            evt.preventDefault();
            startEditing();
          }
        }}
        style={{
          cursor: 'text',
          maxHeight: NOTE_MAX_HEIGHT,
          overflowY: 'auto',
          padding: `${config.space.S100} 0`,
        }}
      >
        {note ? <NoteContent note={note} /> : 'Click to add a note'}
      </Text>
      {error && (
        <Text size="T200" style={{ color: color.Critical.Main }}>
          <b>{error}</b>
        </Text>
      )}
    </Box>
  );
}

import React, {
  ChangeEventHandler,
  KeyboardEventHandler,
  MouseEventHandler,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Box,
  Icon,
  IconButton,
  Icons,
  Input,
  Menu,
  MenuItem,
  PopOut,
  RectCords,
  Text,
  color,
  config,
} from 'folds';

import { usePublicServers } from '../../hooks/usePublicServers';
import { useClientConfig } from '../../hooks/useClientConfig';
import { ServerBrowser } from '../../components/ServerBrowser';

const MAX_SUGGESTIONS = 8;

/**
 * Homeserver field.
 *
 * TWO RULES SHAPE THIS COMPONENT:
 *
 * 1. Typing NEVER touches the network. `onServerChange` is what makes
 *    AuthLayout run `.well-known` discovery and connect, and it used to be
 *    called on a 700ms debounce from every keystroke — so typing "matrix.org"
 *    fired discovery at "matri", "matrix.o" and so on, each a real request
 *    against a half-typed hostname. That is what made the field lag and what
 *    made it connect to servers nobody asked for. It now fires only on an
 *    explicit commit: the confirm button, Enter, a suggestion, or the browser.
 *
 * 2. Completion is inline and local. Typing "tchn" fills in "tchncs.de" with
 *    the un-typed part selected, address-bar style, matched against the
 *    already-downloaded directory. Deletion suppresses it, or the field could
 *    never be cleared.
 */
export function ServerPicker({
  server,
  serverList,
  allowCustomServer,
  onServerChange,
}: {
  server: string;
  serverList: string[];
  allowCustomServer?: boolean;
  onServerChange: (server: string) => void;
}) {
  const [anchor, setAnchor] = useState<RectCords>();
  const [browserOpen, setBrowserOpen] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [typed, setTyped] = useState(server);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const deletingRef = useRef(false);

  const { publicServersUrl } = useClientConfig();
  const { data } = usePublicServers(publicServersUrl);

  useEffect(() => {
    if (inputRef.current && inputRef.current.value !== server) {
      inputRef.current.value = server;
    }
    setTyped(server);
  }, [server]);

  // Config list first — the operator's own picks — then the live directory.
  const candidates = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    const add = (n: string) => {
      const v = n.trim().toLowerCase();
      if (v && !seen.has(v)) {
        seen.add(v);
        out.push(v);
      }
    };
    serverList.forEach(add);
    data?.servers.forEach((s) => {
      if (s.registration.open) add(s.name);
    });
    return out;
  }, [serverList, data]);

  const suggestions = useMemo(() => {
    const q = typed.trim().toLowerCase();
    if (!q) return serverList.slice(0, MAX_SUGGESTIONS);
    const prefix: string[] = [];
    const contains: string[] = [];
    for (const name of candidates) {
      if (name === q) continue;
      if (name.startsWith(q)) prefix.push(name);
      else if (name.includes(q)) contains.push(name);
      if (prefix.length >= MAX_SUGGESTIONS) break;
    }
    return [...prefix, ...contains].slice(0, MAX_SUGGESTIONS);
  }, [typed, candidates, serverList]);

  const bestCompletion = useCallback(
    (value: string): string | undefined => {
      const q = value.trim().toLowerCase();
      if (q.length < 2) return undefined;
      return candidates.find((n) => n.startsWith(q) && n !== q);
    },
    [candidates],
  );

  /** The only path to the network. */
  const commit = useCallback(
    (value: string) => {
      const next = value.trim().toLowerCase();
      if (!next) return;
      if (inputRef.current) inputRef.current.value = next;
      setTyped(next);
      setSuggestOpen(false);
      setActiveIndex(-1);
      onServerChange(next);
    },
    [onServerChange],
  );

  const handleKeyDownCapture: KeyboardEventHandler<HTMLInputElement> = (evt) => {
    deletingRef.current = evt.key === 'Backspace' || evt.key === 'Delete';
  };

  const handleChange: ChangeEventHandler<HTMLInputElement> = (evt) => {
    const input = evt.target;
    const raw = input.value;
    setTyped(raw);
    setActiveIndex(-1);
    setSuggestOpen(raw.trim().length > 0);

    // Inline completion only while appending at the very end.
    const atEnd = input.selectionStart === raw.length && input.selectionEnd === raw.length;
    if (!deletingRef.current && atEnd && raw.trim()) {
      const completion = bestCompletion(raw.trim());
      if (completion) {
        input.value = completion;
        input.setSelectionRange(raw.trim().length, completion.length);
        setTyped(completion);
      }
    }
    // Deliberately no onServerChange here. See rule 1 above.
  };

  const handleKeyDown: KeyboardEventHandler<HTMLInputElement> = (evt) => {
    if (evt.key === 'ArrowDown') {
      evt.preventDefault();
      if (suggestions.length) {
        setSuggestOpen(true);
        setActiveIndex((i) => (i + 1) % suggestions.length);
      }
      return;
    }
    if (evt.key === 'ArrowUp') {
      evt.preventDefault();
      if (suggestions.length) setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
      return;
    }
    if (evt.key === 'Escape') {
      if (suggestOpen) {
        evt.preventDefault();
        setSuggestOpen(false);
      }
      return;
    }
    // Accept the selected completion without submitting.
    if (
      (evt.key === 'Tab' || evt.key === 'ArrowRight') &&
      evt.currentTarget.selectionStart !== evt.currentTarget.selectionEnd
    ) {
      const { value } = evt.currentTarget;
      if (evt.key === 'Tab') evt.preventDefault();
      evt.currentTarget.setSelectionRange(value.length, value.length);
      setTyped(value);
      return;
    }
    if (evt.key === 'Enter') {
      evt.preventDefault();
      commit(activeIndex >= 0 ? suggestions[activeIndex] : evt.currentTarget.value);
    }
  };

  const handleSuggestionClick: MouseEventHandler<HTMLButtonElement> = (evt) => {
    const picked = evt.currentTarget.getAttribute('data-server');
    if (picked) commit(picked);
  };

  // Typed value has diverged from the connected one, so there is something to
  // confirm. Drives the confirm button's prominence.
  const dirty = typed.trim().toLowerCase() !== server.trim().toLowerCase();
  const showSuggestions = allowCustomServer && suggestOpen && suggestions.length > 0;
  const serverCount = data?.servers.length ?? 0;

  return (
    <Box direction="Column" gap="100">
      {browserOpen && (
        <ServerBrowser requestClose={() => setBrowserOpen(false)} onSelect={commit} />
      )}

      <PopOut
        anchor={showSuggestions ? anchor : undefined}
        position="Bottom"
        align="Start"
        offset={4}
        content={
          showSuggestions ? (
            <Menu style={{ maxHeight: '16rem', overflowY: 'auto' }}>
              <div style={{ padding: config.space.S100 }}>
                {suggestions.map((name, index) => (
                  <MenuItem
                    key={name}
                    radii="300"
                    size="300"
                    variant={index === activeIndex ? 'Primary' : 'Surface'}
                    aria-pressed={name === server}
                    data-server={name}
                    // onMouseDown preventDefault: blur fires before click and
                    // would close the menu before the handler ever ran.
                    onMouseDown={(evt: React.MouseEvent) => evt.preventDefault()}
                    onClick={handleSuggestionClick}
                    onMouseEnter={() => setActiveIndex(index)}
                  >
                    <Text size="T300" truncate>
                      {name}
                    </Text>
                  </MenuItem>
                ))}
              </div>
            </Menu>
          ) : null
        }
      >
        <Input
          ref={inputRef}
          variant={allowCustomServer ? 'Background' : 'Surface'}
          outlined
          defaultValue={server}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          readOnly={!allowCustomServer}
          onChange={handleChange}
          onKeyDownCapture={handleKeyDownCapture}
          onKeyDown={handleKeyDown}
          onFocus={(evt) => setAnchor(evt.currentTarget.getBoundingClientRect())}
          onBlur={() => setSuggestOpen(false)}
          size="500"
          after={
            allowCustomServer ? (
              <IconButton
                onClick={() => commit(inputRef.current?.value ?? '')}
                variant={dirty ? 'Success' : 'Background'}
                size="300"
                radii="300"
                disabled={!dirty}
                title="Connect to this homeserver"
                aria-label="Connect to this homeserver"
              >
                <Icon src={Icons.Check} />
              </IconButton>
            ) : undefined
          }
        />
      </PopOut>

      {/*
        A labelled control, not a bare magnifier tucked inside the field.
        Browsing 1,150 servers is the main way most people will choose one, so
        it needs to read as an action rather than be guessed at.
      */}
      {allowCustomServer && (
        <Box
          as="button"
          type="button"
          onClick={() => setBrowserOpen(true)}
          alignItems="Center"
          gap="100"
          style={{
            alignSelf: 'flex-start',
            background: 'none',
            border: 'none',
            padding: `${config.space.S100} 0 0`,
            cursor: 'pointer',
            color: color.Primary.Main,
          }}
        >
          <Icon size="50" src={Icons.Server} />
          <Text as="span" size="T200" style={{ color: 'inherit', textDecoration: 'underline' }}>
            {serverCount > 0
              ? `Browse ${serverCount.toLocaleString()} public servers`
              : 'Browse public servers'}
          </Text>
        </Box>
      )}

      {dirty && (
        <Text size="T200" priority="400">
          Press Enter or the ✓ to connect to <b>{typed.trim().toLowerCase()}</b>.
        </Text>
      )}
    </Box>
  );
}

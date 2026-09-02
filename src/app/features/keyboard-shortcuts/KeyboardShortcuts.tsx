import { useCallback, useRef } from 'react';
import {
  Box,
  color,
  config,
  Modal,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Scroll,
  Text,
} from 'folds';
import { FocusTrap } from 'focus-trap-react';
import { useAtom } from 'jotai';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';
import { KEYBIND_DEFINITIONS, KeybindCategory, keyboardShortcutsAtom } from '../../state/keybinds';
import { formatKeyComboSplit } from '../../utils/key-display';
import { isMacOS } from '../../utils/user-agent';
import { KeySymbol } from '../../utils/key-symbol';
import { stopPropagation } from '../../utils/keyboard';

const CATEGORY_ORDER: KeybindCategory[] = [
  KeybindCategory.Messages,
  KeybindCategory.Navigation,
  KeybindCategory.Formatting,
  KeybindCategory.Chat,
  KeybindCategory.Input,
  KeybindCategory.Call,
];

function KeyCombo({ keys }: { keys: string[] }) {
  return (
    <Box gap="100" alignItems="Center" shrink="No">
      {keys.map((key, i) => (
        <span
          key={i}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '2px 6px',
            borderRadius: '4px',
            backgroundColor: color.SurfaceVariant.Container,
            border: `1px solid ${color.SurfaceVariant.ContainerLine}`,
            minWidth: '20px',
            minHeight: '20px',
            fontSize: '12px',
            fontFamily: 'monospace',
            fontWeight: 600,
            color: color.Surface.OnContainer,
          }}
        >
          {key}
        </span>
      ))}
    </Box>
  );
}

type KeyboardShortcutsProps = {
  requestClose: () => void;
};

export function KeyboardShortcuts({ requestClose }: KeyboardShortcutsProps) {
  const [keybinds] = useSetting(settingsAtom, 'keybinds');
  const modKey = isMacOS() ? KeySymbol.Command : 'Ctrl';
  const scrollRef = useRef<HTMLDivElement>(null);

  const grouped = new Map<
    KeybindCategory,
    { id: string; description: string; keys: string; gesture?: true }[]
  >();
  for (const cat of CATEGORY_ORDER) {
    grouped.set(cat, []);
  }
  for (const def of KEYBIND_DEFINITIONS) {
    // A gesture is not rebindable, so it always shows its own label rather than
    // an override that cannot exist.
    const keys = def.gesture ? def.defaultKeys : (keybinds[def.id] ?? def.defaultKeys);
    grouped
      .get(def.category)
      ?.push({ id: def.id, description: def.description, keys, gesture: def.gesture });
  }

  return (
    <Overlay open backdrop={<OverlayBackdrop />}>
      <OverlayCenter>
        <FocusTrap
          focusTrapOptions={{
            initialFocus: false,
            clickOutsideDeactivates: true,
            onDeactivate: requestClose,
            escapeDeactivates: stopPropagation,
            // focus-trap's FocusTarget has no `false` arm — returning one threw at
            // runtime rather than doing nothing. Unreachable in practice: the Scroll
            // below carries tabIndex={0} and is always mounted inside the trap, so a
            // focusable node always exists and this is never consulted.
            fallbackFocus: () => scrollRef.current ?? document.body,
          }}
        >
          <Modal size="500" flexHeight>
            <Box direction="Column">
              <Box
                style={{
                  padding: config.space.S400,
                  borderBottom: `1px solid ${color.SurfaceVariant.ContainerLine}`,
                }}
                alignItems="Center"
                justifyContent="SpaceBetween"
              >
                <Box alignItems="Center" gap="200">
                  <Text size="H3">Keyboard Shortcuts</Text>
                </Box>
                <Box gap="200" alignItems="Center">
                  <KeyCombo keys={[modKey, '/']} />
                </Box>
              </Box>
              <Scroll ref={scrollRef} size="300" hideTrack tabIndex={0}>
                <Box
                  style={{ padding: config.space.S400, paddingRight: config.space.S200 }}
                  direction="Column"
                  gap="500"
                >
                  {CATEGORY_ORDER.map((cat) => {
                    const items = grouped.get(cat);
                    if (!items || items.length === 0) return null;
                    return (
                      <Box key={cat} direction="Column" gap="200">
                        <Text size="H4" style={{ fontWeight: config.fontWeight.W600 }}>
                          {cat}
                        </Text>
                        <Box direction="Column" gap="100">
                          {items.map((item) => (
                            <Box
                              key={item.id}
                              alignItems="Center"
                              justifyContent="SpaceBetween"
                              gap="200"
                              style={{
                                padding: `${config.space.S100} ${config.space.S200}`,
                                borderRadius: '6px',
                              }}
                            >
                              <div style={{ flex: '1 1 0%', minWidth: 0, display: 'block' }}>
                                <span style={{ fontSize: '14px', lineHeight: 1.4 }}>
                                  {item.description}
                                </span>
                              </div>
                              <KeyCombo
                                keys={item.gesture ? [item.keys] : formatKeyComboSplit(item.keys)}
                              />
                            </Box>
                          ))}
                        </Box>
                      </Box>
                    );
                  })}
                </Box>
              </Scroll>
            </Box>
          </Modal>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}

export function KeyboardShortcutsRenderer() {
  const [opened, setOpen] = useAtom(keyboardShortcutsAtom);

  const close = useCallback(() => setOpen(false), [setOpen]);

  // The mod+/ toggle lives in GlobalKeybinds via useKeybind('keyboard-shortcuts')
  // so user rebinds apply. Don't register a second window listener here — two
  // handlers fighting over the same atom in one keydown tick (set-true vs.
  // toggle) cancelled each other out and the modal never showed.

  if (!opened) return null;
  return <KeyboardShortcuts requestClose={close} />;
}

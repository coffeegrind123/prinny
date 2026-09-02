import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Button, color, config, Icon, IconButton, Icons, Scroll, Switch, Text } from 'folds';
import { Page, PageContent, PageContentCenter, PageHeader } from '../../../components/page';
import { SequenceCard } from '../../../components/sequence-card';
import { SequenceCardStyle } from '../styles.css';
import { useSetting } from '../../../state/hooks/settings';
import { settingsAtom } from '../../../state/settings';
import {
  KEYBIND_DEFINITIONS,
  KeybindCategory,
  type KeybindDefinition,
} from '../../../state/keybinds';
import { formatKeyComboSplit } from '../../../utils/key-display';
import { SettingTile } from '../../../components/setting-tile';

/**
 * A pointer gesture, which is on or off rather than bound to anything.
 *
 * Its state lives in an ordinary boolean setting, named by the registry entry,
 * so the gesture is configured in the same place as the key that does the same
 * job instead of being stranded in a general settings page where nobody looking
 * for shortcuts would find it.
 */
function GestureTile({ def }: { def: KeybindDefinition }) {
  const [settings, setSettings] = useSetting(settingsAtom, def.settingKey as 'replyOnDoubleClick');

  return (
    <SettingTile
      title={def.description}
      after={<Switch variant="Primary" value={settings} onChange={setSettings} />}
    />
  );
}

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

function eventToKeyString(event: KeyboardEvent): string | null {
  if (
    event.key === 'Control' ||
    event.key === 'Shift' ||
    event.key === 'Alt' ||
    event.key === 'Meta'
  ) {
    return null;
  }
  const parts: string[] = [];
  if (event.metaKey || event.ctrlKey) parts.push('mod');
  if (event.shiftKey) parts.push('shift');
  if (event.altKey) parts.push('alt');
  parts.push(event.key.toLowerCase());
  return parts.join('+');
}

type KeybindCaptureProps = {
  currentKey: string;
  onCapture: (keyString: string) => void;
};
function KeybindCapture({ currentKey, onCapture }: KeybindCaptureProps) {
  const [capturing, setCapturing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!capturing) return;
    const handler = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const keyString = eventToKeyString(event);
      if (keyString) {
        onCapture(keyString);
        setCapturing(false);
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [capturing, onCapture]);

  return (
    <Box
      ref={ref}
      onClick={() => setCapturing(true)}
      style={{
        cursor: 'pointer',
        padding: config.space.S100,
        borderRadius: '6px',
        border: capturing ? `2px solid ${color.Primary.Main}` : `2px solid transparent`,
        backgroundColor: capturing ? color.Primary.Container : 'transparent',
      }}
    >
      {capturing ? (
        <Text size="T200" style={{ color: color.Primary.Main, fontStyle: 'italic' }}>
          Press keys...
        </Text>
      ) : (
        <KeyCombo keys={formatKeyComboSplit(currentKey)} />
      )}
    </Box>
  );
}

type KeybindsProps = {
  requestClose: () => void;
};
export function Keybinds({ requestClose }: KeybindsProps) {
  const [keybinds, setKeybinds] = useSetting(settingsAtom, 'keybinds');

  const handleCapture = useCallback(
    (id: string, keyString: string) => {
      setKeybinds((prev) => ({ ...prev, [id]: keyString }));
    },
    [setKeybinds],
  );

  const handleReset = useCallback(
    (id: string) => {
      setKeybinds((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    },
    [setKeybinds],
  );

  const handleResetAll = useCallback(() => {
    setKeybinds({});
  }, [setKeybinds]);

  return (
    <Page>
      <PageHeader outlined={false}>
        <Box grow="Yes" gap="200">
          <Box grow="Yes" alignItems="Center" gap="200">
            <Text size="H3" truncate>
              Keybinds
            </Text>
          </Box>
          <Box shrink="No" gap="200" alignItems="Center">
            <Button
              size="300"
              variant="Secondary"
              fill="None"
              radii="Pill"
              onClick={handleResetAll}
              before={<Icon src={Icons.Reload} size="100" />}
            >
              <Text size="B400">Reset All</Text>
            </Button>
            <IconButton onClick={requestClose} variant="Surface">
              <Icon src={Icons.Cross} />
            </IconButton>
          </Box>
        </Box>
      </PageHeader>
      <Box grow="Yes">
        <Scroll hideTrack visibility="Hover">
          <PageContent>
            <PageContentCenter>
              <Box direction="Column" gap="700">
                {CATEGORY_ORDER.map((cat) => {
                  const items = KEYBIND_DEFINITIONS.filter((d) => d.category === cat);
                  if (items.length === 0) return null;
                  return (
                    <Box key={cat} direction="Column" gap="100">
                      <Text size="L400">{cat}</Text>
                      <SequenceCard
                        className={SequenceCardStyle}
                        variant="SurfaceVariant"
                        direction="Column"
                        gap="400"
                      >
                        {items.map((def) => {
                          // A gesture has no combo to capture or reset — it is
                          // on or off. Rendering the capture control for one
                          // would invite the user to bind a key that could
                          // never fire.
                          if (def.gesture) {
                            return <GestureTile key={def.id} def={def} />;
                          }
                          const currentKey = keybinds[def.id] ?? def.defaultKeys;
                          const isCustom = keybinds[def.id] !== undefined;
                          return (
                            <SettingTile
                              key={def.id}
                              title={def.description}
                              after={
                                <Box gap="100" alignItems="Center">
                                  <KeybindCapture
                                    currentKey={currentKey}
                                    onCapture={(ks) => handleCapture(def.id, ks)}
                                  />
                                  {isCustom && (
                                    <Button
                                      size="300"
                                      variant="Secondary"
                                      fill="None"
                                      radii="Pill"
                                      onClick={() => handleReset(def.id)}
                                    >
                                      <Text size="T200">Reset</Text>
                                    </Button>
                                  )}
                                </Box>
                              }
                            />
                          );
                        })}
                      </SequenceCard>
                    </Box>
                  );
                })}
              </Box>
            </PageContentCenter>
          </PageContent>
        </Scroll>
      </Box>
    </Page>
  );
}

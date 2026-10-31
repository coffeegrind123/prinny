import {
  ChangeEventHandler,
  FormEventHandler,
  KeyboardEventHandler,
  MouseEventHandler,
  useEffect,
  useState,
} from 'react';
import dayjs from 'dayjs';
import {
  as,
  Box,
  Button,
  Chip,
  color,
  config,
  Header,
  Icon,
  IconButton,
  Icons,
  Input,
  Menu,
  MenuItem,
  PopOut,
  RectCords,
  Scroll,
  Switch,
  Text,
  toRem,
} from 'folds';
import { isKeyHotkey } from '../../../utils/is-hotkey';
import { FocusTrap } from 'focus-trap-react';
import { Page, PageContent, PageContentCenter, PageHeader } from '../../../components/page';
import { SequenceCard } from '../../../components/sequence-card';
import { PrivacySettings } from './PrivacySettings';
import { AudioSettings } from './AudioSettings';
import { useAutostart } from '../../../hooks/useAutostart';
import { useSetting } from '../../../state/hooks/settings';
import {
  DateFormat,
  InboxTabId,
  MessageLayout,
  MessageSpacing,
  settingsAtom,
} from '../../../state/settings';
import { SettingTile } from '../../../components/setting-tile';
import { CustomCssSettings } from '../../custom-css/CustomCssSettings';
import { KeySymbol } from '../../../utils/key-symbol';
import { isMacOS } from '../../../utils/user-agent';
import { isTauri } from '../../../utils/desktop-notifications';
import {
  DarkTheme,
  LightTheme,
  Theme,
  ThemeKind,
  useSystemThemeKind,
  useThemeNames,
  useThemes,
} from '../../../hooks/useTheme';
import { stopPropagation } from '../../../utils/keyboard';
import { PIPED_INSTANCES } from '../../../utils/piped';
import {
  GIF_PROVIDERS,
  GifProviderId,
  gifProviderKey,
  resolveGifSource,
} from '../../../utils/klipy';
import { useClientConfig } from '../../../hooks/useClientConfig';
import { useMessageLayoutItems } from '../../../hooks/useMessageLayout';
import { useMessageSpacingItems } from '../../../hooks/useMessageSpacing';
import { useDateFormatItems } from '../../../hooks/useDateFormat';
import { SequenceCardStyle } from '../styles.css';
import { normalizeAutoEmbedHost } from '../../../utils/mediaAutoEmbed';

type ThemeSelectorProps = {
  themeNames: Record<string, string>;
  themes: Theme[];
  selected: Theme;
  onSelect: (theme: Theme) => void;
};
const ThemeSelector = as<'div', ThemeSelectorProps>(
  ({ themeNames, themes, selected, onSelect, ...props }, ref) => (
    // Scrolls once More Themes makes the list taller than the screen.
    <Menu {...props} ref={ref} style={{ maxHeight: '75vh', display: 'flex' }}>
      <Box grow="Yes">
        <Scroll size="0" hideTrack visibility="Hover">
          <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
            {themes.map((theme) => (
              <MenuItem
                key={theme.id}
                size="300"
                variant={theme.id === selected.id ? 'Primary' : 'Surface'}
                radii="300"
                onClick={() => onSelect(theme)}
              >
                <Text size="T300" truncate>
                  {themeNames[theme.id] ?? theme.id}
                </Text>
              </MenuItem>
            ))}
          </Box>
        </Scroll>
      </Box>
    </Menu>
  ),
);

function SelectTheme({ disabled }: { disabled?: boolean }) {
  const themes = useThemes();
  const themeNames = useThemeNames();
  const [themeId, setThemeId] = useSetting(settingsAtom, 'themeId');
  const [menuCords, setMenuCords] = useState<RectCords>();
  const selectedTheme = themes.find((theme) => theme.id === themeId) ?? LightTheme;

  const handleThemeMenu: MouseEventHandler<HTMLButtonElement> = (evt) => {
    setMenuCords(evt.currentTarget.getBoundingClientRect());
  };

  const handleThemeSelect = (theme: Theme) => {
    setThemeId(theme.id);
    setMenuCords(undefined);
  };

  return (
    <>
      <Button
        size="300"
        variant="Primary"
        outlined
        fill="Soft"
        radii="300"
        after={<Icon size="300" src={Icons.ChevronBottom} />}
        onClick={disabled ? undefined : handleThemeMenu}
        aria-disabled={disabled}
      >
        <Text size="T300">{themeNames[selectedTheme.id] ?? selectedTheme.id}</Text>
      </Button>
      <PopOut
        anchor={menuCords}
        offset={5}
        position="Bottom"
        align="End"
        content={
          <FocusTrap
            focusTrapOptions={{
              initialFocus: false,
              onDeactivate: () => setMenuCords(undefined),
              clickOutsideDeactivates: true,
              isKeyForward: (evt: KeyboardEvent) =>
                evt.key === 'ArrowDown' || evt.key === 'ArrowRight',
              isKeyBackward: (evt: KeyboardEvent) =>
                evt.key === 'ArrowUp' || evt.key === 'ArrowLeft',
              escapeDeactivates: stopPropagation,
            }}
          >
            <ThemeSelector
              themeNames={themeNames}
              themes={themes}
              selected={selectedTheme}
              onSelect={handleThemeSelect}
            />
          </FocusTrap>
        }
      />
    </>
  );
}

const pipedInstanceLabel = (origin: string): string => {
  if (!origin) return 'Auto (fastest reachable)';
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
};

function SelectPipedInstance() {
  const [pipedInstance, setPipedInstance] = useSetting(settingsAtom, 'pipedInstance');
  const [menuCords, setMenuCords] = useState<RectCords>();
  const options = ['', ...PIPED_INSTANCES];

  const handleMenu: MouseEventHandler<HTMLButtonElement> = (evt) => {
    setMenuCords(evt.currentTarget.getBoundingClientRect());
  };
  const handleSelect = (value: string) => {
    setPipedInstance(value);
    setMenuCords(undefined);
  };

  return (
    <>
      <Button
        size="300"
        variant="Secondary"
        outlined
        fill="Soft"
        radii="300"
        after={<Icon size="300" src={Icons.ChevronBottom} />}
        onClick={handleMenu}
      >
        <Text size="T300">{pipedInstanceLabel(pipedInstance)}</Text>
      </Button>
      <PopOut
        anchor={menuCords}
        offset={5}
        position="Bottom"
        align="End"
        content={
          <FocusTrap
            focusTrapOptions={{
              initialFocus: false,
              onDeactivate: () => setMenuCords(undefined),
              clickOutsideDeactivates: true,
              escapeDeactivates: stopPropagation,
            }}
          >
            <Menu>
              <Box
                direction="Column"
                gap="100"
                style={{ padding: config.space.S100, maxHeight: toRem(320), overflowY: 'auto' }}
              >
                {options.map((value) => (
                  <MenuItem
                    key={value || 'auto'}
                    size="300"
                    variant={value === pipedInstance ? 'Primary' : 'Surface'}
                    radii="300"
                    onClick={() => handleSelect(value)}
                  >
                    <Text size="T300">{pipedInstanceLabel(value)}</Text>
                  </MenuItem>
                ))}
              </Box>
            </Menu>
          </FocusTrap>
        }
      />
    </>
  );
}

function SystemThemePreferences() {
  const themeKind = useSystemThemeKind();
  const themeNames = useThemeNames();
  const themes = useThemes();
  const [lightThemeId, setLightThemeId] = useSetting(settingsAtom, 'lightThemeId');
  const [darkThemeId, setDarkThemeId] = useSetting(settingsAtom, 'darkThemeId');

  const lightThemes = themes.filter((theme) => theme.kind === ThemeKind.Light);
  const darkThemes = themes.filter((theme) => theme.kind === ThemeKind.Dark);

  const selectedLightTheme = lightThemes.find((theme) => theme.id === lightThemeId) ?? LightTheme;
  const selectedDarkTheme = darkThemes.find((theme) => theme.id === darkThemeId) ?? DarkTheme;

  const [ltCords, setLTCords] = useState<RectCords>();
  const [dtCords, setDTCords] = useState<RectCords>();

  const handleLightThemeMenu: MouseEventHandler<HTMLButtonElement> = (evt) => {
    setLTCords(evt.currentTarget.getBoundingClientRect());
  };
  const handleDarkThemeMenu: MouseEventHandler<HTMLButtonElement> = (evt) => {
    setDTCords(evt.currentTarget.getBoundingClientRect());
  };

  const handleLightThemeSelect = (theme: Theme) => {
    setLightThemeId(theme.id);
    setLTCords(undefined);
  };

  const handleDarkThemeSelect = (theme: Theme) => {
    setDarkThemeId(theme.id);
    setDTCords(undefined);
  };

  return (
    <Box wrap="Wrap" gap="400">
      <SettingTile
        title="Light Theme:"
        after={
          <Chip
            variant={themeKind === ThemeKind.Light ? 'Primary' : 'Secondary'}
            outlined={themeKind === ThemeKind.Light}
            radii="Pill"
            after={<Icon size="200" src={Icons.ChevronBottom} />}
            onClick={handleLightThemeMenu}
          >
            <Text size="B300">{themeNames[selectedLightTheme.id] ?? selectedLightTheme.id}</Text>
          </Chip>
        }
      />
      <PopOut
        anchor={ltCords}
        offset={5}
        position="Bottom"
        align="End"
        content={
          <FocusTrap
            focusTrapOptions={{
              initialFocus: false,
              onDeactivate: () => setLTCords(undefined),
              clickOutsideDeactivates: true,
              isKeyForward: (evt: KeyboardEvent) =>
                evt.key === 'ArrowDown' || evt.key === 'ArrowRight',
              isKeyBackward: (evt: KeyboardEvent) =>
                evt.key === 'ArrowUp' || evt.key === 'ArrowLeft',
              escapeDeactivates: stopPropagation,
            }}
          >
            <ThemeSelector
              themeNames={themeNames}
              themes={lightThemes}
              selected={selectedLightTheme}
              onSelect={handleLightThemeSelect}
            />
          </FocusTrap>
        }
      />
      <SettingTile
        title="Dark Theme:"
        after={
          <Chip
            variant={themeKind === ThemeKind.Dark ? 'Primary' : 'Secondary'}
            outlined={themeKind === ThemeKind.Dark}
            radii="Pill"
            after={<Icon size="200" src={Icons.ChevronBottom} />}
            onClick={handleDarkThemeMenu}
          >
            <Text size="B300">{themeNames[selectedDarkTheme.id] ?? selectedDarkTheme.id}</Text>
          </Chip>
        }
      />
      <PopOut
        anchor={dtCords}
        offset={5}
        position="Bottom"
        align="End"
        content={
          <FocusTrap
            focusTrapOptions={{
              initialFocus: false,
              onDeactivate: () => setDTCords(undefined),
              clickOutsideDeactivates: true,
              isKeyForward: (evt: KeyboardEvent) =>
                evt.key === 'ArrowDown' || evt.key === 'ArrowRight',
              isKeyBackward: (evt: KeyboardEvent) =>
                evt.key === 'ArrowUp' || evt.key === 'ArrowLeft',
              escapeDeactivates: stopPropagation,
            }}
          >
            <ThemeSelector
              themeNames={themeNames}
              themes={darkThemes}
              selected={selectedDarkTheme}
              onSelect={handleDarkThemeSelect}
            />
          </FocusTrap>
        }
      />
    </Box>
  );
}

function PageZoomInput() {
  const [pageZoom, setPageZoom] = useSetting(settingsAtom, 'pageZoom');
  const [currentZoom, setCurrentZoom] = useState(`${pageZoom}`);

  const handleZoomChange: ChangeEventHandler<HTMLInputElement> = (evt) => {
    setCurrentZoom(evt.target.value);
  };

  const handleZoomEnter: KeyboardEventHandler<HTMLInputElement> = (evt) => {
    if (isKeyHotkey('escape', evt)) {
      evt.stopPropagation();
      setCurrentZoom(pageZoom.toString());
    }
    if (
      isKeyHotkey('enter', evt) &&
      'value' in evt.target &&
      typeof evt.target.value === 'string'
    ) {
      const newZoom = parseInt(evt.target.value, 10);
      if (Number.isNaN(newZoom)) return;
      const safeZoom = Math.max(Math.min(newZoom, 150), 75);
      setPageZoom(safeZoom);
      setCurrentZoom(safeZoom.toString());
    }
  };

  return (
    <Input
      style={{ width: toRem(100) }}
      variant={pageZoom === parseInt(currentZoom, 10) ? 'Secondary' : 'Success'}
      size="300"
      radii="300"
      type="number"
      min="75"
      max="150"
      value={currentZoom}
      onChange={handleZoomChange}
      onKeyDown={handleZoomEnter}
      after={<Text size="T300">%</Text>}
      outlined
    />
  );
}

function Appearance() {
  const [systemTheme, setSystemTheme] = useSetting(settingsAtom, 'useSystemTheme');
  const [monochromeMode, setMonochromeMode] = useSetting(settingsAtom, 'monochromeMode');
  const [twitterEmoji, setTwitterEmoji] = useSetting(settingsAtom, 'twitterEmoji');
  const [extraThemes, setExtraThemes] = useSetting(settingsAtom, 'extraThemes');
  const [compactRoomList, setCompactRoomList] = useSetting(settingsAtom, 'compactRoomList');
  const [collapsibleEmojiGroups, setCollapsibleEmojiGroups] = useSetting(
    settingsAtom,
    'collapsibleEmojiGroups',
  );
  const [spaceUnreadPill, setSpaceUnreadPill] = useSetting(settingsAtom, 'spaceUnreadPill');
  const [redMentionBadges, setRedMentionBadges] = useSetting(settingsAtom, 'redMentionBadges');

  return (
    <Box direction="Column" gap="100">
      <Text size="L400">Appearance</Text>
      <SequenceCard
        className={SequenceCardStyle}
        variant="SurfaceVariant"
        direction="Column"
        gap="400"
      >
        <SettingTile
          title="System Theme"
          description="Choose between light and dark theme based on system preference."
          after={<Switch variant="Primary" value={systemTheme} onChange={setSystemTheme} />}
        />
        {systemTheme && <SystemThemePreferences />}
      </SequenceCard>

      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title="Theme"
          description="Theme to use when system theme is not enabled."
          after={<SelectTheme disabled={systemTheme} />}
        />
      </SequenceCard>

      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title="Monochrome Mode"
          after={<Switch variant="Primary" value={monochromeMode} onChange={setMonochromeMode} />}
        />
      </SequenceCard>

      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title="Twitter Emoji"
          after={<Switch variant="Primary" value={twitterEmoji} onChange={setTwitterEmoji} />}
        />
      </SequenceCard>

      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title="More Themes"
          description="Add 22 more dark themes to the theme lists: Ayu, Catppuccin, Dracula, Everforest, Gruvbox, Kanagawa, Nord, Rosé Pine, Tokyo Night, OLED Midnight and Catthode."
          after={<Switch variant="Primary" value={extraThemes} onChange={setExtraThemes} />}
        />
      </SequenceCard>

      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title="Compact Room List"
          description="Shorter rows and category headers in the room list, to fit more rooms on screen."
          after={<Switch variant="Primary" value={compactRoomList} onChange={setCompactRoomList} />}
        />
      </SequenceCard>

      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title="Collapsible Emoji Groups"
          description="Emoji and sticker group headings show the group's icon, and clicking one collapses or expands the group."
          after={
            <Switch
              variant="Primary"
              value={collapsibleEmojiGroups}
              onChange={setCollapsibleEmojiGroups}
            />
          }
        />
      </SequenceCard>

      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title="Unread Pills in the Space Bar"
          description="A space with unread messages gets a small pill beside it instead of a badge. Only mentions get a count, in the corner."
          after={<Switch variant="Primary" value={spaceUnreadPill} onChange={setSpaceUnreadPill} />}
        />
      </SequenceCard>

      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title="Red Mention Badges"
          description="Show unread badges for mentions and highlights in red instead of green."
          after={
            <Switch variant="Primary" value={redMentionBadges} onChange={setRedMentionBadges} />
          }
        />
      </SequenceCard>

      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile title="Page Zoom" after={<PageZoomInput />} />
      </SequenceCard>
    </Box>
  );
}

type DateHintProps = {
  hasChanges: boolean;
  handleReset: () => void;
};
function DateHint({ hasChanges, handleReset }: DateHintProps) {
  const [anchor, setAnchor] = useState<RectCords>();
  const categoryPadding = { padding: config.space.S200, paddingTop: 0 };

  const handleOpenMenu: MouseEventHandler<HTMLElement> = (evt) => {
    setAnchor(evt.currentTarget.getBoundingClientRect());
  };
  return (
    <PopOut
      anchor={anchor}
      position="Top"
      align="End"
      content={
        <FocusTrap
          focusTrapOptions={{
            initialFocus: false,
            onDeactivate: () => setAnchor(undefined),
            clickOutsideDeactivates: true,
            escapeDeactivates: stopPropagation,
          }}
        >
          <Menu style={{ maxHeight: '85vh', overflowY: 'auto' }}>
            <Header size="300" style={{ padding: `0 ${config.space.S200}` }}>
              <Text size="L400">Formatting</Text>
            </Header>

            <Box direction="Column">
              <Box style={categoryPadding} direction="Column">
                <Header size="300">
                  <Text size="L400">Year</Text>
                </Header>
                <Box direction="Column" tabIndex={0} gap="100">
                  <Text size="T300">
                    YY
                    <Text as="span" size="Inherit" priority="300">
                      {': '}
                      Two-digit year
                    </Text>{' '}
                  </Text>
                  <Text size="T300">
                    YYYY
                    <Text as="span" size="Inherit" priority="300">
                      {': '}Four-digit year
                    </Text>
                  </Text>
                </Box>
              </Box>

              <Box style={categoryPadding} direction="Column">
                <Header size="300">
                  <Text size="L400">Month</Text>
                </Header>
                <Box direction="Column" tabIndex={0} gap="100">
                  <Text size="T300">
                    M
                    <Text as="span" size="Inherit" priority="300">
                      {': '}The month
                    </Text>
                  </Text>
                  <Text size="T300">
                    MM
                    <Text as="span" size="Inherit" priority="300">
                      {': '}Two-digit month
                    </Text>{' '}
                  </Text>
                  <Text size="T300">
                    MMM
                    <Text as="span" size="Inherit" priority="300">
                      {': '}Short month name
                    </Text>
                  </Text>
                  <Text size="T300">
                    MMMM
                    <Text as="span" size="Inherit" priority="300">
                      {': '}Full month name
                    </Text>
                  </Text>
                </Box>
              </Box>

              <Box style={categoryPadding} direction="Column">
                <Header size="300">
                  <Text size="L400">Day of the Month</Text>
                </Header>
                <Box direction="Column" tabIndex={0} gap="100">
                  <Text size="T300">
                    D
                    <Text as="span" size="Inherit" priority="300">
                      {': '}Day of the month
                    </Text>
                  </Text>
                  <Text size="T300">
                    DD
                    <Text as="span" size="Inherit" priority="300">
                      {': '}Two-digit day of the month
                    </Text>
                  </Text>
                </Box>
              </Box>
              <Box style={categoryPadding} direction="Column">
                <Header size="300">
                  <Text size="L400">Day of the Week</Text>
                </Header>
                <Box direction="Column" tabIndex={0} gap="100">
                  <Text size="T300">
                    d
                    <Text as="span" size="Inherit" priority="300">
                      {': '}Day of the week (Sunday = 0)
                    </Text>
                  </Text>
                  <Text size="T300">
                    dd
                    <Text as="span" size="Inherit" priority="300">
                      {': '}Two-letter day name
                    </Text>
                  </Text>
                  <Text size="T300">
                    ddd
                    <Text as="span" size="Inherit" priority="300">
                      {': '}Short day name
                    </Text>
                  </Text>
                  <Text size="T300">
                    dddd
                    <Text as="span" size="Inherit" priority="300">
                      {': '}Full day name
                    </Text>
                  </Text>
                </Box>
              </Box>
            </Box>
          </Menu>
        </FocusTrap>
      }
    >
      {hasChanges ? (
        <IconButton
          tabIndex={-1}
          onClick={handleReset}
          type="reset"
          variant="Secondary"
          size="300"
          radii="300"
        >
          <Icon src={Icons.Cross} size="100" />
        </IconButton>
      ) : (
        <IconButton
          tabIndex={-1}
          onClick={handleOpenMenu}
          type="button"
          variant="Secondary"
          size="300"
          radii="300"
          aria-pressed={!!anchor}
        >
          <Icon style={{ opacity: config.opacity.P300 }} size="100" src={Icons.Info} />
        </IconButton>
      )}
    </PopOut>
  );
}

type CustomDateFormatProps = {
  value: string;
  onChange: (format: string) => void;
};
function CustomDateFormat({ value, onChange }: CustomDateFormatProps) {
  const [dateFormatCustom, setDateFormatCustom] = useState(value);

  useEffect(() => {
    setDateFormatCustom(value);
  }, [value]);

  const handleChange: ChangeEventHandler<HTMLInputElement> = (evt) => {
    const format = evt.currentTarget.value;
    setDateFormatCustom(format);
  };

  const handleReset = () => {
    setDateFormatCustom(value);
  };

  const handleSubmit: FormEventHandler<HTMLFormElement> = (evt) => {
    evt.preventDefault();

    const target = evt.target as HTMLFormElement | undefined;
    const customDateFormatInput = target?.customDateFormatInput as HTMLInputElement | undefined;
    const format = customDateFormatInput?.value;
    if (!format) return;

    onChange(format);
  };

  const hasChanges = dateFormatCustom !== value;
  return (
    <SettingTile>
      <Box as="form" onSubmit={handleSubmit} gap="200">
        <Box grow="Yes" direction="Column">
          <Input
            required
            name="customDateFormatInput"
            value={dateFormatCustom}
            onChange={handleChange}
            maxLength={16}
            autoComplete="off"
            variant="Secondary"
            radii="300"
            style={{ paddingRight: config.space.S200 }}
            after={<DateHint hasChanges={hasChanges} handleReset={handleReset} />}
          />
        </Box>
        <Button
          size="400"
          variant={hasChanges ? 'Success' : 'Secondary'}
          fill={hasChanges ? 'Solid' : 'Soft'}
          outlined
          radii="300"
          disabled={!hasChanges}
          type="submit"
        >
          <Text size="B400">Save</Text>
        </Button>
      </Box>
    </SettingTile>
  );
}

const INBOX_TAB_ITEMS: { id: InboxTabId; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'invites', label: 'Invites' },
];

function SelectDefaultInboxTab() {
  const [defaultInboxTab, setDefaultInboxTab] = useSetting(settingsAtom, 'defaultInboxTab');
  const [menuCords, setMenuCords] = useState<RectCords>();

  const handleMenu: MouseEventHandler<HTMLButtonElement> = (evt) => {
    setMenuCords(evt.currentTarget.getBoundingClientRect());
  };

  const handleSelect = (tab: InboxTabId) => {
    setDefaultInboxTab(tab);
    setMenuCords(undefined);
  };

  const current = INBOX_TAB_ITEMS.find((item) => item.id === defaultInboxTab) ?? INBOX_TAB_ITEMS[0];

  return (
    <>
      <Button
        size="300"
        variant="Secondary"
        outlined
        fill="Soft"
        radii="300"
        after={<Icon size="300" src={Icons.ChevronBottom} />}
        onClick={handleMenu}
      >
        <Text size="T300">{current.label}</Text>
      </Button>
      <PopOut
        anchor={menuCords}
        offset={5}
        position="Bottom"
        align="End"
        content={
          <FocusTrap
            focusTrapOptions={{
              initialFocus: false,
              onDeactivate: () => setMenuCords(undefined),
              clickOutsideDeactivates: true,
              isKeyForward: (evt: KeyboardEvent) =>
                evt.key === 'ArrowDown' || evt.key === 'ArrowRight',
              isKeyBackward: (evt: KeyboardEvent) =>
                evt.key === 'ArrowUp' || evt.key === 'ArrowLeft',
              escapeDeactivates: stopPropagation,
            }}
          >
            <Menu>
              <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
                {INBOX_TAB_ITEMS.map((item) => (
                  <MenuItem
                    key={item.id}
                    size="300"
                    variant={defaultInboxTab === item.id ? 'Primary' : 'Surface'}
                    radii="300"
                    onClick={() => handleSelect(item.id)}
                  >
                    <Text size="T300">{item.label}</Text>
                  </MenuItem>
                ))}
              </Box>
            </Menu>
          </FocusTrap>
        }
      />
    </>
  );
}

function SelectGifProvider() {
  const [gifProvider, setGifProvider] = useSetting(settingsAtom, 'gifProvider');
  const { gifApiKeys } = useClientConfig();
  const [menuCords, setMenuCords] = useState<RectCords>();

  const handleMenu: MouseEventHandler<HTMLButtonElement> = (evt) => {
    setMenuCords(evt.currentTarget.getBoundingClientRect());
  };

  const handleSelect = (id: GifProviderId) => {
    setGifProvider(id);
    setMenuCords(undefined);
  };

  // What the picker really uses: a provider without a key falls back to Klipy.
  const active = resolveGifSource(gifProvider, gifApiKeys).id;
  const current = GIF_PROVIDERS.find((item) => item.id === active) ?? GIF_PROVIDERS[0];

  return (
    <>
      <Button
        size="300"
        variant="Secondary"
        outlined
        fill="Soft"
        radii="300"
        after={<Icon size="300" src={Icons.ChevronBottom} />}
        onClick={handleMenu}
      >
        <Text size="T300">{current.label}</Text>
      </Button>
      <PopOut
        anchor={menuCords}
        offset={5}
        position="Bottom"
        align="End"
        content={
          <FocusTrap
            focusTrapOptions={{
              initialFocus: false,
              onDeactivate: () => setMenuCords(undefined),
              clickOutsideDeactivates: true,
              isKeyForward: (evt: KeyboardEvent) =>
                evt.key === 'ArrowDown' || evt.key === 'ArrowRight',
              isKeyBackward: (evt: KeyboardEvent) =>
                evt.key === 'ArrowUp' || evt.key === 'ArrowLeft',
              escapeDeactivates: stopPropagation,
            }}
          >
            <Menu>
              <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
                {GIF_PROVIDERS.map((item) => {
                  const hasKey = !!gifProviderKey(item.id, gifApiKeys);
                  return (
                    <MenuItem
                      key={item.id}
                      size="300"
                      variant={active === item.id ? 'Primary' : 'Surface'}
                      radii="300"
                      disabled={!hasKey}
                      onClick={() => handleSelect(item.id)}
                    >
                      <Text size="T300">{hasKey ? item.label : `${item.label} (no API key)`}</Text>
                    </MenuItem>
                  );
                })}
              </Box>
            </Menu>
          </FocusTrap>
        }
      />
    </>
  );
}

type PresetDateFormatProps = {
  value: string;
  onChange: (format: string) => void;
};
function PresetDateFormat({ value, onChange }: PresetDateFormatProps) {
  const [menuCords, setMenuCords] = useState<RectCords>();
  const dateFormatItems = useDateFormatItems();

  const getDisplayDate = (format: string): string =>
    format !== '' ? dayjs().format(format) : 'Custom';

  const handleMenu: MouseEventHandler<HTMLButtonElement> = (evt) => {
    setMenuCords(evt.currentTarget.getBoundingClientRect());
  };

  const handleSelect = (format: DateFormat) => {
    onChange(format);
    setMenuCords(undefined);
  };

  return (
    <>
      <Button
        size="300"
        variant="Secondary"
        outlined
        fill="Soft"
        radii="300"
        after={<Icon size="300" src={Icons.ChevronBottom} />}
        onClick={handleMenu}
      >
        <Text size="T300">
          {getDisplayDate(dateFormatItems.find((i) => i.format === value)?.format ?? value)}
        </Text>
      </Button>
      <PopOut
        anchor={menuCords}
        offset={5}
        position="Bottom"
        align="End"
        content={
          <FocusTrap
            focusTrapOptions={{
              initialFocus: false,
              onDeactivate: () => setMenuCords(undefined),
              clickOutsideDeactivates: true,
              isKeyForward: (evt: KeyboardEvent) =>
                evt.key === 'ArrowDown' || evt.key === 'ArrowRight',
              isKeyBackward: (evt: KeyboardEvent) =>
                evt.key === 'ArrowUp' || evt.key === 'ArrowLeft',
              escapeDeactivates: stopPropagation,
            }}
          >
            <Menu>
              <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
                {dateFormatItems.map((item) => (
                  <MenuItem
                    key={item.format}
                    size="300"
                    variant={value === item.format ? 'Primary' : 'Surface'}
                    radii="300"
                    onClick={() => handleSelect(item.format)}
                  >
                    <Text size="T300">{getDisplayDate(item.format)}</Text>
                  </MenuItem>
                ))}
              </Box>
            </Menu>
          </FocusTrap>
        }
      />
    </>
  );
}

function SelectDateFormat() {
  const [dateFormatString, setDateFormatString] = useSetting(settingsAtom, 'dateFormatString');
  const [selectedDateFormat, setSelectedDateFormat] = useState(dateFormatString);
  const customDateFormat = selectedDateFormat === '';

  const handlePresetChange = (format: string) => {
    setSelectedDateFormat(format);
    if (format !== '') {
      setDateFormatString(format);
    }
  };

  return (
    <>
      <SettingTile
        title="Date Format"
        description={customDateFormat ? dayjs().format(dateFormatString) : ''}
        after={<PresetDateFormat value={selectedDateFormat} onChange={handlePresetChange} />}
      />
      {customDateFormat && (
        <CustomDateFormat value={dateFormatString} onChange={setDateFormatString} />
      )}
    </>
  );
}

function DateAndTime() {
  const [hour24Clock, setHour24Clock] = useSetting(settingsAtom, 'hour24Clock');

  return (
    <Box direction="Column" gap="100">
      <Text size="L400">Date & Time</Text>
      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title="24-Hour Time Format"
          after={<Switch variant="Primary" value={hour24Clock} onChange={setHour24Clock} />}
        />
      </SequenceCard>

      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SelectDateFormat />
      </SequenceCard>
    </Box>
  );
}

function Editor() {
  const [enterForNewline, setEnterForNewline] = useSetting(settingsAtom, 'enterForNewline');
  const [scrollOnSend, setScrollOnSend] = useSetting(settingsAtom, 'scrollOnSend');
  const [discordMarkdown, setDiscordMarkdown] = useSetting(settingsAtom, 'discordMarkdown');
  const [disableSpellcheck, setDisableSpellcheck] = useSetting(settingsAtom, 'disableSpellcheck');
  const [isMarkdown, setIsMarkdown] = useSetting(settingsAtom, 'isMarkdown');
  const [hideReadReceipts, setHideReadReceipts] = useSetting(settingsAtom, 'hideReadReceipts');
  const [hideTypingStatus, setHideTypingStatus] = useSetting(settingsAtom, 'hideTypingStatus');
  const [hideOthersReadReceipts, setHideOthersReadReceipts] = useSetting(
    settingsAtom,
    'hideOthersReadReceipts',
  );
  const [hideOthersTypingStatus, setHideOthersTypingStatus] = useSetting(
    settingsAtom,
    'hideOthersTypingStatus',
  );
  const [readReceiptStyle, setReadReceiptStyle] = useSetting(settingsAtom, 'readReceiptStyle');
  const [useVxTwitter, setUseVxTwitter] = useSetting(settingsAtom, 'useVxTwitter');
  const [useSoundcloak, setUseSoundcloak] = useSetting(settingsAtom, 'useSoundcloak');
  const [useBlueskyEmbeds, setUseBlueskyEmbeds] = useSetting(settingsAtom, 'useBlueskyEmbeds');
  const [useRule34Embeds, setUseRule34Embeds] = useSetting(settingsAtom, 'useRule34Embeds');
  const [useRedditEmbeds, setUseRedditEmbeds] = useSetting(settingsAtom, 'useRedditEmbeds');
  const [useHackerNewsEmbeds, setUseHackerNewsEmbeds] = useSetting(
    settingsAtom,
    'useHackerNewsEmbeds',
  );
  const [usePiped, setUsePiped] = useSetting(settingsAtom, 'usePiped');
  const [renderMaths, setRenderMaths] = useSetting(settingsAtom, 'renderMaths');
  const [showMaps, setShowMaps] = useSetting(settingsAtom, 'showMaps');
  const [renderBotKeyboards, setRenderBotKeyboards] = useSetting(
    settingsAtom,
    'renderBotKeyboards',
  );
  const [confirmBotUrls, setConfirmBotUrls] = useSetting(settingsAtom, 'confirmBotUrls');
  const [clientPreviewFallback, setClientPreviewFallback] = useSetting(
    settingsAtom,
    'clientPreviewFallback',
  );
  const [minimizeToTray, setMinimizeToTray] = useSetting(settingsAtom, 'minimizeToTray');
  const autostart = useAutostart();

  return (
    <Box direction="Column" gap="100">
      <Text size="L400">Editor</Text>
      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title="ENTER for Newline"
          description={`Use ${
            isMacOS() ? KeySymbol.Command : 'Ctrl'
          } + ENTER to send message and ENTER for newline.`}
          after={<Switch variant="Primary" value={enterForNewline} onChange={setEnterForNewline} />}
        />
      </SequenceCard>
      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title="Scroll to Bottom on Send"
          description="When you send a message while scrolled up, jump back down to the live timeline so your message comes into view."
          after={<Switch variant="Primary" value={scrollOnSend} onChange={setScrollOnSend} />}
        />
      </SequenceCard>
      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title="Disable Spellcheck"
          description="Stop underlining misspelled words in the message box and other text fields."
          after={
            <Switch variant="Primary" value={disableSpellcheck} onChange={setDisableSpellcheck} />
          }
        />
      </SequenceCard>
      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title="Markdown Formatting"
          after={<Switch variant="Primary" value={isMarkdown} onChange={setIsMarkdown} />}
        />
      </SequenceCard>
      {isMarkdown && (
        <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
          <SettingTile
            title="Discord Markdown"
            description="Write markdown the way Discord reads it: headings stop at ###, a quote needs a space after >, >>> quotes the rest of the message, -# makes small text, * and _ italics skip 2 * 3 and snake_case, and <link> hides the brackets. Enter inside an unclosed ``` block adds a line. Other apps see the result, for example -# arrives as subscript."
            after={
              <Switch variant="Primary" value={discordMarkdown} onChange={setDiscordMarkdown} />
            }
          />
        </SequenceCard>
      )}
      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title="Don't Send My Read Receipts"
          description="Send your read receipts privately, so nobody is told how far you have read. You still see everyone else's."
          after={
            <Switch variant="Primary" value={hideReadReceipts} onChange={setHideReadReceipts} />
          }
        />
      </SequenceCard>
      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title="Don't Send My Typing Notifications"
          description="Stop telling rooms when you are composing a message. You still see everyone else's."
          after={
            <Switch variant="Primary" value={hideTypingStatus} onChange={setHideTypingStatus} />
          }
        />
      </SequenceCard>
      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title="Hide Other People's Read Receipts"
          description="Stop showing who has read up to where. Independent of whether you send your own."
          after={
            <Switch
              variant="Primary"
              value={hideOthersReadReceipts}
              onChange={setHideOthersReadReceipts}
            />
          }
        />
      </SequenceCard>
      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title="Hide Other People's Typing Notifications"
          description="Stop showing the “X is typing…” line under the conversation."
          after={
            <Switch
              variant="Primary"
              value={hideOthersTypingStatus}
              onChange={setHideOthersTypingStatus}
            />
          }
        />
      </SequenceCard>
      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title="Read Receipt Style"
          description="Default shows who's following live. Element shows avatar dots at each person's last-read message."
          after={
            <Box gap="100">
              <Button
                size="300"
                variant={readReceiptStyle === 'cinny' ? 'Primary' : 'Secondary'}
                fill={readReceiptStyle === 'cinny' ? 'Solid' : 'None'}
                radii="Pill"
                onClick={() => setReadReceiptStyle('cinny')}
              >
                <Text size="T300">Default</Text>
              </Button>
              <Button
                size="300"
                variant={readReceiptStyle === 'element' ? 'Primary' : 'Secondary'}
                fill={readReceiptStyle === 'element' ? 'Solid' : 'None'}
                radii="Pill"
                onClick={() => setReadReceiptStyle('element')}
              >
                <Text size="T300">Element</Text>
              </Button>
            </Box>
          }
        />
      </SequenceCard>
      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title="Show Maps for Locations"
          description="Draw location messages as a map. Every map fetches tiles from whoever serves the map style, disclosing your IP address and what you are looking at."
          after={<Switch variant="Primary" value={showMaps} onChange={setShowMaps} />}
        />
      </SequenceCard>
      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title="Show Bot Buttons"
          description="Draw the buttons bots attach to their messages. Turn this off and the message's plain-text list of options is shown instead, which bots send anyway."
          after={
            <Switch variant="Primary" value={renderBotKeyboards} onChange={setRenderBotKeyboards} />
          }
        />
      </SequenceCard>
      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title="Confirm Bot Links"
          description="Ask before opening a link from a bot's button, showing the site it really goes to. The button's label is written by whoever sent it; the address is not."
          after={<Switch variant="Primary" value={confirmBotUrls} onChange={setConfirmBotUrls} />}
        />
      </SequenceCard>
      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title="Render LaTeX Maths"
          description="Draw formulas sent as LaTeX instead of showing the sender's plain-text fallback."
          after={<Switch variant="Primary" value={renderMaths} onChange={setRenderMaths} />}
        />
      </SequenceCard>
      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title="Use vxtwitter for Twitter/X"
          description="Fetch Twitter/X media client-side via vxtwitter API for full video and image embeds. Sends the link and your IP address to that third-party service."
          after={<Switch variant="Primary" value={useVxTwitter} onChange={setUseVxTwitter} />}
        />
      </SequenceCard>
      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title="Use soundcloak for SoundCloud"
          description="Rewrite SoundCloud URLs through sc1.maid.zone for streamable embeds. Sends the link and your IP address to that third-party service."
          after={<Switch variant="Primary" value={useSoundcloak} onChange={setUseSoundcloak} />}
        />
      </SequenceCard>
      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title="Bluesky post embeds"
          description="Fetch Bluesky posts client-side to show full embeds. Sends the link and your IP address to public.api.bsky.app, and lets the sender of a link see when you view it."
          after={
            <Switch variant="Primary" value={useBlueskyEmbeds} onChange={setUseBlueskyEmbeds} />
          }
        />
      </SequenceCard>
      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title="Rule34 post embeds"
          description="Show a linked rule34.xxx post's own image, GIF or video inline instead of the site's link card. Sends the post number and your IP address to api.rule34.xxx, and lets the sender of a link see when you view it. Requests carry this app's shared API key — rule34 has no keyless API."
          after={<Switch variant="Primary" value={useRule34Embeds} onChange={setUseRule34Embeds} />}
        />
      </SequenceCard>
      {/* The app fetches the post itself; a browser cannot read Reddit and goes
          through vxreddit.com instead. See utils/reddit. */}
      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title="Reddit post embeds"
          description={
            isTauri()
              ? "Play a linked Reddit post's video, or show its image or gallery, inline instead of the site's link card. Sends the post number and your IP address to embed.reddit.com, and lets the sender of a link see when you view it."
              : "Play a linked Reddit post's video, or show its image, inline instead of the site's link card. Asks vxreddit.com for the post — from this browser where it allows that (Firefox, which also gets whole galleries), otherwise through your homeserver's link preview. Videos stream from v.redd.it with your IP address, and the sender of a link can see when you view it."
          }
          after={<Switch variant="Primary" value={useRedditEmbeds} onChange={setUseRedditEmbeds} />}
        />
      </SequenceCard>
      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title="Hacker News post embeds"
          description="Build Hacker News cards from the Hacker News API, which serves no link preview of its own. Sends the item number and your IP address to hacker-news.firebaseio.com, and lets the sender of a link see when you view it."
          after={
            <Switch
              variant="Primary"
              value={useHackerNewsEmbeds}
              onChange={setUseHackerNewsEmbeds}
            />
          }
        />
      </SequenceCard>
      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title="Use Piped for YouTube"
          description="Replace YouTube embeds with a Piped instance for privacy-friendly playback."
          after={<Switch variant="Primary" value={usePiped} onChange={setUsePiped} />}
        />
        {usePiped && (
          <SettingTile
            title="Piped instance"
            description="Which Piped instance to embed from. Auto probes the list and uses the first that responds; http instances only load in the desktop app (the web app blocks them as mixed content)."
            after={<SelectPipedInstance />}
          />
        )}
      </SequenceCard>
      {isTauri() && (
        <>
          <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
            <SettingTile
              title="Minimize to Tray"
              description="When closing the window, hide to system tray instead of quitting."
              after={
                <Switch variant="Primary" value={minimizeToTray} onChange={setMinimizeToTray} />
              }
            />
          </SequenceCard>
          {autostart.enabled !== undefined && (
            <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
              <SettingTile
                title="Start at Login"
                description="Launch minimized to the tray when you sign in to this computer."
                after={
                  <Switch
                    variant="Primary"
                    value={autostart.enabled}
                    disabled={autostart.busy}
                    onChange={autostart.toggle}
                  />
                }
              />
              {autostart.error && (
                <Text size="T200" style={{ color: color.Critical.Main }}>
                  {autostart.error}
                </Text>
              )}
            </SequenceCard>
          )}
          <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
            <SettingTile
              title="Client-side link previews (fallback)"
              description="When your homeserver can't generate a link preview, fetch the page directly from this app to build the card. Helps sites that block your homeserver's preview fetcher. Requests are guarded against private/internal addresses."
              after={
                <Switch
                  variant="Primary"
                  value={clientPreviewFallback}
                  onChange={setClientPreviewFallback}
                />
              }
            />
          </SequenceCard>
        </>
      )}
    </Box>
  );
}

function SelectMessageLayout() {
  const [menuCords, setMenuCords] = useState<RectCords>();
  const [messageLayout, setMessageLayout] = useSetting(settingsAtom, 'messageLayout');
  const messageLayoutItems = useMessageLayoutItems();

  const handleMenu: MouseEventHandler<HTMLButtonElement> = (evt) => {
    setMenuCords(evt.currentTarget.getBoundingClientRect());
  };

  const handleSelect = (layout: MessageLayout) => {
    setMessageLayout(layout);
    setMenuCords(undefined);
  };

  return (
    <>
      <Button
        size="300"
        variant="Secondary"
        outlined
        fill="Soft"
        radii="300"
        after={<Icon size="300" src={Icons.ChevronBottom} />}
        onClick={handleMenu}
      >
        <Text size="T300">
          {messageLayoutItems.find((i) => i.layout === messageLayout)?.name ?? messageLayout}
        </Text>
      </Button>
      <PopOut
        anchor={menuCords}
        offset={5}
        position="Bottom"
        align="End"
        content={
          <FocusTrap
            focusTrapOptions={{
              initialFocus: false,
              onDeactivate: () => setMenuCords(undefined),
              clickOutsideDeactivates: true,
              isKeyForward: (evt: KeyboardEvent) =>
                evt.key === 'ArrowDown' || evt.key === 'ArrowRight',
              isKeyBackward: (evt: KeyboardEvent) =>
                evt.key === 'ArrowUp' || evt.key === 'ArrowLeft',
              escapeDeactivates: stopPropagation,
            }}
          >
            <Menu>
              <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
                {messageLayoutItems.map((item) => (
                  <MenuItem
                    key={item.layout}
                    size="300"
                    variant={messageLayout === item.layout ? 'Primary' : 'Surface'}
                    radii="300"
                    onClick={() => handleSelect(item.layout)}
                  >
                    <Text size="T300">{item.name}</Text>
                  </MenuItem>
                ))}
              </Box>
            </Menu>
          </FocusTrap>
        }
      />
    </>
  );
}

function SelectMessageSpacing() {
  const [menuCords, setMenuCords] = useState<RectCords>();
  const [messageSpacing, setMessageSpacing] = useSetting(settingsAtom, 'messageSpacing');
  const messageSpacingItems = useMessageSpacingItems();

  const handleMenu: MouseEventHandler<HTMLButtonElement> = (evt) => {
    setMenuCords(evt.currentTarget.getBoundingClientRect());
  };

  const handleSelect = (layout: MessageSpacing) => {
    setMessageSpacing(layout);
    setMenuCords(undefined);
  };

  return (
    <>
      <Button
        size="300"
        variant="Secondary"
        outlined
        fill="Soft"
        radii="300"
        after={<Icon size="300" src={Icons.ChevronBottom} />}
        onClick={handleMenu}
      >
        <Text size="T300">
          {messageSpacingItems.find((i) => i.spacing === messageSpacing)?.name ?? messageSpacing}
        </Text>
      </Button>
      <PopOut
        anchor={menuCords}
        offset={5}
        position="Bottom"
        align="End"
        content={
          <FocusTrap
            focusTrapOptions={{
              initialFocus: false,
              onDeactivate: () => setMenuCords(undefined),
              clickOutsideDeactivates: true,
              isKeyForward: (evt: KeyboardEvent) =>
                evt.key === 'ArrowDown' || evt.key === 'ArrowRight',
              isKeyBackward: (evt: KeyboardEvent) =>
                evt.key === 'ArrowUp' || evt.key === 'ArrowLeft',
              escapeDeactivates: stopPropagation,
            }}
          >
            <Menu>
              <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
                {messageSpacingItems.map((item) => (
                  <MenuItem
                    key={item.spacing}
                    size="300"
                    variant={messageSpacing === item.spacing ? 'Primary' : 'Surface'}
                    radii="300"
                    onClick={() => handleSelect(item.spacing)}
                  >
                    <Text size="T300">{item.name}</Text>
                  </MenuItem>
                ))}
              </Box>
            </Menu>
          </FocusTrap>
        }
      />
    </>
  );
}

function Messages() {
  const [legacyUsernameColor, setLegacyUsernameColor] = useSetting(
    settingsAtom,
    'legacyUsernameColor',
  );
  const [hideMembershipEvents, setHideMembershipEvents] = useSetting(
    settingsAtom,
    'hideMembershipEvents',
  );
  const [hideNickAvatarEvents, setHideNickAvatarEvents] = useSetting(
    settingsAtom,
    'hideNickAvatarEvents',
  );
  const [groupMembershipEvents, setGroupMembershipEvents] = useSetting(
    settingsAtom,
    'groupMembershipEvents',
  );
  const [mediaAutoLoad, setMediaAutoLoad] = useSetting(settingsAtom, 'mediaAutoLoad');
  const [mediaFeedViewer, setMediaFeedViewer] = useSetting(settingsAtom, 'mediaFeedViewer');
  const [galleryUploads, setGalleryUploads] = useSetting(settingsAtom, 'galleryUploads');
  const [urlPreview, setUrlPreview] = useSetting(settingsAtom, 'urlPreview');
  const [encUrlPreview, setEncUrlPreview] = useSetting(settingsAtom, 'encUrlPreview');
  const [showHiddenEvents, setShowHiddenEvents] = useSetting(settingsAtom, 'showHiddenEvents');
  const [showAllTimestamps, setShowAllTimestamps] = useSetting(settingsAtom, 'showAllTimestamps');
  const [searchOperators, setSearchOperators] = useSetting(settingsAtom, 'searchOperators');
  const [dimSendingBodyOnly, setDimSendingBodyOnly] = useSetting(
    settingsAtom,
    'dimSendingBodyOnly',
  );

  return (
    <Box direction="Column" gap="100">
      <Text size="L400">Messages</Text>
      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile title="Message Layout" after={<SelectMessageLayout />} />
      </SequenceCard>
      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile title="Message Spacing" after={<SelectMessageSpacing />} />
      </SequenceCard>
      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title="Legacy Username Color"
          after={
            <Switch
              variant="Primary"
              value={legacyUsernameColor}
              onChange={setLegacyUsernameColor}
            />
          }
        />
      </SequenceCard>
      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title="Hide Membership Change"
          after={
            <Switch
              variant="Primary"
              value={hideMembershipEvents}
              onChange={setHideMembershipEvents}
            />
          }
        />
      </SequenceCard>
      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title="Hide Profile Change"
          after={
            <Switch
              variant="Primary"
              value={hideNickAvatarEvents}
              onChange={setHideNickAvatarEvents}
            />
          }
        />
      </SequenceCard>
      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title="Group Membership Changes"
          description="Collapse several joins, leaves and profile changes in a row into one expandable summary line. Needs membership changes to be shown."
          after={
            <Switch
              variant="Primary"
              disabled={hideMembershipEvents}
              value={groupMembershipEvents}
              onChange={setGroupMembershipEvents}
            />
          }
        />
      </SequenceCard>
      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title="Disable Media Auto Load"
          after={
            <Switch
              variant="Primary"
              value={!mediaAutoLoad}
              onChange={(v) => setMediaAutoLoad(!v)}
            />
          }
        />
      </SequenceCard>
      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title="Open Media in Feed"
          description="Tapping a photo or video opens the room's media feed at it — swipe up for the next attachment. Off opens the single-image viewer instead."
          after={<Switch variant="Primary" value={mediaFeedViewer} onChange={setMediaFeedViewer} />}
        />
      </SequenceCard>
      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title="Send Attachments as a Gallery"
          description="Several files sent at once become one message with a grid of them (MSC4274) instead of one message each. The msgtype is still unstable, so clients that have not implemented it show only the filenames — galleries you receive always render either way."
          after={<Switch variant="Primary" value={galleryUploads} onChange={setGalleryUploads} />}
        />
      </SequenceCard>
      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title="Url Preview"
          after={<Switch variant="Primary" value={urlPreview} onChange={setUrlPreview} />}
        />
      </SequenceCard>
      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title="Url Preview in Encrypted Room"
          after={<Switch variant="Primary" value={encUrlPreview} onChange={setEncUrlPreview} />}
        />
      </SequenceCard>
      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title="Show Hidden Events"
          after={
            <Switch variant="Primary" value={showHiddenEvents} onChange={setShowHiddenEvents} />
          }
        />
      </SequenceCard>
      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title="Fade Only the Text While Sending"
          description="A message on its way fades just its content; the name, time and sending clock stay at full strength. Off fades the whole message."
          after={
            <Switch variant="Primary" value={dimSendingBodyOnly} onChange={setDimSendingBodyOnly} />
          }
        />
      </SequenceCard>
      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title="Show All Timestamps"
          description="Show the time beside every message in a group, not only the first one. Compact layout already does."
          after={
            <Switch variant="Primary" value={showAllTimestamps} onChange={setShowAllTimestamps} />
          }
        />
      </SequenceCard>
      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title="Search Operators"
          description="Narrow message search with from:name, in:room, mentions:name, has:link/image/video/audio/file, before:, after: and during: (YYYY-MM-DD, today, yesterday), and pinned:true."
          after={<Switch variant="Primary" value={searchOperators} onChange={setSearchOperators} />}
        />
      </SequenceCard>
    </Box>
  );
}

type GeneralProps = {
  requestClose: () => void;
};
/**
 * Settings for the features ported from largelanguagemeowing/cinny. Grouped
 * together and off by default: each one changes a layout or a habit that
 * already works, so it is opted into rather than sprung on an existing install.
 */
function ForkFeatures() {
  const [unifiedHomeSidebar, setUnifiedHomeSidebar] = useSetting(
    settingsAtom,
    'unifiedHomeSidebar',
  );
  const [dmRailButtons, setDmRailButtons] = useSetting(settingsAtom, 'dmRailButtons');
  const [topBar, setTopBar] = useSetting(settingsAtom, 'topBar');
  const [topBarProfile, setTopBarProfile] = useSetting(settingsAtom, 'topBarProfile');
  const [presencePicker, setPresencePicker] = useSetting(settingsAtom, 'presencePicker');
  const [roomsPseudoSpace, setRoomsPseudoSpace] = useSetting(settingsAtom, 'roomsPseudoSpace');
  const [gifPicker, setGifPicker] = useSetting(settingsAtom, 'gifPicker');
  const [gifProvider] = useSetting(settingsAtom, 'gifProvider');
  const { gifApiKeys } = useClientConfig();
  const gifProviderId = resolveGifSource(gifProvider, gifApiKeys).id;
  const gifProviderHost = GIF_PROVIDERS.find((p) => p.id === gifProviderId)?.host ?? 'klipy.com';
  const [emojiMashup, setEmojiMashup] = useSetting(settingsAtom, 'emojiMashup');
  const [lowAnimationMode, setLowAnimationMode] = useSetting(settingsAtom, 'lowAnimationMode');
  const [showRichPresence, setShowRichPresence] = useSetting(settingsAtom, 'showRichPresence');
  const [idleAway, setIdleAway] = useSetting(settingsAtom, 'idleAway');
  const [idlePausesReadReceipts, setIdlePausesReadReceipts] = useSetting(
    settingsAtom,
    'idlePausesReadReceipts',
  );
  const [emojiShortcodeReplace, setEmojiShortcodeReplace] = useSetting(
    settingsAtom,
    'emojiShortcodeReplace',
  );
  const [autoJoinSpaceRooms, setAutoJoinSpaceRooms] = useSetting(
    settingsAtom,
    'autoJoinSpaceRooms',
  );
  const [autoEmbedHosts, setAutoEmbedHosts] = useSetting(settingsAtom, 'mediaAutoEmbedHosts');
  const [callNavActivity, setCallNavActivity] = useSetting(settingsAtom, 'callNavActivity');
  const [dmCallSplit, setDmCallSplit] = useSetting(settingsAtom, 'dmCallSplit');
  const [callVoicePanel, setCallVoicePanel] = useSetting(settingsAtom, 'callVoicePanel');
  const [callControlsRedesign, setCallControlsRedesign] = useSetting(
    settingsAtom,
    'callControlsRedesign',
  );

  const handleAutoEmbedHostsChange: ChangeEventHandler<HTMLInputElement> = (evt) => {
    // Normalising here rather than at match time means a pasted URL or a stray
    // capital is stored as the hostname the comparison actually expects.
    setAutoEmbedHosts(
      evt.currentTarget.value
        .split(',')
        .map(normalizeAutoEmbedHost)
        .filter((host): host is string => host !== undefined),
    );
  };

  return (
    <Box direction="Column" gap="100">
      <Text size="L400">Layout</Text>
      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title="Unified Home Sidebar"
          description="List direct messages and spaceless rooms together in one Home slot instead of two tabs."
          after={
            <Switch variant="Primary" value={unifiedHomeSidebar} onChange={setUnifiedHomeSidebar} />
          }
        />
      </SequenceCard>
      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title="Direct Message Rail Buttons"
          description="Show unread direct messages as avatar buttons under Home in the client rail."
          after={<Switch variant="Primary" value={dmRailButtons} onChange={setDmRailButtons} />}
        />
      </SequenceCard>
      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title="Top Bar"
          description="A full-width bar above the sidebar carrying the inbox."
          after={<Switch variant="Primary" value={topBar} onChange={setTopBar} />}
        />
      </SequenceCard>
      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title="Profile Controls in Top Bar"
          description="Move your avatar and status controls into the top bar. Needs the top bar."
          after={
            <Switch
              variant="Primary"
              disabled={!topBar}
              value={topBarProfile}
              onChange={setTopBarProfile}
            />
          }
        />
      </SequenceCard>
      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title="Profile Menu"
          description="Click your profile in the top bar for your card, an Online / Away / Invisible picker, Edit Profile and Copy User ID. Needs profile controls in the top bar."
          after={
            <Switch
              variant="Primary"
              disabled={!topBar || !topBarProfile}
              value={presencePicker}
              onChange={setPresencePicker}
            />
          }
        />
      </SequenceCard>
      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title="Default Inbox Tab"
          description="Which tab the Inbox opens on, from the sidebar or from its own address."
          after={<SelectDefaultInboxTab />}
        />
      </SequenceCard>
      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title="Rooms Space"
          description="Give spaceless rooms their own entry in the space rail. Home then lists your direct messages."
          after={
            <Switch variant="Primary" value={roomsPseudoSpace} onChange={setRoomsPseudoSpace} />
          }
        />
      </SequenceCard>

      <Text size="L400">Media</Text>
      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title="GIF Picker"
          description={`Add a GIF tab to the emoji board. Searches are sent to ${gifProviderHost}, which sees your IP and your query.`}
          after={<Switch variant="Primary" value={gifPicker} onChange={setGifPicker} />}
        />
        {gifPicker && (
          <SettingTile
            title="GIF Provider"
            description="Tenor and Giphy are offered when this deployment has an API key for them."
            after={<SelectGifProvider />}
          />
        )}
      </SequenceCard>
      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title="Emoji Mashup"
          description="Add a Mashup tab to the emoji board: Google's Emoji Kitchen, 147,000 hand-drawn combinations of 619 emoji. Thumbnails load from gstatic.com, which sees your IP and which emoji you browse."
          after={<Switch variant="Primary" value={emojiMashup} onChange={setEmojiMashup} />}
        />
      </SequenceCard>
      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title="Low Animation Mode"
          description="Stop media autoplaying — hover to play — and disable interface animation."
          after={
            <Switch variant="Primary" value={lowAnimationMode} onChange={setLowAnimationMode} />
          }
        />
      </SequenceCard>
      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title="Inline Video Hosts"
          description="Comma-separated hosts whose direct video links play in place instead of showing a preview card. Empty means none — a video plays only from a host you name here."
        >
          <Input
            variant="Secondary"
            radii="300"
            defaultValue={autoEmbedHosts.join(', ')}
            placeholder="example.com, files.example.org"
            onChange={handleAutoEmbedHostsChange}
          />
        </SettingTile>
      </SequenceCard>

      <Text size="L400">Presence</Text>
      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title="Show Rich Presence"
          description="Show what other people are listening to or playing, when they publish it."
          after={
            <Switch variant="Primary" value={showRichPresence} onChange={setShowRichPresence} />
          }
        />
      </SequenceCard>
      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title="Away When Idle"
          description="Show as away after 5 minutes without mouse, keyboard or touch input in Prinny, and online again when you return. A presence you set yourself is left alone."
          after={<Switch variant="Primary" value={idleAway} onChange={setIdleAway} />}
        />
      </SequenceCard>
      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title="Pause Read Receipts When Idle"
          description="After the same 5 minutes, stop marking new messages as read until you return, even if Prinny is still open on that room."
          after={
            <Switch
              variant="Primary"
              value={idlePausesReadReceipts}
              onChange={setIdlePausesReadReceipts}
            />
          }
        />
      </SequenceCard>

      <Text size="L400">Composer</Text>
      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title="Replace Emoji Shortcodes"
          description="Turn :shortcode: into an emoji as you type, without the autocomplete menu."
          after={
            <Switch
              variant="Primary"
              value={emojiShortcodeReplace}
              onChange={setEmojiShortcodeReplace}
            />
          }
        />
      </SequenceCard>

      <Text size="L400">Spaces</Text>
      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title="Auto Join Space Rooms"
          description="Join every room a space lists, including rooms added later. A large space means many joins."
          after={
            <Switch variant="Primary" value={autoJoinSpaceRooms} onChange={setAutoJoinSpaceRooms} />
          }
        />
      </SequenceCard>

      <Text size="L400">Calls</Text>
      <SequenceCard className={SequenceCardStyle} variant="SurfaceVariant" direction="Column">
        <SettingTile
          title="Call Activity in Room List"
          description="In the call you have joined, ring the avatar of whoever is speaking and tag screen sharers LIVE in the room list."
          after={<Switch variant="Primary" value={callNavActivity} onChange={setCallNavActivity} />}
        />
        <SettingTile
          title="Keep Chat Open in DM Calls"
          description="In a direct message, show the call above the conversation with a draggable divider instead of replacing it."
          after={<Switch variant="Primary" value={dmCallSplit} onChange={setDmCallSplit} />}
        />
        <SettingTile
          title="Voice Panel in Room List"
          description="Show the current call at the bottom of the room list, with its controls, instead of in a bar under the window. Call rooms with people in them turn green."
          after={<Switch variant="Primary" value={callVoicePanel} onChange={setCallVoicePanel} />}
        />
        <SettingTile
          title="Redesigned Call Controls"
          description="Grouped call buttons with invite and full screen, a black call background, a header that names who is sharing their screen, and controls that fade after a few idle seconds."
          after={
            <Switch
              variant="Primary"
              value={callControlsRedesign}
              onChange={setCallControlsRedesign}
            />
          }
        />
      </SequenceCard>
    </Box>
  );
}

export function General({ requestClose }: GeneralProps) {
  return (
    <Page>
      <PageHeader outlined={false}>
        <Box grow="Yes" gap="200">
          <Box grow="Yes" alignItems="Center" gap="200">
            <Text size="H3" truncate>
              General
            </Text>
          </Box>
          <Box shrink="No">
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
                <Appearance />
                <CustomCssSettings />
                <DateAndTime />
                <Editor />
                <Messages />
                <AudioSettings />
                <ForkFeatures />
                <PrivacySettings />
              </Box>
            </PageContentCenter>
          </PageContent>
        </Scroll>
      </Box>
    </Page>
  );
}

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Avatar,
  Box,
  Button,
  config,
  Icon,
  IconButton,
  Icons,
  IconSrc,
  MenuItem,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Scroll,
  Text,
} from 'folds';
import { FocusTrap } from 'focus-trap-react';
import { General } from './general';
import { PageNav, PageNavHeader, PageRoot } from '../../components/page';
import { ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import { useSwipeGesture } from '../../hooks/useSwipeGesture';
import { BackDismissResult, useBackDismiss } from '../../hooks/useBackDismiss';
import { Account } from './account';
import { useUserProfile } from '../../hooks/useUserProfile';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { getMxIdLocalPart, mxcUrlToHttp } from '../../utils/matrix';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { UserAvatar } from '../../components/user-avatar';
import { nameInitials } from '../../utils/common';
import { Notifications } from './notifications';
import { Devices } from './devices';
import { EmojisStickers } from './emojis-stickers';
import { DeveloperTools } from './developer-tools';
import { About } from './about';
import { Keybinds } from './keybinds/Keybinds';
import { UseStateProvider } from '../../components/UseStateProvider';
import { stopPropagation } from '../../utils/keyboard';
import { LogoutDialog } from '../../components/LogoutDialog';
import * as settingsCss from './styles.css';

export enum SettingsPages {
  GeneralPage,
  AccountPage,
  NotificationPage,
  DevicesPage,
  EmojisStickersPage,
  DeveloperToolsPage,
  KeybindsPage,
  AboutPage,
}

type SettingsMenuItem = {
  page: SettingsPages;
  name: string;
  icon: IconSrc;
};

const useSettingsMenuItems = (): SettingsMenuItem[] => {
  const isMobile = useScreenSizeContext() === ScreenSize.Mobile;
  return useMemo(
    () => [
      {
        page: SettingsPages.GeneralPage,
        name: 'General',
        icon: Icons.Setting,
      },
      {
        page: SettingsPages.AccountPage,
        name: 'Account',
        icon: Icons.User,
      },
      {
        page: SettingsPages.NotificationPage,
        name: 'Notifications',
        icon: Icons.Bell,
      },
      {
        page: SettingsPages.DevicesPage,
        name: 'Devices',
        icon: Icons.Monitor,
      },
      {
        page: SettingsPages.EmojisStickersPage,
        name: 'Emojis & Stickers',
        icon: Icons.Smile,
      },
      {
        page: SettingsPages.DeveloperToolsPage,
        name: 'Developer Tools',
        icon: Icons.Terminal,
      },
      // Keybinds are physical-keyboard-only — hide on mobile entirely.
      ...(isMobile
        ? []
        : [
            {
              page: SettingsPages.KeybindsPage,
              name: 'Keybinds',
              icon: Icons.Alphabet,
            },
          ]),
      {
        page: SettingsPages.AboutPage,
        name: 'About',
        icon: Icons.Info,
      },
    ],
    [isMobile],
  );
};

type SettingsProps = {
  initialPage?: SettingsPages;
  requestClose: () => void;
};
export function Settings({ initialPage, requestClose }: SettingsProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const userId = mx.getUserId()!;
  const profile = useUserProfile(userId);
  const displayName = profile.displayName ?? getMxIdLocalPart(userId) ?? userId;
  const avatarUrl = profile.avatarUrl
    ? (mxcUrlToHttp(mx, profile.avatarUrl, useAuthentication, 96, 96, 'crop') ?? undefined)
    : undefined;

  const screenSize = useScreenSizeContext();
  const [activePage, setActivePage] = useState<SettingsPages | undefined>(() => {
    if (initialPage) return initialPage;
    return screenSize === ScreenSize.Mobile ? undefined : SettingsPages.GeneralPage;
  });
  const menuItems = useSettingsMenuItems();
  const swipeRef = useRef<HTMLDivElement>(null);

  const handlePageRequestClose = () => {
    if (screenSize === ScreenSize.Mobile) {
      setActivePage(undefined);
      return;
    }
    requestClose();
  };

  // One step "back" out of Settings, whichever gesture asked for it. On a
  // mobile subpage that means returning to the menu list (matching the
  // per-page X behavior); anywhere else it closes the dialog.
  const handleBack = useCallback((): BackDismissResult => {
    if (screenSize === ScreenSize.Mobile && activePage !== undefined) {
      setActivePage(undefined);
      return 'consumed';
    }
    requestClose();
    return 'closed';
  }, [screenSize, activePage, requestClose]);

  // The system Back gesture and Back button. On Android in gesture-nav mode the
  // left-edge swipe below never happens: the system claims those touches for
  // its own back gesture and hands the WebView a history pop instead, so
  // without this the swipe appeared to do nothing while quietly moving the
  // route behind the dialog. See useBackDismiss for the mechanism.
  useBackDismiss(handleBack);

  // Mobile: left-to-right swipe acts as the X button. Still the only thing that
  // works on a device with three-button navigation, where nothing claims the
  // edge and there is no back gesture to intercept.
  const handleSwipeBack = useCallback(() => {
    if (screenSize !== ScreenSize.Mobile) return;
    handleBack();
  }, [screenSize, handleBack]);

  // NOTE: no commitOffset here. The nav swipes (MobileSwipeBack/Open) slide
  // their element fully off-screen on commit and rely on a route change to
  // unmount it. Settings, however, handles subpage→menu navigation *in place*
  // (setActivePage, no unmount), so an off-screen slide would leave this
  // container stuck translated out of view — a softlock. Snapping back to 0
  // (commitOffset 0) lets the content swap underneath while staying on screen;
  // the modal's own close animation covers the menu→close case.
  //
  // Edge-initiated here, unlike the nav swipes, which take a drag starting
  // anywhere on the screen.
  //
  // That works for the room and the room list: they are near enough full-screen
  // reading surfaces, so a horizontal drag across one means nothing else and
  // may as well mean "back". Settings is the opposite — it is dense with
  // controls, and a swipe-from-anywhere makes every horizontal movement over
  // one of them a navigation, which is how you end up leaving the page you were
  // trying to adjust. Requiring the gesture to start at the left edge is both
  // the Android convention and the thing that stops a control from being able
  // to trigger it at all.
  //
  // `edgeWidth` is wider than the 32px default on purpose: in gesture-nav mode
  // Android reserves roughly the outer 24-48dp for its own back gesture and
  // those touches never reach the WebView, so a narrow region here would be
  // mostly swallowed by the system before it could match.
  useSwipeGesture(swipeRef, {
    edge: 'left',
    edgeWidth: 48,
    threshold: 80,
    onSwipe: handleSwipeBack,
    trackElement: swipeRef,
  });

  return (
    <div
      ref={swipeRef}
      style={{
        flex: '1 1 0%',
        minWidth: 0,
        minHeight: 0,
        display: 'flex',
        touchAction: 'pan-y',
      }}
    >
      <PageRoot
        nav={
          screenSize === ScreenSize.Mobile && activePage !== undefined ? undefined : (
            <PageNav size="300">
              <PageNavHeader outlined={false}>
                <Box grow="Yes" gap="200">
                  <Avatar size="200" radii="300">
                    <UserAvatar
                      userId={userId}
                      src={avatarUrl}
                      renderFallback={() => <Text size="H6">{nameInitials(displayName)}</Text>}
                    />
                  </Avatar>
                  <Text size="H4" truncate>
                    Settings
                  </Text>
                </Box>
                <Box shrink="No">
                  {screenSize === ScreenSize.Mobile && (
                    <IconButton onClick={requestClose} variant="Background">
                      <Icon src={Icons.Cross} />
                    </IconButton>
                  )}
                </Box>
              </PageNavHeader>
              <Box grow="Yes" direction="Column">
                <Scroll hideTrack visibility="Hover" variant="Background" size="300">
                  <div className={settingsCss.SettingsMobileMenu}>
                    {menuItems.map((item) => (
                      <MenuItem
                        key={item.name}
                        variant="Background"
                        radii="400"
                        aria-pressed={activePage === item.page}
                        before={
                          <Icon src={item.icon} size="100" filled={activePage === item.page} />
                        }
                        onClick={() => setActivePage(item.page)}
                      >
                        <Text
                          style={{
                            fontWeight:
                              activePage === item.page ? config.fontWeight.W600 : undefined,
                          }}
                          size="T300"
                          truncate
                        >
                          {item.name}
                        </Text>
                      </MenuItem>
                    ))}
                  </div>
                </Scroll>
                <Box style={{ padding: config.space.S200 }} shrink="No" direction="Column">
                  <UseStateProvider initial={false}>
                    {(logout, setLogout) => (
                      <>
                        <Button
                          size="300"
                          variant="Critical"
                          fill="None"
                          radii="Pill"
                          before={<Icon src={Icons.Power} size="100" />}
                          onClick={() => setLogout(true)}
                        >
                          <Text size="B400">Logout</Text>
                        </Button>
                        {logout && (
                          <Overlay open backdrop={<OverlayBackdrop />}>
                            <OverlayCenter>
                              <FocusTrap
                                focusTrapOptions={{
                                  onDeactivate: () => setLogout(false),
                                  clickOutsideDeactivates: true,
                                  escapeDeactivates: stopPropagation,
                                }}
                              >
                                <LogoutDialog handleClose={() => setLogout(false)} />
                              </FocusTrap>
                            </OverlayCenter>
                          </Overlay>
                        )}
                      </>
                    )}
                  </UseStateProvider>
                </Box>
              </Box>
            </PageNav>
          )
        }
      >
        {activePage === SettingsPages.GeneralPage && (
          <General requestClose={handlePageRequestClose} />
        )}
        {activePage === SettingsPages.AccountPage && (
          <Account requestClose={handlePageRequestClose} />
        )}
        {activePage === SettingsPages.NotificationPage && (
          <Notifications requestClose={handlePageRequestClose} />
        )}
        {activePage === SettingsPages.DevicesPage && (
          <Devices requestClose={handlePageRequestClose} />
        )}
        {activePage === SettingsPages.EmojisStickersPage && (
          <EmojisStickers requestClose={handlePageRequestClose} />
        )}
        {activePage === SettingsPages.DeveloperToolsPage && (
          <DeveloperTools requestClose={handlePageRequestClose} />
        )}
        {activePage === SettingsPages.KeybindsPage && (
          <Keybinds requestClose={handlePageRequestClose} />
        )}
        {activePage === SettingsPages.AboutPage && <About requestClose={handlePageRequestClose} />}
      </PageRoot>
    </div>
  );
}

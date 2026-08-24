import {
  Outlet,
  Route,
  createBrowserRouter,
  createHashRouter,
  createRoutesFromElements,
  redirect,
  Navigate,
} from 'react-router-dom';

import { ClientConfig } from '../hooks/useClientConfig';
import { AuthLayout, Login, Register, ResetPassword } from './auth';
import {
  DIRECT_PATH,
  EXPLORE_PATH,
  HOME_PATH,
  LOGIN_PATH,
  INBOX_PATH,
  REGISTER_PATH,
  RESET_PASSWORD_PATH,
  ROOMS_PATH,
  SPACE_PATH,
  _CREATE_PATH,
  _FEATURED_PATH,
  _INVITES_PATH,
  _JOIN_PATH,
  _LOBBY_PATH,
  _NOTIFICATIONS_PATH,
  _ALL_PATH,
  _ROOM_PATH,
  _SEARCH_PATH,
  _SERVER_PATH,
  CREATE_PATH,
} from './paths';
import {
  getAppPathFromHref,
  getExploreFeaturedPath,
  getHomePath,
  getLoginPath,
  getOriginBaseUrl,
  getSpaceLobbyPath,
} from './pathUtils';
import { ClientBindAtoms, ClientLayout, ClientRoot } from './client';
import { Home, HomeRouteRoomProvider, HomeSearch } from './client/home';
import { Direct, DirectCreate, DirectRouteRoomProvider } from './client/direct';
import { Rooms, RoomsRouteRoomProvider, RoomsSearch } from './client/rooms';
import { RouteSpaceProvider, Space, SpaceRouteRoomProvider, SpaceSearch } from './client/space';
import { Explore, FeaturedRooms, PublicRooms } from './client/explore';
import { Notifications, Inbox, Invites, InboxAll } from './client/inbox';
import { useDefaultInboxPath } from '../hooks/router/useInbox';
import { setAfterLoginRedirectPath } from './afterLoginRedirectPath';
import { Room } from '../features/room';
import { Lobby } from '../features/lobby';
import { WelcomePage } from './client/WelcomePage';
import { SidebarNav } from './client/SidebarNav';
import { PageRoot } from '../components/page';
import { ScreenSize } from '../hooks/useScreenSize';
import { MobileFriendlyPageNav, MobileFriendlyClientNav } from './MobileFriendly';
import { MobileRoomBackdrop } from './MobileRoomBackdrop';
import { MobileSwipeOpen } from './MobileSwipeOpen';
import { ClientInitStorageAtom } from './client/ClientInitStorageAtom';
import { ClientNonUIFeatures } from './client/ClientNonUIFeatures';
import { AuthRouteThemeManager, UnAuthRouteThemeManager } from './ThemeManager';
import { ReceiveSelfDeviceVerification } from '../components/DeviceVerification';
import { AutoRestoreBackupOnVerification } from '../components/BackupRestore';
import { RoomSettingsRenderer } from '../features/room-settings';
import { ClientRoomsNotificationPreferences } from './client/ClientRoomsNotificationPreferences';
import { SpaceSettingsRenderer } from '../features/space-settings';
import { UserRoomProfileRenderer } from '../components/UserRoomProfileRenderer';
import { CreateRoomModalRenderer } from '../features/create-room';
import { HomeCreateRoom } from './client/home/CreateRoom';
import { MobileSwipeBack } from '../features/room/MobileSwipeBack';
import { Create } from './client/create';
import { CreateSpaceModalRenderer } from '../features/create-space';
import { SearchModalRenderer } from '../features/search';
import { KeyboardShortcutsRenderer } from '../features/keyboard-shortcuts/KeyboardShortcuts';
import { getFallbackSession } from '../state/sessions';
import { CallStatusRenderer } from './CallStatusRenderer';
import { CallEmbedProvider } from '../components/CallEmbedProvider';
import { SplashScreen } from '../components/splash-screen';
import { RouteError } from './RouteError';
import { Spinner } from 'folds';

// Shown while the router runs its initial loaders. Doubles as the index route's
// element: that route only ever redirects (its loader returns `redirect(...)`),
// but react-router still warns "Matched leaf route ... does not have an element"
// for a loader-only leaf, and warns again when a data router hydrates with no
// HydrateFallback. Giving both a real element silences both warnings; because
// the loader redirects, this renders for only a frame.
function RouteLoading() {
  return (
    <SplashScreen>
      <Spinner variant="Secondary" size="600" />
    </SplashScreen>
  );
}

/**
 * `/inbox/` -> whichever tab `defaultInboxTab` names.
 *
 * A component, not a `loader` redirect like the neighbouring index routes: a
 * loader runs outside React and cannot read a setting, and the sidebar button
 * resolves the same setting through the same hook. Two entry points reading one
 * source is the whole point — they previously disagreed, which is how the
 * default came to depend on how you opened the Inbox.
 */
function InboxIndexRedirect() {
  const defaultInboxPath = useDefaultInboxPath();

  return <Navigate to={defaultInboxPath} replace />;
}

export const createRouter = (clientConfig: ClientConfig, screenSize: ScreenSize) => {
  const { hashRouter } = clientConfig;
  const mobile = screenSize === ScreenSize.Mobile;

  const routes = createRoutesFromElements(
    <Route HydrateFallback={RouteLoading} errorElement={<RouteError />}>
      <Route
        index
        element={<RouteLoading />}
        loader={() => {
          if (getFallbackSession()) return redirect(getHomePath());
          const afterLoginPath = getAppPathFromHref(getOriginBaseUrl(), window.location.href);
          if (afterLoginPath) setAfterLoginRedirectPath(afterLoginPath);
          return redirect(getLoginPath());
        }}
      />
      <Route
        loader={() => {
          if (getFallbackSession()) {
            return redirect(getHomePath());
          }

          return null;
        }}
        element={
          <>
            <AuthLayout />
            <UnAuthRouteThemeManager />
          </>
        }
      >
        <Route path={LOGIN_PATH} element={<Login />} />
        <Route path={REGISTER_PATH} element={<Register />} />
        <Route path={RESET_PASSWORD_PATH} element={<ResetPassword />} />
      </Route>

      <Route
        loader={() => {
          const session = getFallbackSession();
          if (!session) {
            const afterLoginPath = getAppPathFromHref(
              getOriginBaseUrl(hashRouter),
              window.location.href,
            );
            if (afterLoginPath) setAfterLoginRedirectPath(afterLoginPath);
            return redirect(getLoginPath());
          }
          return null;
        }}
        element={
          <AuthRouteThemeManager>
            <ClientRoot>
              <ClientInitStorageAtom>
                <ClientRoomsNotificationPreferences>
                  <ClientBindAtoms>
                    <ClientNonUIFeatures>
                      <CallEmbedProvider>
                        <ClientLayout
                          nav={
                            <MobileFriendlyClientNav>
                              <SidebarNav />
                            </MobileFriendlyClientNav>
                          }
                        >
                          <Outlet />
                        </ClientLayout>
                        <CallStatusRenderer />
                      </CallEmbedProvider>
                      <SearchModalRenderer />
                      <KeyboardShortcutsRenderer />
                      <UserRoomProfileRenderer />
                      <CreateRoomModalRenderer />
                      <CreateSpaceModalRenderer />
                      <RoomSettingsRenderer />
                      <SpaceSettingsRenderer />
                      <ReceiveSelfDeviceVerification />
                      <AutoRestoreBackupOnVerification />
                    </ClientNonUIFeatures>
                  </ClientBindAtoms>
                </ClientRoomsNotificationPreferences>
              </ClientInitStorageAtom>
            </ClientRoot>
          </AuthRouteThemeManager>
        }
      >
        <Route
          path={HOME_PATH}
          element={
            <PageRoot
              resizableNav
              nav={
                <MobileFriendlyPageNav path={HOME_PATH}>
                  <MobileSwipeOpen>
                    <Home />
                  </MobileSwipeOpen>
                </MobileFriendlyPageNav>
              }
            >
              <Outlet />
            </PageRoot>
          }
        >
          {/*
            On mobile the index route used to render nothing, which is why
            swiping toward a chat uncovered flat colour: there was no other
            side. MobileRoomBackdrop mounts the last-opened room beneath the
            list so the gesture reveals the real conversation, mirroring the
            back-swipe. It suppresses read receipts for that tree — see
            RoomBackdropProvider.
          */}
          <Route index element={mobile ? <MobileRoomBackdrop /> : <WelcomePage />} />
          <Route path={_CREATE_PATH} element={<HomeCreateRoom />} />
          <Route path={_JOIN_PATH} element={<p>join</p>} />
          <Route path={_SEARCH_PATH} element={<HomeSearch />} />
          <Route
            path={_ROOM_PATH}
            element={
              <HomeRouteRoomProvider>
                <Room />
              </HomeRouteRoomProvider>
            }
          />
        </Route>
        {/*
          The Rooms pseudo-space. Registered whether or not `roomsPseudoSpace`
          is on: the setting decides where links are made, not which links stay
          valid, and one shared while it was on must keep resolving after it is
          turned off.
        */}
        <Route
          path={ROOMS_PATH}
          element={
            <PageRoot
              resizableNav
              nav={
                <MobileFriendlyPageNav path={ROOMS_PATH}>
                  <MobileSwipeOpen>
                    <Rooms />
                  </MobileSwipeOpen>
                </MobileFriendlyPageNav>
              }
            >
              <Outlet />
            </PageRoot>
          }
        >
          <Route index element={mobile ? <MobileRoomBackdrop /> : <WelcomePage />} />
          <Route path={_CREATE_PATH} element={<HomeCreateRoom />} />
          <Route path={_JOIN_PATH} element={<p>join</p>} />
          <Route path={_SEARCH_PATH} element={<RoomsSearch />} />
          <Route
            path={_ROOM_PATH}
            element={
              <RoomsRouteRoomProvider>
                <Room />
              </RoomsRouteRoomProvider>
            }
          />
        </Route>
        <Route
          path={DIRECT_PATH}
          element={
            <PageRoot
              resizableNav
              // The one nav whose rows are identifiable by avatar alone: a
              // direct message IS the person. See `effectiveSpec`.
              collapsibleNav
              nav={
                <MobileFriendlyPageNav path={DIRECT_PATH}>
                  <MobileSwipeOpen>
                    <Direct />
                  </MobileSwipeOpen>
                </MobileFriendlyPageNav>
              }
            >
              <Outlet />
            </PageRoot>
          }
        >
          {/*
            On mobile the index route used to render nothing, which is why
            swiping toward a chat uncovered flat colour: there was no other
            side. MobileRoomBackdrop mounts the last-opened room beneath the
            list so the gesture reveals the real conversation, mirroring the
            back-swipe. It suppresses read receipts for that tree — see
            RoomBackdropProvider.
          */}
          <Route index element={mobile ? <MobileRoomBackdrop /> : <WelcomePage />} />
          <Route path={_CREATE_PATH} element={<DirectCreate />} />
          <Route
            path={_ROOM_PATH}
            element={
              <DirectRouteRoomProvider>
                <Room />
              </DirectRouteRoomProvider>
            }
          />
        </Route>
        <Route
          path={SPACE_PATH}
          element={
            <RouteSpaceProvider>
              <PageRoot
                resizableNav
                nav={
                  <MobileFriendlyPageNav path={SPACE_PATH}>
                    <MobileSwipeOpen>
                      <Space />
                    </MobileSwipeOpen>
                  </MobileFriendlyPageNav>
                }
              >
                <Outlet />
              </PageRoot>
            </RouteSpaceProvider>
          }
        >
          {mobile ? null : (
            <Route
              index
              loader={({ params }) => {
                const { spaceIdOrAlias } = params;
                if (spaceIdOrAlias) {
                  return redirect(getSpaceLobbyPath(spaceIdOrAlias));
                }
                return null;
              }}
              element={<WelcomePage />}
            />
          )}
          <Route path={_LOBBY_PATH} element={<Lobby />} />
          <Route path={_SEARCH_PATH} element={<SpaceSearch />} />
          <Route
            path={_ROOM_PATH}
            element={
              <SpaceRouteRoomProvider>
                <Room />
              </SpaceRouteRoomProvider>
            }
          />
        </Route>
        <Route
          path={EXPLORE_PATH}
          element={
            <PageRoot
              resizableNav
              nav={
                <MobileFriendlyPageNav path={EXPLORE_PATH}>
                  <Explore />
                </MobileFriendlyPageNav>
              }
            >
              <Outlet />
            </PageRoot>
          }
        >
          {mobile ? null : (
            <Route
              index
              loader={() => redirect(getExploreFeaturedPath())}
              element={<WelcomePage />}
            />
          )}
          <Route path={_FEATURED_PATH} element={<FeaturedRooms />} />
          <Route path={_SERVER_PATH} element={<PublicRooms />} />
        </Route>
        <Route path={CREATE_PATH} element={<Create />} />
        <Route
          path={INBOX_PATH}
          element={
            <PageRoot
              resizableNav
              nav={
                <MobileFriendlyPageNav path={INBOX_PATH}>
                  <Inbox />
                </MobileFriendlyPageNav>
              }
            >
              <Outlet />
            </PageRoot>
          }
        >
          {mobile ? null : (
            /*
              An element rather than a `loader` redirect, unlike its siblings.
              A loader runs outside React and so cannot read the
              `defaultInboxTab` setting; this needs to, or `/inbox/` lands
              somewhere other than the sidebar button does.
            */
            <Route index element={<InboxIndexRedirect />} />
          )}
          {/* Wrap in MobileSwipeBack like Room: on mobile this provides the
              absolute, opaque z-index:1 layer that covers the nav backdrop
              (MobileFriendlyPageNav renders the Inbox list behind at z 0).
              Without it the absolute backdrop paints over this static content
              and the page looks broken. Also adds the swipe-back gesture. */}
          <Route
            path={_ALL_PATH}
            element={
              <MobileSwipeBack>
                <InboxAll />
              </MobileSwipeBack>
            }
          />
          <Route
            path={_NOTIFICATIONS_PATH}
            element={
              <MobileSwipeBack>
                <Notifications />
              </MobileSwipeBack>
            }
          />
          <Route
            path={_INVITES_PATH}
            element={
              <MobileSwipeBack>
                <Invites />
              </MobileSwipeBack>
            }
          />
        </Route>
      </Route>
      <Route path="/*" element={<p>Page not found</p>} />
    </Route>,
  );

  if (hashRouter?.enabled) {
    return createHashRouter(routes, { basename: hashRouter.basename });
  }
  return createBrowserRouter(routes, {
    basename: import.meta.env.BASE_URL,
  });
};

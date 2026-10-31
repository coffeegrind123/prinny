import { ReactNode, useCallback } from 'react';
import { matchPath, useLocation, useNavigate } from 'react-router-dom';
import {
  getDirectPath,
  getExplorePath,
  getHomePath,
  getInboxPath,
  getSpacePath,
} from '../pages/pathUtils';
import { DIRECT_PATH, EXPLORE_PATH, HOME_PATH, INBOX_PATH, SPACE_PATH } from '../pages/paths';
import { useMatrixClient } from '../hooks/useMatrixClient';
import { getCanonicalAliasRoomId, isRoomAlias } from '../utils/matrix';
import { Membership } from '../../types/matrix/room';

type BackRouteHandlerProps = {
  children: (onBack: () => void) => ReactNode;
};
export function BackRouteHandler({ children }: BackRouteHandlerProps) {
  const mx = useMatrixClient();
  const navigate = useNavigate();
  const location = useLocation();

  const goBack = useCallback(() => {
    if (
      matchPath(
        {
          path: HOME_PATH,
          caseSensitive: true,
          end: false,
        },
        location.pathname,
      )
    ) {
      navigate(getHomePath());
      return;
    }
    if (
      matchPath(
        {
          path: DIRECT_PATH,
          caseSensitive: true,
          end: false,
        },
        location.pathname,
      )
    ) {
      navigate(getDirectPath());
      return;
    }
    const spaceMatch = matchPath(
      {
        path: SPACE_PATH,
        caseSensitive: true,
        end: false,
      },
      location.pathname,
    );
    const encodedSpaceIdOrAlias = spaceMatch?.params.spaceIdOrAlias;
    const decodedSpaceIdOrAlias =
      encodedSpaceIdOrAlias && decodeURIComponent(encodedSpaceIdOrAlias);

    if (decodedSpaceIdOrAlias) {
      // A space we have not joined renders its join preview at every path
      // under it, so going "up" to the space would show the same screen again
      // and Back could never leave it.
      const spaceId = isRoomAlias(decodedSpaceIdOrAlias)
        ? getCanonicalAliasRoomId(mx, decodedSpaceIdOrAlias)
        : decodedSpaceIdOrAlias;
      const joined = !!spaceId && mx.getRoom(spaceId)?.getMyMembership() === Membership.Join;
      if (!joined) {
        navigate(getHomePath(), { replace: true });
        return;
      }
      navigate(getSpacePath(decodedSpaceIdOrAlias));
      return;
    }
    if (
      matchPath(
        {
          path: EXPLORE_PATH,
          caseSensitive: true,
          end: false,
        },
        location.pathname,
      )
    ) {
      navigate(getExplorePath());
      return;
    }
    if (
      matchPath(
        {
          path: INBOX_PATH,
          caseSensitive: true,
          end: false,
        },
        location.pathname,
      )
    ) {
      navigate(getInboxPath());
    }
  }, [mx, navigate, location]);

  return children(goBack);
}

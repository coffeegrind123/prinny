import { useState } from 'react';
import { Avatar, Box, Icon, Icons, Overlay, OverlayBackdrop, OverlayCenter, Text } from 'folds';
import classNames from 'classnames';
import { FocusTrap } from 'focus-trap-react';
import * as css from './styles.css';
import { UserAvatar } from '../user-avatar';
import colorMXID from '../../../util/colorMXID';
import { getMxIdLocalPart, getMxIdServer } from '../../utils/matrix';
import { BreakWord, LineClamp3 } from '../../styles/Text.css';
import { UserPresence } from '../../hooks/useUserPresence';
import { AvatarPresence, PresenceBadge } from '../presence';
import { ImageViewer } from '../image-viewer';
import { stopPropagation } from '../../utils/keyboard';

type UserHeroProps = {
  userId: string;
  avatarUrl?: string;
  bannerUrl?: string;
  profileLoaded: boolean;
  presence?: UserPresence;
  /**
   * The free-text status message ("what I'm doing"), shown in a thought bubble
   * beside the avatar. Separate from `presence`, which only decides the badge:
   * a status is worth showing whether or not the account is currently active,
   * and an idle account with something to say is exactly the case where it is
   * the more useful of the two.
   */
  status?: string;
};
export function UserHero({
  userId,
  avatarUrl,
  bannerUrl,
  profileLoaded,
  presence,
  status,
}: UserHeroProps) {
  const [viewAvatar, setViewAvatar] = useState<string>();
  const coverUrl = bannerUrl ?? (profileLoaded ? avatarUrl : undefined);

  return (
    <Box direction="Column" className={css.UserHero}>
      <div
        className={css.UserHeroCoverContainer}
        style={{
          backgroundColor: colorMXID(userId),
          filter: coverUrl ? undefined : 'brightness(50%)',
        }}
      >
        {coverUrl && (
          <img
            className={bannerUrl ? css.UserHeroBanner : css.UserHeroCover}
            src={coverUrl}
            alt=""
            draggable="false"
          />
        )}
      </div>
      <div className={css.UserHeroAvatarContainer}>
        <AvatarPresence
          className={css.UserAvatarContainer}
          badge={
            presence && <PresenceBadge presence={presence.presence} status={presence.status} />
          }
        >
          <Avatar
            as={avatarUrl ? 'button' : 'div'}
            onClick={avatarUrl ? () => setViewAvatar(avatarUrl) : undefined}
            className={css.UserHeroAvatar}
            size="500"
          >
            <UserAvatar
              className={css.UserHeroAvatarImg}
              userId={userId}
              src={avatarUrl}
              alt={userId}
              renderFallback={() => <Icon size="500" src={Icons.User} filled />}
            />
          </Avatar>
        </AvatarPresence>
        {status && (
          <div className={css.UserHeroStatus} title={status}>
            <Text size="T200" truncate>
              {status}
            </Text>
          </div>
        )}
        {viewAvatar && (
          <Overlay open backdrop={<OverlayBackdrop />}>
            <OverlayCenter>
              <FocusTrap
                focusTrapOptions={{
                  initialFocus: false,
                  onDeactivate: () => setViewAvatar(undefined),
                  clickOutsideDeactivates: true,
                  escapeDeactivates: stopPropagation,
                }}
              >
                {/*
                  No Modal around this. ImageViewer is already a lightbox — it
                  sizes the image to 80vw/80vh and floats its own toolbar over
                  the backdrop — so a Modal put a second, fixed-width surface
                  around something built to fill the screen, which is why an
                  avatar opened smaller and more boxed-in than any other image
                  in the app. Every other viewer in the client (timeline,
                  search, pins, notifications, link previews) renders it bare
                  inside OverlayCenter; this was the one that did not.
                */}
                <ImageViewer
                  src={viewAvatar}
                  alt={userId}
                  requestClose={() => setViewAvatar(undefined)}
                  // The profile card is itself inside a context menu, so a
                  // right-click here would otherwise reach it and close the
                  // thing the viewer was opened from.
                  onContextMenu={(evt) => evt.stopPropagation()}
                />
              </FocusTrap>
            </OverlayCenter>
          </Overlay>
        )}
      </div>
    </Box>
  );
}

type UserHeroNameProps = {
  displayName?: string;
  userId: string;
  pronouns?: string;
  /** MSC4175 local time, already formatted. */
  localTime?: string;
};
export function UserHeroName({ displayName, userId, pronouns, localTime }: UserHeroNameProps) {
  const username = getMxIdLocalPart(userId);
  const server = getMxIdServer(userId);

  return (
    <Box grow="Yes" direction="Column" gap="0">
      <Box alignItems="Baseline" gap="200" wrap="Wrap">
        <Text
          size="H4"
          className={classNames(BreakWord, LineClamp3)}
          title={displayName ?? username}
        >
          {displayName ?? username ?? userId}
        </Text>
        {pronouns && (
          <Text size="T200" priority="300">
            {pronouns}
          </Text>
        )}
        {localTime && (
          <Text size="T200" priority="300" title="Local time">
            {localTime} local
          </Text>
        )}
      </Box>
      <Box alignItems="Center" gap="100" wrap="Wrap">
        <Text size="T200" className={classNames(BreakWord, LineClamp3)} title={userId}>
          @{username}
          {server && (
            <Text as="span" size="Inherit" priority="300">
              :{server}
            </Text>
          )}
        </Text>
      </Box>
    </Box>
  );
}

import {
  Box,
  Text,
  IconButton,
  Icon,
  Icons,
  Scroll,
  Button,
  Spinner,
  color,
  config,
  toRem,
} from 'folds';
import { useState } from 'react';
import { Page, PageContent, PageContentCenter, PageHeader } from '../../../components/page';
import { SequenceCard } from '../../../components/sequence-card';
import { SequenceCardStyle } from '../styles.css';
import { SettingTile } from '../../../components/setting-tile';
import PrinnySVG from '../../../../../public/res/svg/prinny.svg';
import { CLEAR_CACHE_BLOCKED_MESSAGE, clearCacheAndReload } from '../../../../client/initMatrix';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useUpdateCheck } from '../../../hooks/useUpdateCheck';
import { useIsAndroid } from '../../../hooks/useIsAndroid';
import { version } from '../../../../../package.json';
import { Diagnostics } from './Diagnostics';

// What the update button says and does, per state. An update button that only
// ever reads "Check for Updates" makes the user hunt for the banner to
// actually apply one, so when an update is waiting this button applies it.
const updateButton = (
  status: ReturnType<typeof useUpdateCheck>['status'],
  update: ReturnType<typeof useUpdateCheck>['update'],
): { label: string; busy: boolean; install: boolean } => {
  switch (status) {
    case 'checking':
      return { label: 'Checking...', busy: true, install: false };
    case 'downloading':
      return { label: 'Downloading...', busy: true, install: false };
    case 'installing':
      return { label: 'Installing...', busy: true, install: false };
    case 'available':
      return {
        label: update?.version ? `Update to v${update.version}` : 'Reload to Update',
        busy: false,
        install: true,
      };
    case 'no-update':
      return { label: 'Up to Date', busy: false, install: false };
    case 'error':
      return { label: 'Retry Update Check', busy: false, install: false };
    default:
      return { label: 'Check for Updates', busy: false, install: false };
  }
};

type AboutProps = {
  requestClose: () => void;
};
export function About({ requestClose }: AboutProps) {
  const mx = useMatrixClient();
  // manual: the banner owns the automatic check and the notification. A second
  // full instance would notify twice for the same version.
  const { status, update, error, checkForUpdate, downloadAndInstall } = useUpdateCheck({
    manual: true,
  });
  const updateAction = updateButton(status, update);
  /**
   * Android updates itself, so there is no button here.
   *
   * `UpdateChecker.kt` runs from `MainActivity.onCreate`, pulls the APK through
   * DownloadManager and prompts to install it; `tauri-plugin-updater` is not
   * even compiled for mobile targets. `checkForUpdate` returns immediately on
   * Android as a result, which left the button permanently reading "Check for
   * Updates" and doing nothing whatsoever when tapped — the worst kind of
   * control, one that looks like it works.
   */
  const androidSelfUpdates = useIsAndroid();
  const [clearCacheBlocked, setClearCacheBlocked] = useState(false);

  return (
    <Page>
      <PageHeader outlined={false}>
        <Box grow="Yes" gap="200">
          <Box grow="Yes" alignItems="Center" gap="200">
            <Text size="H3" truncate>
              About
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
                <Box gap="400">
                  <Box shrink="No">
                    <img
                      style={{ width: toRem(96), height: toRem(96) }}
                      src={PrinnySVG}
                      alt="Prinny Client logo"
                    />
                  </Box>
                  <Box direction="Column" gap="300">
                    <Box direction="Column" gap="100">
                      <Box gap="100" alignItems="End">
                        <Text size="H3">Prinny Client</Text>
                        <Text size="T200">
                          v{version}
                          {__APP_COMMIT__ && ` (${__APP_COMMIT__})`}
                        </Text>
                      </Box>
                      <Text>A Matrix chat client that actually feels native.</Text>
                    </Box>

                    <Box gap="200" wrap="Wrap">
                      <Button
                        as="a"
                        href="https://github.com/coffeegrind123/prinny-client"
                        rel="noreferrer noopener"
                        target="_blank"
                        variant="Secondary"
                        fill="Soft"
                        size="300"
                        radii="300"
                        before={<Icon src={Icons.Code} size="100" filled />}
                      >
                        <Text size="B300">Source Code</Text>
                      </Button>
                      {!androidSelfUpdates && (
                        <Button
                          onClick={updateAction.install ? downloadAndInstall : checkForUpdate}
                          disabled={updateAction.busy}
                          variant={updateAction.install ? 'Primary' : 'Secondary'}
                          fill="Soft"
                          size="300"
                          radii="300"
                          before={
                            updateAction.busy ? (
                              <Spinner size="100" variant="Secondary" />
                            ) : (
                              <Icon
                                src={updateAction.install ? Icons.Download : Icons.Reload}
                                size="100"
                                filled
                              />
                            )
                          }
                        >
                          <Text size="B300">{updateAction.label}</Text>
                        </Button>
                      )}
                    </Box>
                    {!androidSelfUpdates && status === 'error' && error && (
                      <Text size="T200" style={{ color: color.Critical.Main }}>
                        {error}
                      </Text>
                    )}
                  </Box>
                </Box>
                <Box direction="Column" gap="100">
                  <Text size="L400">Options</Text>
                  <SequenceCard
                    className={SequenceCardStyle}
                    variant="SurfaceVariant"
                    direction="Column"
                    gap="400"
                  >
                    <SettingTile
                      title="Clear Cache & Reload"
                      description="Clear all your locally stored data and reload from server."
                      after={
                        <Button
                          onClick={() => clearCacheAndReload(mx, () => setClearCacheBlocked(true))}
                          variant="Secondary"
                          fill="Soft"
                          size="300"
                          radii="300"
                          outlined
                        >
                          <Text size="B300">Clear Cache</Text>
                        </Button>
                      }
                    />
                    {clearCacheBlocked && (
                      <Text size="T200" style={{ color: color.Critical.Main }}>
                        {CLEAR_CACHE_BLOCKED_MESSAGE}
                      </Text>
                    )}
                  </SequenceCard>
                </Box>
                <Diagnostics />
                <Box direction="Column" gap="100">
                  <Text size="L400">Credits</Text>
                  <SequenceCard
                    className={SequenceCardStyle}
                    variant="SurfaceVariant"
                    direction="Column"
                    gap="400"
                  >
                    <Box
                      as="ul"
                      direction="Column"
                      gap="200"
                      style={{
                        margin: 0,
                        paddingLeft: config.space.S400,
                      }}
                    >
                      <li>
                        <Text size="T300">
                          Prinny Client is a hard fork of{' '}
                          <a
                            href="https://github.com/cinnyapp/cinny"
                            rel="noreferrer noopener"
                            target="_blank"
                          >
                            Cinny
                          </a>{' '}
                          and{' '}
                          <a
                            href="https://github.com/cinnyapp/cinny-desktop"
                            rel="noreferrer noopener"
                            target="_blank"
                          >
                            cinny-desktop
                          </a>
                          , packaged with{' '}
                          <a href="https://v2.tauri.app" rel="noreferrer noopener" target="_blank">
                            Tauri v2
                          </a>
                          .
                        </Text>
                      </li>
                      <li>
                        <Text size="T300">
                          The{' '}
                          <a
                            href="https://github.com/matrix-org/matrix-js-sdk"
                            rel="noreferrer noopener"
                            target="_blank"
                          >
                            matrix-js-sdk
                          </a>{' '}
                          is ©{' '}
                          <a
                            href="https://matrix.org/foundation"
                            rel="noreferrer noopener"
                            target="_blank"
                          >
                            The Matrix.org Foundation C.I.C
                          </a>{' '}
                          used under the terms of{' '}
                          <a
                            href="http://www.apache.org/licenses/LICENSE-2.0"
                            rel="noreferrer noopener"
                            target="_blank"
                          >
                            Apache 2.0
                          </a>
                          .
                        </Text>
                      </li>
                      <li>
                        <Text size="T300">
                          The{' '}
                          <a
                            href="https://github.com/TCOTC/twemoji-colr"
                            target="_blank"
                            rel="noreferrer noopener"
                          >
                            twemoji-colr
                          </a>{' '}
                          font uses Twemoji artwork under the terms of{' '}
                          <a
                            href="https://creativecommons.org/licenses/by/4.0/"
                            target="_blank"
                            rel="noreferrer noopener"
                          >
                            CC-BY 4.0
                          </a>
                          .
                        </Text>
                      </li>
                      <li>
                        <Text size="T300">
                          The{' '}
                          <a
                            href="https://github.com/jdecked/twemoji"
                            target="_blank"
                            rel="noreferrer noopener"
                          >
                            Twemoji
                          </a>{' '}
                          emoji art is ©{' '}
                          <a
                            href="https://github.com/jdecked/twemoji"
                            target="_blank"
                            rel="noreferrer noopener"
                          >
                            Twitter, Inc and other contributors
                          </a>{' '}
                          used under the terms of{' '}
                          <a
                            href="https://creativecommons.org/licenses/by/4.0/"
                            target="_blank"
                            rel="noreferrer noopener"
                          >
                            CC-BY 4.0
                          </a>
                          .
                        </Text>
                      </li>
                      <li>
                        <Text size="T300">
                          The{' '}
                          <a
                            href="https://material.io/design/sound/sound-resources.html"
                            target="_blank"
                            rel="noreferrer noopener"
                          >
                            Material sound resources
                          </a>{' '}
                          are ©{' '}
                          <a href="https://google.com" target="_blank" rel="noreferrer noopener">
                            Google
                          </a>{' '}
                          used under the terms of{' '}
                          <a
                            href="https://creativecommons.org/licenses/by/4.0/"
                            target="_blank"
                            rel="noreferrer noopener"
                          >
                            CC-BY 4.0
                          </a>
                          .
                        </Text>
                      </li>
                    </Box>
                  </SequenceCard>
                </Box>
              </Box>
            </PageContentCenter>
          </PageContent>
        </Scroll>
      </Box>
    </Page>
  );
}

import { Box, Button, color, config, Dialog, Header, Icon, IconButton, Icons, Text } from 'folds';
import { useCallback, useEffect, useState } from 'react';
import { StageComponentProps } from './types';
import { isWebUrl } from '../../utils/safeUrl';
import { errorMessage } from '../../utils/errorMessage';

export function SSOStage({
  ssoRedirectURL,
  stageData,
  submitAuthDict,
  onCancel,
}: StageComponentProps & {
  ssoRedirectURL: string;
}) {
  const { errorCode, error, session } = stageData;
  const [ssoWindow, setSSOWindow] = useState<Window>();

  const handleSubmit = useCallback(() => {
    submitAuthDict({
      session,
    });
  }, [submitAuthDict, session]);

  const handleContinue = () => {
    // The redirect URL comes from the homeserver, so validate the scheme before
    // opening it — in the Tauri shell an unexpected scheme is handed to the OS
    // URL opener rather than navigated.
    //
    // Deliberately NOT using `noopener`: the flow below needs the returned
    // handle to match `evt.source` and to close the window once SSO completes,
    // and `noopener` makes `window.open` return null. The residual risk is that
    // the opened document can navigate this window; the origin check on the
    // message listener is what keeps the completion signal itself trustworthy.
    if (!isWebUrl(ssoRedirectURL)) {
      console.error('Refusing to open SSO redirect URL: not an http(s) URL');
      return;
    }
    const w = window.open(ssoRedirectURL, '_blank');
    setSSOWindow(w ?? undefined);
  };

  useEffect(() => {
    const handleMessage = (evt: MessageEvent) => {
      if (
        evt.origin === new URL(ssoRedirectURL).origin &&
        ssoWindow &&
        evt.data === 'authDone' &&
        evt.source === ssoWindow
      ) {
        ssoWindow.close();
        setSSOWindow(undefined);
        handleSubmit();
      }
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [ssoWindow, handleSubmit, ssoRedirectURL]);

  return (
    <Dialog>
      <Header
        style={{
          padding: `0 ${config.space.S200} 0 ${config.space.S400}`,
        }}
        variant="Surface"
        size="500"
      >
        <Box grow="Yes">
          <Text size="H4">SSO Login</Text>
        </Box>
        <IconButton size="300" onClick={onCancel} radii="300">
          <Icon src={Icons.Cross} />
        </IconButton>
      </Header>
      <Box
        style={{ padding: `0 ${config.space.S400} ${config.space.S400}` }}
        direction="Column"
        gap="400"
      >
        <Text size="T200">
          To perform this action you need to authenticate yourself by SSO login.
        </Text>
        {errorCode && (
          <Box alignItems="Center" gap="100" style={{ color: color.Critical.Main }}>
            <Icon size="50" src={Icons.Warning} filled />
            <Text size="T200">
              <b>{errorMessage({ errcode: errorCode, error })}</b>
            </Text>
          </Box>
        )}

        {ssoWindow ? (
          <Button variant="Primary" onClick={handleSubmit}>
            <Text as="span" size="B400">
              Continue
            </Text>
          </Button>
        ) : (
          <Button variant="Primary" onClick={handleContinue}>
            <Text as="span" size="B400">
              Continue with SSO
            </Text>
          </Button>
        )}
      </Box>
    </Dialog>
  );
}

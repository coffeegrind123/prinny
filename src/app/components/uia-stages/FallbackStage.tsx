import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Button, Dialog, Text, config } from 'folds';

import { StageComponentProps } from './types';
import { useAutoDiscoveryInfo } from '../../hooks/useAutoDiscoveryInfo';
import { useAuthServer } from '../../hooks/useAuthServer';
import { useClientConfig } from '../../hooks/useClientConfig';
import { usePublicServers } from '../../hooks/usePublicServers';

/**
 * Server-rendered fallback for a UIA stage this client cannot do natively.
 *
 * Every homeserver must serve
 *   /_matrix/client/v3/auth/<stage>/fallback/web?session=<id>
 * for exactly this case. The page is opened in a popup (never an iframe — the
 * homeserver is free to send X-Frame-Options/frame-ancestors, and SSO
 * providers reliably do), the user completes the stage there, and the client
 * then re-submits the request carrying only the session id. The server already
 * knows the stage is done.
 *
 * This is what makes an unknown stage — an hCaptcha-backed captcha whose
 * sitekey we cannot render, m.login.msisdn, or something a server invented —
 * degrade to "one extra window" instead of "you cannot register here".
 */

// The spec has the fallback page notify its opener with the bare string
// 'authDone'. Some servers post an object instead, so accept both shapes.
const isAuthDoneMessage = (data: unknown): boolean =>
  data === 'authDone' ||
  (typeof data === 'object' &&
    data !== null &&
    (data as Record<string, unknown>).authDone === true);

/**
 * Shown when the homeserver serves no fallback page for a stage it demanded.
 * Registration cannot be completed in any Matrix client at that point, so the
 * only useful thing is to point at wherever the server does take signups —
 * which the merged public-server directory records as `registration.link`.
 */
function UnsupportedStageDialog({ type, onCancel }: { type: string; onCancel: () => void }) {
  const serverName = useAuthServer();
  const { publicServersUrl } = useClientConfig();
  const { data } = usePublicServers(publicServersUrl);

  const entry = data?.servers.find((s) => s.name === serverName);
  const regLink = entry?.registration.link;
  const regMethod = entry?.registration.method;

  return (
    <Dialog>
      <Box style={{ padding: config.space.S400 }} direction="Column" gap="400">
        <Box direction="Column" gap="100">
          <Text size="H4">Sign up on the server&rsquo;s website</Text>
          <Text size="T200">
            {serverName} requires a step ({type}) that it does not expose to Matrix apps, so
            registration cannot be completed here. This is a choice the server made, not a
            limitation of this app.
          </Text>
        </Box>

        {regLink ? (
          <Box direction="Column" gap="100">
            <Text size="T200">Its sign-up page{regMethod ? ` (${regMethod})` : ''}:</Text>
            <a href={regLink} target="_blank" rel="noreferrer noopener">
              <Text size="T300">{regLink}</Text>
            </a>
            <Text size="T200" priority="400">
              Create the account there, then come back and sign in normally.
            </Text>
          </Box>
        ) : (
          <Text size="T200" priority="400">
            Check {serverName} for a sign-up page, then come back and sign in normally. You can also
            pick a different server from the list beside the homeserver field.
          </Text>
        )}

        <Button variant="Secondary" fill="Soft" onClick={onCancel}>
          <Text as="span" size="B400">
            Back
          </Text>
        </Button>
      </Box>
    </Dialog>
  );
}

export function FallbackStageDialog({ stageData, submitAuthDict, onCancel }: StageComponentProps) {
  const { type, session } = stageData;
  const autoDiscovery = useAutoDiscoveryInfo();
  const baseUrl = autoDiscovery['m.homeserver'].base_url;

  const [opened, setOpened] = useState(false);
  const [popupBlocked, setPopupBlocked] = useState(false);
  // Set only when the server has *provably* no fallback page for this stage.
  const [unsupported, setUnsupported] = useState(false);
  const popupRef = useRef<Window | null>(null);
  // Guards against a double submit when the user clicks "I've completed this"
  // just as the postMessage lands.
  const doneRef = useRef(false);

  const fallbackUrl = session
    ? `${baseUrl.replace(/\/$/, '')}/_matrix/client/v3/auth/${encodeURIComponent(
        type,
      )}/fallback/web?session=${encodeURIComponent(session)}`
    : '';

  const complete = useCallback(() => {
    if (doneRef.current || !session) return;
    doneRef.current = true;
    popupRef.current?.close();
    // Only the session — the server holds the record of which stages are done.
    submitAuthDict({ session });
  }, [session, submitAuthDict]);

  useEffect(() => {
    if (!fallbackUrl) return undefined;

    let expectedOrigin = '';
    try {
      expectedOrigin = new URL(baseUrl).origin;
    } catch {
      expectedOrigin = '';
    }

    const handleMessage = (event: MessageEvent) => {
      if (!isAuthDoneMessage(event.data)) return;
      // The popup is same-origin with the homeserver, so anything claiming
      // completion from elsewhere is not the page we opened. The manual button
      // below is the escape hatch if a server bounces the flow through another
      // origin and posts from there.
      if (expectedOrigin && event.origin !== expectedOrigin) return;
      complete();
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [fallbackUrl, baseUrl, complete]);

  /**
   * Decide whether the server actually serves a fallback page for this stage.
   *
   * Synapse implements the fallback endpoint for exactly four stage types
   * (recaptcha, terms, sso, registration_token — see synapse/rest/client/
   * auth.py) and answers 404 for anything else, so a server-specific stage
   * lands the user on a raw JSON error inside a popup with no way forward.
   *
   * The probe leans on a CORS asymmetry, measured rather than assumed:
   *
   *   supported stage   -> 200 text/html  with NO CORS headers
   *   unknown stage     -> 404 application/json  WITH `access-control-allow-origin: *`
   *
   * So a *readable* 404 is proof of "not supported", while a fetch that is
   * blocked or errors tells us nothing — it is what a served HTML page looks
   * like from script. We therefore only ever act on the certain case, and any
   * other outcome leaves the normal popup flow exactly as it was.
   */
  useEffect(() => {
    if (!fallbackUrl) return undefined;
    let cancelled = false;

    fetch(fallbackUrl, { method: 'GET', credentials: 'omit' })
      .then((res) => {
        if (!cancelled && res.status === 404) setUnsupported(true);
      })
      .catch(() => {
        // Opaque/blocked/offline — indistinguishable from a healthy page.
        // Assume nothing.
      });

    return () => {
      cancelled = true;
    };
  }, [fallbackUrl]);

  const openPopup = useCallback(() => {
    if (!fallbackUrl) return;
    // No `noopener` here, deliberately: the fallback page reports completion
    // via `window.opener.postMessage`, and noopener severs exactly that. The
    // manual button below covers the case where the link is opened without an
    // opener anyway (popup blocked, user middle-clicks the manual link).
    const popup = window.open(fallbackUrl, '_blank', 'width=640,height=720');
    if (popup) {
      popupRef.current = popup;
      setOpened(true);
      setPopupBlocked(false);
    } else {
      setPopupBlocked(true);
    }
  }, [fallbackUrl]);

  // The server has no fallback page for this stage, so there is nothing this
  // client can drive. The public directory usually knows where that server
  // actually wants people to sign up — surface it instead of a dead end.
  if (unsupported) {
    return <UnsupportedStageDialog type={type} onCancel={onCancel} />;
  }

  if (!session || !fallbackUrl) {
    return (
      <Dialog>
        <Box style={{ padding: config.space.S400 }} direction="Column" gap="400">
          <Box direction="Column" gap="100">
            <Text size="H4">Cannot continue</Text>
            <Text size="T200">
              This server asked for a verification step ({type}) that could not be started.
            </Text>
          </Box>
          <Button variant="Critical" fill="None" outlined onClick={onCancel}>
            <Text as="span" size="B400">
              Cancel
            </Text>
          </Button>
        </Box>
      </Dialog>
    );
  }

  return (
    <Dialog>
      <Box style={{ padding: config.space.S400 }} direction="Column" gap="400">
        <Box direction="Column" gap="100">
          <Text size="H4">One more step</Text>
          <Text size="T200">
            This server handles this step ({type}) on its own page. It opens in a new window; finish
            there and you will be brought straight back.
          </Text>
        </Box>

        {popupBlocked && (
          <Text size="T200">
            Your browser blocked the window.{' '}
            <a href={fallbackUrl} target="_blank" rel="noreferrer noopener">
              Open it manually
            </a>
            , then choose &ldquo;I&rsquo;ve completed this&rdquo; below.
          </Text>
        )}

        <Box direction="Column" gap="200">
          <Button variant="Primary" onClick={openPopup}>
            <Text as="span" size="B400">
              {opened ? 'Reopen the window' : 'Continue'}
            </Text>
          </Button>

          {/*
            Auto-continue relies on the fallback page messaging us back, which
            not every deployment manages (a proxy that rewrites the origin, a
            stage that finishes on a third-party page). Without a manual path
            the user would be stuck staring at a completed popup.
          */}
          {(opened || popupBlocked) && (
            <Button variant="Secondary" fill="Soft" onClick={complete}>
              <Text as="span" size="B400">
                I&rsquo;ve completed this
              </Text>
            </Button>
          )}

          <Button variant="Critical" fill="None" outlined onClick={onCancel}>
            <Text as="span" size="B400">
              Cancel
            </Text>
          </Button>
        </Box>
      </Box>
    </Dialog>
  );
}

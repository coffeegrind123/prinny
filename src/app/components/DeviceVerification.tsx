import {
  ShowSasCallbacks,
  VerificationPhase,
  VerificationRequest,
  Verifier,
} from 'matrix-js-sdk/lib/crypto-api';
import { CSSProperties, useCallback, useEffect, useRef, useState } from 'react';
import { VerificationMethod } from 'matrix-js-sdk/lib/types';
import {
  Box,
  Button,
  config,
  Dialog,
  Header,
  Icon,
  IconButton,
  Icons,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Spinner,
  Text,
} from 'folds';
import { FocusTrap } from 'focus-trap-react';
import {
  useVerificationRequestPhase,
  useVerificationRequestReceived,
  useVerifierCancel,
  useVerifierShowSas,
} from '../hooks/useVerificationRequest';
import { AsyncStatus, useAsyncCallback } from '../hooks/useAsyncCallback';
import { useMatrixClient } from '../hooks/useMatrixClient';
import { ContainerColor } from '../styles/ContainerColor.css';

const DialogHeaderStyles: CSSProperties = {
  padding: `0 ${config.space.S200} 0 ${config.space.S400}`,
  borderBottomWidth: config.borderWidth.B300,
};

type WaitingMessageProps = {
  message: string;
};
function WaitingMessage({ message }: WaitingMessageProps) {
  return (
    <Box alignItems="Center" gap="200">
      <Spinner variant="Secondary" size="200" />
      <Text size="T300">{message}</Text>
    </Box>
  );
}

type VerificationUnexpectedProps = { message: string; onClose: () => void };
function VerificationUnexpected({ message, onClose }: VerificationUnexpectedProps) {
  return (
    <Box direction="Column" gap="400">
      <Text>{message}</Text>
      <Button variant="Secondary" fill="Soft" onClick={onClose}>
        <Text size="B400">Close</Text>
      </Button>
    </Box>
  );
}

function VerificationWaitAccept() {
  return (
    <Box direction="Column" gap="400">
      <Text>Please accept the request from other device.</Text>
      <WaitingMessage message="Waiting for request to be accepted..." />
    </Box>
  );
}

type VerificationAcceptProps = {
  onAccept: () => Promise<void>;
};
function VerificationAccept({ onAccept }: VerificationAcceptProps) {
  const [acceptState, accept] = useAsyncCallback<void, Error, []>(onAccept);

  const accepting = acceptState.status === AsyncStatus.Loading;
  return (
    <Box direction="Column" gap="400">
      <Text>
        {acceptState.status === AsyncStatus.Error
          ? acceptState.error.message
          : 'Click accept to start the verification process.'}
      </Text>
      <Button
        variant="Primary"
        fill="Solid"
        onClick={accept}
        before={accepting && <Spinner size="100" variant="Primary" fill="Solid" />}
        disabled={accepting}
      >
        <Text size="B400">Accept</Text>
      </Button>
    </Box>
  );
}

function VerificationWaitStart() {
  return (
    <Box direction="Column" gap="400">
      <Text>Verification request has been accepted.</Text>
      <WaitingMessage message="Waiting for the response from other device..." />
    </Box>
  );
}

type VerificationStartProps = {
  onStart: () => Promise<void>;
};
function AutoVerificationStart({ onStart }: VerificationStartProps) {
  const [error, setError] = useState<Error>();

  useEffect(() => {
    onStart().catch((reason: unknown) => {
      setError(reason instanceof Error ? reason : new Error(String(reason)));
    });
  }, [onStart]);

  return (
    <Box direction="Column" gap="400">
      {error ? (
        <Text size="T300">{error.message}</Text>
      ) : (
        <WaitingMessage message="Starting verification using emoji comparison..." />
      )}
    </Box>
  );
}

function CompareEmoji({ sasData }: { sasData: ShowSasCallbacks }) {
  const [confirmState, confirm] = useAsyncCallback(useCallback(() => sasData.confirm(), [sasData]));

  const confirming =
    confirmState.status === AsyncStatus.Loading || confirmState.status === AsyncStatus.Success;

  return (
    <Box direction="Column" gap="400">
      <Text>Confirm the emoji below are displayed on both devices, in the same order:</Text>
      <Box
        className={ContainerColor({ variant: 'SurfaceVariant' })}
        style={{
          borderRadius: config.radii.R400,
          padding: config.space.S500,
        }}
        gap="700"
        wrap="Wrap"
        justifyContent="Center"
      >
        {sasData.sas.emoji?.map(([emoji, name], index) => (
          <Box
            // eslint-disable-next-line react/no-array-index-key
            key={`${emoji}${name}${index}`}
            direction="Column"
            gap="100"
            justifyContent="Center"
            alignItems="Center"
          >
            <Text size="H1">{emoji}</Text>
            <Text size="T200">{name}</Text>
          </Box>
        ))}
      </Box>
      <Box direction="Column" gap="200">
        <Button
          variant="Primary"
          fill="Soft"
          onClick={confirm}
          disabled={confirming}
          before={confirming && <Spinner size="100" variant="Primary" />}
        >
          <Text size="B400">They Match</Text>
        </Button>
        <Button
          variant="Primary"
          fill="Soft"
          onClick={() => sasData.mismatch()}
          disabled={confirming}
        >
          <Text size="B400">Do not Match</Text>
        </Button>
      </Box>
    </Box>
  );
}

type SasVerificationProps = {
  verifier: Verifier;
  onCancel: () => void;
  onVerified: () => void;
};
function SasVerification({ verifier, onCancel, onVerified }: SasVerificationProps) {
  const [sasData, setSasData] = useState<ShowSasCallbacks>();

  useVerifierShowSas(verifier, setSasData);
  useVerifierCancel(verifier, onCancel);

  // The request can stay in Started for a while after the verifier has finished, which left
  // the emoji screen up, and its X then cancelled a completed verification. Failures arrive as
  // the verifier's Cancel event, so the rejection itself needs no handling.
  useEffect(() => {
    let active = true;
    verifier
      .verify()
      .then(() => {
        if (active) onVerified();
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [verifier, onVerified]);

  if (sasData) {
    return <CompareEmoji sasData={sasData} />;
  }

  return (
    <Box direction="Column" gap="400">
      <WaitingMessage message="Starting verification using emoji comparison..." />
    </Box>
  );
}

type VerificationDoneProps = {
  onExit: () => void;
};
function VerificationDone({ onExit }: VerificationDoneProps) {
  return (
    <Box direction="Column" gap="400">
      <div>
        <Text>Your device is verified.</Text>
      </div>
      <Button variant="Primary" fill="Solid" onClick={onExit}>
        <Text size="B400">Okay</Text>
      </Button>
    </Box>
  );
}

type VerificationCanceledProps = {
  onClose: () => void;
};
function VerificationCanceled({ onClose }: VerificationCanceledProps) {
  return (
    <Box direction="Column" gap="400">
      <Text>Verification has been canceled.</Text>
      <Button variant="Secondary" fill="Soft" onClick={onClose}>
        <Text size="B400">Close</Text>
      </Button>
    </Box>
  );
}

type DeviceVerificationProps = {
  request: VerificationRequest;
  onExit: () => void;
};
export function DeviceVerification({ request, onExit }: DeviceVerificationProps) {
  const phase = useVerificationRequestPhase(request);
  const [verified, setVerified] = useState(false);
  const verifiedRef = useRef(false);

  useEffect(() => {
    verifiedRef.current = false;
    setVerified(false);
  }, [request]);

  const handleVerified = useCallback(() => {
    verifiedRef.current = true;
    setVerified(true);
  }, []);

  const handleCancel = useCallback(() => {
    if (
      !verifiedRef.current &&
      request.phase !== VerificationPhase.Done &&
      request.phase !== VerificationPhase.Cancelled
    ) {
      request.cancel().catch(() => undefined);
    }
    onExit();
  }, [request, onExit]);

  const done = verified || phase === VerificationPhase.Done;

  const handleAccept = useCallback(() => request.accept(), [request]);
  const handleStart = useCallback(async () => {
    await request.startVerification(VerificationMethod.Sas);
  }, [request]);

  return (
    <Overlay open backdrop={<OverlayBackdrop />}>
      <OverlayCenter>
        <FocusTrap
          focusTrapOptions={{
            initialFocus: false,
            clickOutsideDeactivates: false,
            escapeDeactivates: false,
          }}
        >
          <Dialog variant="Surface">
            <Header style={DialogHeaderStyles} variant="Surface" size="500">
              <Box grow="Yes">
                <Text size="H4">Device Verification</Text>
              </Box>
              <IconButton size="300" radii="300" onClick={handleCancel}>
                <Icon src={Icons.Cross} />
              </IconButton>
            </Header>
            <Box style={{ padding: config.space.S400 }} direction="Column" gap="400">
              {phase === VerificationPhase.Requested &&
                (request.initiatedByMe ? (
                  <VerificationWaitAccept />
                ) : (
                  <VerificationAccept onAccept={handleAccept} />
                ))}
              {phase === VerificationPhase.Ready &&
                (request.initiatedByMe ? (
                  <AutoVerificationStart onStart={handleStart} />
                ) : (
                  <VerificationWaitStart />
                ))}
              {phase === VerificationPhase.Started &&
                !done &&
                (request.verifier ? (
                  <SasVerification
                    verifier={request.verifier}
                    onCancel={handleCancel}
                    onVerified={handleVerified}
                  />
                ) : (
                  <VerificationUnexpected
                    message="Unexpected Error! Verification is started but verifier is missing."
                    onClose={handleCancel}
                  />
                ))}
              {done && <VerificationDone onExit={onExit} />}
              {!done && phase === VerificationPhase.Cancelled && (
                <VerificationCanceled onClose={handleCancel} />
              )}
            </Box>
          </Dialog>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}

export function ReceiveSelfDeviceVerification() {
  const mx = useMatrixClient();
  const [request, setRequest] = useState<VerificationRequest>();

  // Only a live request from another of our devices may take over the dialog; a settled one,
  // or one this device sent, would otherwise replace a newer request on screen.
  useVerificationRequestReceived(
    useCallback((received: VerificationRequest) => {
      if (!received.isSelfVerification || received.initiatedByMe || !received.pending) return;
      setRequest(received);
    }, []),
  );

  // This component mounts only after the first sync and the server config load, so a request
  // delivered in the first sync batch fired VerificationRequestReceived before anyone listened.
  useEffect(() => {
    const crypto = mx.getCrypto();
    if (!mx.clientRunning || !crypto) return;

    try {
      const pending = crypto
        .getVerificationRequestsToDeviceInProgress(mx.getSafeUserId())
        .find(
          (candidate) =>
            candidate.isSelfVerification && !candidate.initiatedByMe && candidate.pending,
        );
      if (pending) setRequest(pending);
    } catch {
      // The OlmMachine can be freed between the clientRunning check and this call.
    }
  }, [mx]);

  const handleExit = useCallback(() => {
    setRequest(undefined);
  }, []);

  if (!request) return null;

  if (!request.isSelfVerification) {
    return null;
  }

  return <DeviceVerification request={request} onExit={handleExit} />;
}

import { Dialog, Text, Box, Button, config } from 'folds';
import { AuthType } from 'matrix-js-sdk';
import ReCAPTCHA from 'react-google-recaptcha';
import { StageComponentProps } from './types';
import { HCaptchaWidget } from './HCaptchaStage';
import { FallbackStageDialog } from './FallbackStage';

/**
 * `m.login.recaptcha` does not say which captcha provider is behind it.
 *
 * Synapse exposes `recaptcha_siteverify_api`, and hCaptcha ships a
 * compatible siteverify endpoint, so plenty of servers run hCaptcha under the
 * spec's reCAPTCHA stage. The sitekey formats are distinct enough to tell them
 * apart reliably:
 *
 *   Google reCAPTCHA  6LcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA   (always "6L…")
 *   hCaptcha          10000000-ffff-ffff-ffff-000000000001       (a UUID)
 *
 * Anything else is a provider we do not know, and guessing would render a
 * widget that cannot succeed. Those go to the server's own fallback page,
 * which is always correct because the server renders it.
 */
const GOOGLE_SITEKEY_REG = /^6L[0-9A-Za-z_-]{20,}$/;
const HCAPTCHA_SITEKEY_REG = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type CaptchaProvider = 'recaptcha' | 'hcaptcha' | 'unknown';

export const detectCaptchaProvider = (publicKey: string): CaptchaProvider => {
  if (HCAPTCHA_SITEKEY_REG.test(publicKey)) return 'hcaptcha';
  if (GOOGLE_SITEKEY_REG.test(publicKey)) return 'recaptcha';
  return 'unknown';
};

function ReCaptchaErrorDialog({
  title,
  message,
  onCancel,
}: {
  title: string;
  message: string;
  onCancel: () => void;
}) {
  return (
    <Dialog>
      <Box style={{ padding: config.space.S400 }} direction="Column" gap="400">
        <Box direction="Column" gap="100">
          <Text size="H4">{title}</Text>
          <Text>{message}</Text>
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

export function ReCaptchaStageDialog({ stageData, submitAuthDict, onCancel }: StageComponentProps) {
  const { info, session } = stageData;

  const publicKey = info?.public_key;

  const handleChange = (token: string | null) => {
    submitAuthDict({
      type: AuthType.Recaptcha,
      response: token,
      session,
    });
  };

  if (typeof publicKey !== 'string' || !session) {
    return (
      <ReCaptchaErrorDialog
        title="Invalid Data"
        message="No valid data found to proceed with ReCAPTCHA."
        onCancel={onCancel}
      />
    );
  }

  const provider = detectCaptchaProvider(publicKey);

  // Unrecognised provider: the server's own fallback page renders whatever it
  // actually uses, so hand off rather than showing a widget that cannot pass.
  if (provider === 'unknown') {
    return (
      <FallbackStageDialog
        stageData={stageData}
        submitAuthDict={submitAuthDict}
        onCancel={onCancel}
      />
    );
  }

  return (
    <Dialog>
      <Box style={{ padding: config.space.S400 }} direction="Column" gap="400">
        <Text>Please check the box below to proceed.</Text>
        {provider === 'hcaptcha' ? (
          <HCaptchaWidget publicKey={publicKey} session={session} submitAuthDict={submitAuthDict} />
        ) : (
          <ReCAPTCHA sitekey={publicKey} onChange={handleChange} />
        )}
      </Box>
    </Dialog>
  );
}

import { Box, Button, Icon, Icons, Text } from 'folds';
import { AttachmentTamperedError, isFinalAttachmentError } from '../../../utils/matrix';

type AttachmentLoadErrorProps = {
  error: unknown;
  onRetry?: () => void;
  /** What was being loaded, for the retry label: "Retry", "Retry Download (2 MB)". */
  retryLabel?: string;
  size?: '300' | '400';
};

/** The text for a failure retrying cannot fix, or undefined for one it can. */
export const finalAttachmentMessage = (error: unknown): string | undefined => {
  if (!isFinalAttachmentError(error)) return undefined;
  return error instanceof AttachmentTamperedError
    ? 'This attachment failed its integrity check. It may have been altered after it was sent, so it is not shown.'
    : "This attachment can't be decrypted.";
};

/**
 * Why an attachment is not shown. Retry is offered only where trying again can help (a network
 * or server failure); a hash mismatch or an undecryptable attachment is final, and the integrity
 * warning must not hide behind a generic "failed to load".
 */
export function AttachmentLoadError({
  error,
  onRetry,
  retryLabel = 'Retry',
  size = '400',
}: AttachmentLoadErrorProps) {
  const final = finalAttachmentMessage(error);
  if (final) {
    return (
      <Box alignItems="Center" gap="200" role="alert">
        <Icon size="100" src={Icons.Warning} filled />
        <Text size="T200" priority="400">
          {final}
        </Text>
      </Box>
    );
  }

  if (!onRetry) {
    return (
      <Text size="T200" priority="300" role="alert">
        Failed to load.
      </Text>
    );
  }

  return (
    <Button
      size={size}
      variant="Critical"
      fill="Soft"
      outlined
      radii="300"
      onClick={onRetry}
      before={<Icon size="100" src={Icons.Warning} filled />}
      aria-label={`Failed to load. ${retryLabel}`}
    >
      <Text size="B300" truncate>
        {retryLabel}
      </Text>
    </Button>
  );
}

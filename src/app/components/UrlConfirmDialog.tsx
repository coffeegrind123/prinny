import { CSSProperties, ReactNode } from 'react';
import {
  Box,
  Button,
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
  config,
} from 'folds';
import { FocusTrap } from 'focus-trap-react';
import { describeUrlTarget } from '../../types/matrix/bot';
import { stopPropagation } from '../utils/keyboard';

const DialogHeaderStyles: CSSProperties = {
  padding: `0 ${config.space.S200} 0 ${config.space.S400}`,
  borderBottomWidth: config.borderWidth.B300,
};

type UrlConfirmDialogProps = {
  url: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Who the link comes from; the default suits bot buttons. */
  intro?: string;
  /** Shown above the buttons, e.g. what else confirming will do. */
  warning?: ReactNode;
  confirmLabel?: string;
  /** Confirming is in progress: the confirm button shows a spinner. */
  busy?: boolean;
};

/**
 * Confirmation before following a link a bot supplied.
 *
 * The label on a button, or the text of a menu button, is whatever its sender
 * wrote. The host is the one part they cannot misrepresent — so the host is
 * what this shows, on its own line and larger than the URL it came from.
 *
 * Shared by every place a bot-supplied URL can be opened, so there is one
 * behaviour to reason about rather than one per call site.
 */
export function UrlConfirmDialog({
  url,
  onConfirm,
  onCancel,
  intro = 'This link was sent by a bot. It goes to:',
  warning,
  confirmLabel = 'Open',
  busy = false,
}: UrlConfirmDialogProps) {
  return (
    <Overlay open backdrop={<OverlayBackdrop />}>
      <OverlayCenter>
        <FocusTrap
          focusTrapOptions={{
            initialFocus: false,
            onDeactivate: onCancel,
            clickOutsideDeactivates: true,
            escapeDeactivates: stopPropagation,
          }}
        >
          <Dialog variant="Surface">
            <Header style={DialogHeaderStyles} variant="Surface" size="500">
              <Box grow="Yes">
                <Text size="H4">Open link?</Text>
              </Box>
              <IconButton size="300" onClick={onCancel} radii="300">
                <Icon src={Icons.Cross} />
              </IconButton>
            </Header>
            <Box style={{ padding: config.space.S400 }} direction="Column" gap="300">
              <Text size="T200" priority="300">
                {intro}
              </Text>
              <Text size="H5">{describeUrlTarget(url)}</Text>
              <Text size="T200" priority="300" style={{ wordBreak: 'break-all' }}>
                {url}
              </Text>
              {warning}
              <Box gap="200" justifyContent="End">
                <Button variant="Secondary" fill="Soft" radii="300" onClick={onCancel}>
                  <Text size="B400">Cancel</Text>
                </Button>
                <Button
                  variant="Primary"
                  radii="300"
                  onClick={onConfirm}
                  disabled={busy}
                  before={busy ? <Spinner size="100" variant="Primary" fill="Solid" /> : undefined}
                >
                  <Text size="B400">{confirmLabel}</Text>
                </Button>
              </Box>
            </Box>
          </Dialog>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}

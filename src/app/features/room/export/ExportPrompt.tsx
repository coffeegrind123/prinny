import { useCallback, useRef, useState } from 'react';
import {
  Box,
  Button,
  Header,
  Icon,
  IconButton,
  Icons,
  Input,
  Modal,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Scroll,
  Spinner,
  Switch,
  Text,
  color,
  config,
} from 'folds';
import { FocusTrap } from 'focus-trap-react';
import { Room } from 'matrix-js-sdk';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../../hooks/useMediaAuthentication';
import { AsyncStatus, useAsyncCallback } from '../../../hooks/useAsyncCallback';
import { stopPropagation } from '../../../utils/keyboard';
import { SettingTile } from '../../../components/setting-tile';
import { ExportFormat, exportChat } from './exportChat';
import { mobileOrTablet } from '../../../utils/user-agent';
import FileSaver from '../../../utils/save-file';
import { safeDownloadFilename } from '../../../utils/mimeTypes';
import { ModalFlexScroll } from '../../../styles/Modal.css';

const FORMATS: { value: ExportFormat; label: string; hint: string }[] = [
  { value: 'html', label: 'HTML', hint: 'Opens in any browser' },
  { value: 'txt', label: 'Plain text', hint: 'One line per message' },
  { value: 'json', label: 'JSON', hint: 'Raw events, for tooling' },
];

const MAX_ATTACHMENT_MB = 25;

type ExportPromptProps = {
  room: Room;
  requestClose: () => void;
};

export function ExportPrompt({ room, requestClose }: ExportPromptProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();

  const [format, setFormat] = useState<ExportFormat>('html');
  // A phone exporting a busy room in full is how you get the tab killed rather
  // than a file, so the default range is small and deliberately visible.
  const [limit, setLimit] = useState(mobileOrTablet() ? 500 : 2000);
  // yyyy-mm-dd from <input type="date">, empty for no bound. Whole local days.
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [includeAttachments, setIncludeAttachments] = useState(false);
  const [progress, setProgress] = useState<string>();
  const [skipped, setSkipped] = useState(0);
  const abortRef = useRef<AbortController | undefined>(undefined);

  const [state, runExport] = useAsyncCallback<void, Error, []>(
    useCallback(async () => {
      const controller = new AbortController();
      abortRef.current = controller;
      setSkipped(0);

      const result = await exportChat(mx, room, {
        format,
        limit,
        since: fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : undefined,
        until: toDate ? new Date(`${toDate}T23:59:59.999`).getTime() : undefined,
        includeAttachments,
        maxAttachmentBytes: MAX_ATTACHMENT_MB * 1024 * 1024,
        useAuthentication,
        signal: controller.signal,
        onProgress: (message, fetched) => setProgress(`${message}… ${fetched} messages`),
      });

      setSkipped(result.skippedAttachments);
      // Same save path as every other download in the app, so the desktop and
      // Android shells route it the way they already know how to.
      const url = URL.createObjectURL(result.blob);
      FileSaver.saveAs(url, safeDownloadFilename(result.filename));
      // The shells consume the blob asynchronously; revoking immediately can
      // cancel the save before it starts.
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      setProgress(undefined);
    }, [mx, room, format, limit, fromDate, toDate, includeAttachments, useAuthentication]),
  );

  const exporting = state.status === AsyncStatus.Loading;

  const handleCancel = () => {
    abortRef.current?.abort();
    setProgress(undefined);
  };

  return (
    <Overlay open backdrop={<OverlayBackdrop />}>
      <OverlayCenter>
        <FocusTrap
          focusTrapOptions={{
            initialFocus: false,
            clickOutsideDeactivates: !exporting,
            onDeactivate: exporting ? undefined : requestClose,
            escapeDeactivates: stopPropagation,
          }}
        >
          <Modal size="300" flexHeight>
            <Box grow="Yes" direction="Column">
              <Header
                size="500"
                style={{ padding: config.space.S200, paddingLeft: config.space.S400 }}
              >
                <Box grow="Yes">
                  <Text size="H4">Export Chat</Text>
                </Box>
                <Box shrink="No">
                  <IconButton size="300" radii="300" onClick={requestClose} disabled={exporting}>
                    <Icon src={Icons.Cross} />
                  </IconButton>
                </Box>
              </Header>

              <Box grow="Yes">
                <Scroll className={ModalFlexScroll} size="300" hideTrack>
                  <Box style={{ padding: config.space.S400 }} direction="Column" gap="400">
                    <Box direction="Column" gap="100">
                      <Text size="L400">Format</Text>
                      <Box gap="100" wrap="Wrap">
                        {FORMATS.map((item) => (
                          <Button
                            key={item.value}
                            size="300"
                            radii="Pill"
                            variant={format === item.value ? 'Primary' : 'Secondary'}
                            fill={format === item.value ? 'Solid' : 'None'}
                            disabled={exporting}
                            onClick={() => setFormat(item.value)}
                          >
                            <Text size="T300">{item.label}</Text>
                          </Button>
                        ))}
                      </Box>
                      <Text size="T200" priority="300">
                        {FORMATS.find((f) => f.value === format)?.hint}
                      </Text>
                    </Box>

                    <Box direction="Column" gap="100">
                      <Text size="L400">Date range</Text>
                      <Box gap="200" alignItems="Center" wrap="Wrap">
                        <Box grow="Yes" direction="Column" gap="100">
                          <Text size="T200">From</Text>
                          <Input
                            value={fromDate}
                            max={toDate || undefined}
                            onChange={(evt) => setFromDate(evt.currentTarget.value)}
                            type="date"
                            variant="Background"
                            size="400"
                            radii="300"
                            disabled={exporting}
                          />
                        </Box>
                        <Box grow="Yes" direction="Column" gap="100">
                          <Text size="T200">To</Text>
                          <Input
                            value={toDate}
                            min={fromDate || undefined}
                            onChange={(evt) => setToDate(evt.currentTarget.value)}
                            type="date"
                            variant="Background"
                            size="400"
                            radii="300"
                            disabled={exporting}
                          />
                        </Box>
                      </Box>
                      <Text size="T200" priority="300">
                        Both days included. Leave either empty for no limit on that side.
                      </Text>
                    </Box>

                    <Box direction="Column" gap="100">
                      <Text size="L400">Number of recent messages</Text>
                      <Input
                        value={String(limit)}
                        onChange={(evt) => {
                          const next = parseInt(evt.currentTarget.value, 10);
                          setLimit(Number.isFinite(next) ? Math.max(1, Math.min(next, 50000)) : 1);
                        }}
                        type="number"
                        variant="Background"
                        size="400"
                        radii="300"
                        disabled={exporting}
                      />
                      <Text size="T200" priority="300">
                        Counted backwards from the latest message in the range. Large exports take a
                        while and are held in memory until the file is written.
                      </Text>
                    </Box>

                    <SettingTile
                      title="Include attachments"
                      description={`Bundles the export and its media into a zip. Files over ${MAX_ATTACHMENT_MB}MB are left out.`}
                      after={
                        <Switch
                          variant="Primary"
                          value={includeAttachments}
                          disabled={exporting}
                          onChange={setIncludeAttachments}
                        />
                      }
                    />

                    {progress && (
                      <Box alignItems="Center" gap="200">
                        <Spinner size="100" variant="Secondary" />
                        <Text size="T200" priority="300">
                          {progress}
                        </Text>
                      </Box>
                    )}

                    {skipped > 0 && state.status === AsyncStatus.Success && (
                      <Text size="T200" priority="300">
                        {`${skipped} attachment(s) were over the size limit and were not included.`}
                      </Text>
                    )}

                    {state.status === AsyncStatus.Error && (
                      <Text size="T200" style={{ color: color.Critical.Main }}>
                        {state.error.message === 'aborted'
                          ? 'Export cancelled.'
                          : 'The export failed.'}
                      </Text>
                    )}
                    {state.status === AsyncStatus.Success && !progress && (
                      <Text size="T200" style={{ color: color.Success.Main }}>
                        Export saved.
                      </Text>
                    )}
                  </Box>
                </Scroll>
              </Box>

              <Box
                shrink="No"
                direction="Column"
                style={{
                  padding: config.space.S400,
                  borderTopWidth: config.borderWidth.B300,
                }}
              >
                {exporting ? (
                  <Button variant="Critical" fill="Soft" outlined onClick={handleCancel}>
                    <Text size="B400">Cancel</Text>
                  </Button>
                ) : (
                  <Button variant="Primary" onClick={() => runExport()}>
                    <Text size="B400">Export</Text>
                  </Button>
                )}
              </Box>
            </Box>
          </Modal>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}

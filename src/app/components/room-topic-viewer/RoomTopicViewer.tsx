import { FormEventHandler, useCallback, useState } from 'react';
import {
  as,
  Box,
  Button,
  color,
  Header,
  Icon,
  IconButton,
  Icons,
  Modal,
  Scroll,
  Spinner,
  Text,
  TextArea,
} from 'folds';
import classNames from 'classnames';
import Linkify from 'linkify-react';
import { MatrixError } from 'matrix-js-sdk';
import * as css from './style.css';
import { LINKIFY_OPTS, scaleSystemEmoji } from '../../plugins/react-custom-html-parser';
import { AsyncStatus, useAsyncCallback } from '../../hooks/useAsyncCallback';
import { useAlive } from '../../hooks/useAlive';

export const RoomTopicViewer = as<
  'div',
  {
    name: string;
    topic: string;
    requestClose: () => void;
    // Supplying this makes the topic editable in place; omit it for read-only views
    // (explore, invites, lobby) or when the user lacks permission to set m.room.topic.
    onTopicChange?: (topic: string) => Promise<unknown>;
  }
>(({ name, topic, requestClose, onTopicChange, className, ...props }, ref) => {
  const alive = useAlive();
  const [editing, setEditing] = useState(false);

  const [saveState, save] = useAsyncCallback(
    useCallback(async (value: string) => onTopicChange?.(value), [onTopicChange]),
  );
  const saving = saveState.status === AsyncStatus.Loading;

  // An empty topic closes the viewer: the header only renders it for a non-empty topic,
  // so staying open would show a blank box.
  const commit = (value: string) => {
    if (value === topic) {
      setEditing(false);
      return;
    }

    save(value).then(() => {
      if (!alive()) {
        return;
      }
      setEditing(false);
      if (!value) {
        requestClose();
      }
    });
  };

  const handleSubmit: FormEventHandler<HTMLFormElement> = (evt) => {
    evt.preventDefault();
    const topicTextArea = (evt.target as HTMLFormElement).topicTextArea as
      HTMLTextAreaElement | undefined;
    if (!topicTextArea) {
      return;
    }
    commit(topicTextArea.value.trim());
  };

  return (
    <Modal
      size="300"
      flexHeight
      className={classNames(css.ModalFlex, className)}
      {...props}
      ref={ref}
    >
      <Header className={css.ModalHeader} variant="Surface" size="500">
        <Box grow="Yes">
          <Text size="H4" truncate>
            {name}
          </Text>
        </Box>
        <Box shrink="No" gap="100">
          {onTopicChange && !editing && (
            <>
              <IconButton
                size="300"
                radii="300"
                onClick={() => setEditing(true)}
                disabled={saving}
                aria-label="Edit topic"
              >
                <Icon src={Icons.Pencil} />
              </IconButton>
              <IconButton
                size="300"
                radii="300"
                onClick={() => commit('')}
                disabled={saving}
                aria-label="Clear topic"
              >
                {saving ? <Spinner size="100" /> : <Icon src={Icons.Delete} />}
              </IconButton>
            </>
          )}
          <IconButton size="300" onClick={requestClose} radii="300" aria-label="Close">
            <Icon src={Icons.Cross} />
          </IconButton>
        </Box>
      </Header>
      <Scroll className={css.ModalScroll} size="300" hideTrack>
        <Box className={css.ModalContent} direction="Column" gap="300">
          {editing ? (
            <Box as="form" onSubmit={handleSubmit} direction="Column" gap="300">
              <TextArea
                name="topicTextArea"
                defaultValue={topic}
                variant="Secondary"
                radii="300"
                readOnly={saving}
                autoFocus
              />
              <Box gap="300">
                <Button
                  type="submit"
                  variant="Success"
                  size="300"
                  radii="300"
                  disabled={saving}
                  before={saving && <Spinner size="100" variant="Success" fill="Solid" />}
                >
                  <Text size="B300">Save</Text>
                </Button>
                <Button
                  type="button"
                  onClick={() => setEditing(false)}
                  variant="Secondary"
                  fill="Soft"
                  size="300"
                  radii="300"
                  disabled={saving}
                >
                  <Text size="B300">Cancel</Text>
                </Button>
              </Box>
            </Box>
          ) : (
            <Text size="T300" className={css.ModalTopic} priority="400">
              <Linkify options={LINKIFY_OPTS}>{scaleSystemEmoji(topic)}</Linkify>
            </Text>
          )}
          {saveState.status === AsyncStatus.Error && (
            <Text size="T200" style={{ color: color.Critical.Main }}>
              {(saveState.error as MatrixError).message}
            </Text>
          )}
        </Box>
      </Scroll>
    </Modal>
  );
});

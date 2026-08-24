import React, {
  KeyboardEventHandler,
  RefObject,
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { isKeyHotkey } from '../../utils/is-hotkey';
import { EventType, IContent, MsgType, RelationType, Room } from 'matrix-js-sdk';
import { Transforms, Editor } from 'slate';
import {
  Box,
  color,
  Dialog,
  Icon,
  IconButton,
  Icons,
  Line,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  PopOut,
  Scroll,
  Text,
  config,
  toRem,
} from 'folds';

import { useMatrixClient } from '../../hooks/useMatrixClient';
import {
  CustomEditor,
  Toolbar,
  toMatrixCustomHTML,
  toPlainText,
  AUTOCOMPLETE_PREFIXES,
  AutocompletePrefix,
  AutocompleteQuery,
  getAutocompleteQuery,
  getPrevWorldRange,
  resetEditor,
  RoomMentionAutocomplete,
  UserMentionAutocomplete,
  EmoticonAutocomplete,
  createEmoticonElement,
  moveCursor,
  safeFocusEditor,
  resetEditorHistory,
  customHtmlEqualsPlainText,
  trimCustomHtml,
  isEmptyEditor,
  getBeginCommand,
  trimCommand,
  getMentions,
  replaceShortcodeWithEmoji,
} from '../../components/editor';
import { EmojiBoard, EmojiBoardTab } from '../../components/emoji-board';
import { UseStateProvider } from '../../components/UseStateProvider';
import {
  TUploadContent,
  decryptFile,
  downloadEncryptedMedia,
  encryptFile,
  getImageInfo,
  getMxIdLocalPart,
  mxcUrlToHttp,
  uploadContent,
} from '../../utils/matrix';
import { useTypingStatusUpdater } from '../../hooks/useTypingStatusUpdater';
import { useFilePicker } from '../../hooks/useFilePicker';
import { useKeybind } from '../../hooks/useKeybind';
import { useFilePasteHandler } from '../../hooks/useFilePasteHandler';
import { useFileDropZone, setGlobalDropHandler } from '../../hooks/useFileDrop';
import {
  TUploadItem,
  TUploadMetadata,
  roomIdToMsgDraftAtomFamily,
  roomIdToReplyDraftAtomFamily,
  roomIdToUploadItemsAtomFamily,
  roomUploadAtomFamily,
} from '../../state/room/roomInputDrafts';
import { UploadCardRenderer } from '../../components/upload-card';
import {
  UploadBoard,
  UploadBoardContent,
  UploadBoardHeader,
  UploadBoardImperativeHandlers,
} from '../../components/upload-board';
import {
  Upload,
  UploadStatus,
  UploadSuccess,
  createUploadFamilyObserverAtom,
} from '../../state/upload';
import { getDataTransferFiles, getImageUrlBlob, loadImageElement } from '../../utils/dom';
import { filesToUploadItems } from '../../utils/uploadItems';
import { fulfilledPromiseSettledResult } from '../../utils/common';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';
import { getKeybindDefinition } from '../../state/keybinds';
import {
  getAudioMsgContent,
  getFileMsgContent,
  getImageMsgContent,
  getVideoMsgContent,
  getVoiceMsgContent,
} from './msgContent';
import { FocusTrap } from 'focus-trap-react';
import { stopPropagation } from '../../utils/keyboard';
import { VoiceRecordBar } from './voice/VoiceRecordBar';
import { MicPermissionDialog } from './voice/MicPermissionDialog';
import { useMicrophonePermission } from '../../hooks/useMicrophonePermission';
import { VoiceRecordStatus, useVoiceRecorder } from './voice/useVoiceRecorder';
import { isVoiceRecordingSupported } from '../../plugins/voice-recorder';
import { rainbowHtml } from '../../utils/rainbow';
import { EFFECT_MSG_TYPES, EffectName, isEffectName } from '../../plugins/effects';
import { PollCreatePrompt } from './poll/PollCreatePrompt';
import { LocationPicker } from './location/LocationPicker';
import { useMapStyleUrl } from '../../hooks/useMapStyleUrl';
import { getMemberDisplayName, getMentionContent, trimReplyFromBody } from '../../utils/room';
import { CommandAutocomplete } from './CommandAutocomplete';
import { Command, SHRUG, TABLEFLIP, UNFLIP, useCommands } from '../../hooks/useCommands';
import { mobileOrTablet } from '../../utils/user-agent';
import { useElementSizeObserver } from '../../hooks/useElementSizeObserver';
import { ReplyLayout, ThreadIndicator } from '../../components/message';
import { roomToParentsAtom } from '../../state/room/roomToParents';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { useImagePackRooms } from '../../hooks/useImagePackRooms';
import { useEmojiShortcodeMap } from '../../hooks/useEmojiShortcodeMap';
import { FavoriteGif } from '../../state/gifFavorites';
import { GALLERY_MSGTYPE, MATRIX_GIF_PROPERTY_NAME } from '../../../types/matrix/common';
import { animatedImageInfo, blobIsAnimated } from '../../utils/animatedMedia';
import { getGifToSend, isGifVideo } from '../../utils/klipy';
import { usePowerLevelsContext } from '../../hooks/usePowerLevels';
import colorMXID from '../../../util/colorMXID';
import { useIsDirectRoom } from '../../hooks/useRoom';
import { useAccessiblePowerTagColors, useGetMemberPowerTag } from '../../hooks/useMemberPowerTag';
import { useRoomCreators } from '../../hooks/useRoomCreators';
import { useTheme } from '../../hooks/useTheme';
import { useRoomCreatorsTag } from '../../hooks/useRoomCreatorsTag';
import { useBotReplyKeyboard } from '../../hooks/useBotReplyKeyboard';
import { BotReplyKeyboard } from './BotReplyKeyboard';
import { BotMenuButton } from './BotMenuButton';
import { usePowerLevelTags } from '../../hooks/usePowerLevelTags';
import { useComposingCheck } from '../../hooks/useComposingCheck';

// Bridges the global `toggle-emoji-picker` keybind into the emoji
// board's per-instance UseStateProvider scope. Lives as a child of
// the provider so it can call its setter without lifting state.
function EmojiPickerKeybind({ onToggle }: { onToggle: () => void }) {
  useKeybind('toggle-emoji-picker', onToggle);
  return null;
}

interface RoomInputProps {
  editor: Editor;
  fileDropContainerRef: RefObject<HTMLElement | null>;
  roomId: string;
  room: Room;
  /**
   * When set, everything typed here is sent as a reply in that thread, and
   * drafts are kept separately from the room's main composer — otherwise a
   * half-typed thread reply would appear in the room composer behind it.
   */
  threadRootId?: string;
  /**
   * Latest event in the thread, used for the reply fallback the spec asks for.
   * Falls back to the root when the thread has no replies yet.
   */
  threadLatestEventId?: string;
}
export const RoomInput = forwardRef<HTMLDivElement, RoomInputProps>(
  ({ editor, fileDropContainerRef, roomId, room, threadRootId, threadLatestEventId }, ref) => {
    const mx = useMatrixClient();
    const useAuthentication = useMediaAuthentication();
    const [enterForNewline] = useSetting(settingsAtom, 'enterForNewline');
    const [keybinds] = useSetting(settingsAtom, 'keybinds');
    /**
     * The send binding, read from the registry rather than hardcoded.
     *
     * `send-message` has been listed in the keybind settings as rebindable
     * since the registry was written, while this handler tested a literal
     * `mod+enter` — so changing it there did nothing at all. Bare Enter stays
     * separate and is governed by `enterForNewline`, not by this binding:
     * they are two different questions and always were.
     */
    const sendKeys =
      keybinds['send-message'] ?? getKeybindDefinition('send-message')?.defaultKeys ?? 'mod+enter';
    const [isMarkdown] = useSetting(settingsAtom, 'isMarkdown');
    const [hideTypingStatus] = useSetting(settingsAtom, 'hideTypingStatus');
    const [galleryUploads] = useSetting(settingsAtom, 'galleryUploads');
    const [legacyUsernameColor] = useSetting(settingsAtom, 'legacyUsernameColor');
    const direct = useIsDirectRoom();
    const commands = useCommands(mx, room);
    // Read once: the answer cannot change for the life of the component, and
    // calling it during render on every keystroke re-parses the user agent.
    const isMobile = useMemo(mobileOrTablet, []);
    // Timestamp of the last touch-driven send, so the synthetic click that a
    // touchend generates is not treated as a second press. See the send button.
    const lastSendTouchEndRef = useRef(-Infinity);
    const emojiBtnRef = useRef<HTMLButtonElement>(null);
    const roomToParents = useAtomValue(roomToParentsAtom);
    const powerLevels = usePowerLevelsContext();
    const creators = useRoomCreators(room);

    // Drafts, attachments and the reply preview are scoped per composer, so a
    // thread panel and the room behind it never share state.
    const draftScope = threadRootId ? `${roomId}|thread:${threadRootId}` : roomId;

    const [msgDraft, setMsgDraft] = useAtom(roomIdToMsgDraftAtomFamily(draftScope));
    const [replyDraft, setReplyDraft] = useAtom(roomIdToReplyDraftAtomFamily(draftScope));
    const replyUserID = replyDraft?.userId;

    const botKeyboard = useBotReplyKeyboard(room);

    // `force_reply`: arm the composer as a reply to the bot's question.
    //
    // Armed once per prompt, and never over a reply the user set themselves —
    // a bot asking a question does not get to redirect a reply someone was
    // already composing.
    const armedForceReplyId = useRef<string | null>(null);
    useEffect(() => {
      const state = botKeyboard.state;
      if (state.kind !== 'force_reply') {
        armedForceReplyId.current = null;
        return;
      }
      if (armedForceReplyId.current === state.eventId) return;
      armedForceReplyId.current = state.eventId;
      if (replyDraft) return;

      const target = room.findEventById(state.eventId);
      if (!target) return;
      const content = target.getContent();
      setReplyDraft({
        userId: state.botUserId,
        eventId: state.eventId,
        body: typeof content.body === 'string' ? content.body : '',
      });
      safeFocusEditor(editor);
    }, [botKeyboard.state, replyDraft, room, setReplyDraft, editor]);

    const powerLevelTags = usePowerLevelTags(room, powerLevels);
    const creatorsTag = useRoomCreatorsTag();
    const getMemberPowerTag = useGetMemberPowerTag(room, creators, powerLevels);
    const theme = useTheme();
    const accessibleTagColors = useAccessiblePowerTagColors(
      theme.kind,
      creatorsTag,
      powerLevelTags,
    );

    const replyPowerTag = replyUserID ? getMemberPowerTag(replyUserID) : undefined;
    const replyPowerColor = replyPowerTag?.color
      ? accessibleTagColors.get(replyPowerTag.color)
      : undefined;
    const replyUsernameColor =
      legacyUsernameColor || direct ? colorMXID(replyUserID ?? '') : replyPowerColor;

    const [uploadBoard, setUploadBoard] = useState(true);
    const [selectedFiles, setSelectedFiles] = useAtom(roomIdToUploadItemsAtomFamily(draftScope));
    const uploadFamilyObserverAtom = createUploadFamilyObserverAtom(
      roomUploadAtomFamily,
      selectedFiles.map((f) => f.file),
    );
    const uploadBoardHandlers = useRef<UploadBoardImperativeHandlers | undefined>(undefined);

    const imagePackRooms: Room[] = useImagePackRooms(roomId, roomToParents);
    const emojiShortcodeMap = useEmojiShortcodeMap(imagePackRooms);

    const [toolbar, setToolbar] = useSetting(settingsAtom, 'editorToolbar');
    const [autocompleteQuery, setAutocompleteQuery] =
      useState<AutocompleteQuery<AutocompletePrefix>>();

    const sendTypingStatus = useTypingStatusUpdater(mx, roomId);

    const [emojiShortcodeReplace] = useSetting(settingsAtom, 'emojiShortcodeReplace');
    const handleEditorChange = useCallback(() => {
      if (!emojiShortcodeReplace) return;
      // Only look when the change actually introduced a ':'. Every keystroke
      // runs through here, and scanning back from the cursor for a shortcode on
      // each one buys nothing when no colon was typed.
      const hasColonInsert = editor.operations.some(
        (op) => op.type === 'insert_text' && op.text.includes(':'),
      );
      if (hasColonInsert) {
        replaceShortcodeWithEmoji(editor, emojiShortcodeMap);
      }
    }, [editor, emojiShortcodeMap, emojiShortcodeReplace]);

    const voiceRecorder = useVoiceRecorder(roomId);
    const micPermission = useMicrophonePermission();
    const [micPrompt, setMicPrompt] = useState(false);

    /**
     * Tapping record asks us before it asks the system.
     *
     * `getUserMedia` raises the platform prompt itself, so recording without
     * this would work — but the user meets Android's bare "Allow Prinny to
     * record audio?" with no idea what asked for it, and that prompt is only
     * offered once. A refusal there is effectively permanent, which makes the
     * explanation worth a tap.
     *
     * Only the first time, and only when the platform has not already said yes:
     * `granted` records immediately, every time. `unknown` counts as
     * "worth asking" rather than "denied" — the Permissions API does not have
     * to implement the microphone descriptor, and treating silence as refusal
     * would put the dialog in front of every recording forever.
     */
    const handleVoiceRecordClick = useCallback(() => {
      if (voiceRecorder.status === VoiceRecordStatus.Recording) {
        voiceRecorder.stop();
        return;
      }
      if (voiceRecorder.status !== VoiceRecordStatus.Idle) return;
      if (micPermission.state === 'granted') {
        voiceRecorder.start();
        return;
      }
      setMicPrompt(true);
    }, [voiceRecorder, micPermission.state]);

    const handleMicAllow = useCallback(async () => {
      const result = await micPermission.request();
      if (result.state !== 'granted') return;
      setMicPrompt(false);
      voiceRecorder.start();
    }, [micPermission, voiceRecorder]);
    const [pollPrompt, setPollPrompt] = useState(false);
    const [locationPrompt, setLocationPrompt] = useState(false);
    // Location sharing needs somewhere to draw a map. Without a tile server
    // the picker is a grey rectangle you cannot aim, so `/location` is not
    // offered at all rather than opening something that cannot work.
    const mapStyleUrl = useMapStyleUrl();
    const voiceActive = voiceRecorder.status !== VoiceRecordStatus.Idle;
    // Checked once rather than per render: a build without WASM or without
    // getUserMedia can never record, and offering a button that always fails is
    // worse than not offering it.
    const voiceSupported = useMemo(() => isVoiceRecordingSupported(), []);

    const handleFiles = useCallback(
      async (files: File[]) => {
        setUploadBoard(true);
        setSelectedFiles({
          type: 'PUT',
          item: await filesToUploadItems(room, files),
        });
      },
      [setSelectedFiles, room],
    );

    // Register this room's file handler for global (anywhere-in-window) drops.
    //
    // Only the room composer claims it. A thread composer is mounted alongside
    // the room one, so if both registered, the thread's cleanup on close would
    // null out the handler the room composer had installed — leaving
    // drag-and-drop dead in that room until you navigated away and back.
    useEffect(() => {
      if (threadRootId) return undefined;
      setGlobalDropHandler(handleFiles);
      return () => setGlobalDropHandler(null);
    }, [handleFiles, threadRootId]);

    const pickFile = useFilePicker(handleFiles, true);
    const handlePaste = useFilePasteHandler(handleFiles);

    // Upload via `mod+shift+u`. Bound here (not in GlobalKeybinds) because
    // the file picker dispatches into the active room's handleFiles —
    // RoomInput is mounted per-room so the binding is implicitly scoped.
    useKeybind('upload-file', () => {
      // Window-level shortcuts belong to the room composer. With a thread panel
      // open there are two RoomInputs listening, and both would answer — one
      // keypress, two file pickers.
      if (threadRootId) return;
      pickFile('*/*');
    });

    // Escape from anywhere in the app should refocus the composer so users
    // can keep typing without re-clicking. ReactEditor.focus is the slate
    // primitive used elsewhere in this file.
    useKeybind('focus-textarea', () => {
      // Same reason as upload-file: only the room composer answers, or the two
      // composers fight over focus every time Escape is pressed.
      if (threadRootId) return;
      // Don't steal focus from a real OS-level prompt or another input.
      const active = document.activeElement as HTMLElement | null;
      if (active?.tagName === 'INPUT' || active?.tagName === 'TEXTAREA') return;
      try {
        safeFocusEditor(editor);
      } catch {
        // editor might be unmounted; ignore
      }
    });
    const handleDrop: React.DragEventHandler = useCallback(
      (evt) => {
        evt.preventDefault();
        const files = getDataTransferFiles(evt.dataTransfer);
        if (files) handleFiles(files);
      },
      [handleFiles],
    );
    const dropZoneVisible = useFileDropZone(fileDropContainerRef, handleFiles);
    const [hideStickerBtn, setHideStickerBtn] = useState(document.body.clientWidth < 500);

    const isComposing = useComposingCheck();

    useElementSizeObserver(
      useCallback(() => fileDropContainerRef.current, [fileDropContainerRef]),
      useCallback((width) => setHideStickerBtn(width < 500), []),
    );

    useEffect(() => {
      Transforms.insertFragment(editor, msgDraft);
    }, [editor, msgDraft]);

    useEffect(
      () => () => {
        if (!isEmptyEditor(editor)) {
          const parsedDraft = JSON.parse(JSON.stringify(editor.children));
          setMsgDraft(parsedDraft);
        } else {
          setMsgDraft([]);
        }
        resetEditor(editor);
        resetEditorHistory(editor);
      },
      [roomId, editor, setMsgDraft],
    );

    const handleFileMetadata = useCallback(
      (fileItem: TUploadItem, metadata: TUploadMetadata) => {
        setSelectedFiles({
          type: 'REPLACE',
          item: fileItem,
          replacement: { ...fileItem, metadata },
        });
      },
      [setSelectedFiles],
    );

    const handleRemoveUpload = useCallback(
      (upload: TUploadContent | TUploadContent[]) => {
        const uploads = Array.isArray(upload) ? upload : [upload];
        setSelectedFiles({
          type: 'DELETE',
          item: selectedFiles.filter((f) => uploads.find((u) => u === f.file)),
        });
        uploads.forEach((u) => roomUploadAtomFamily.remove(u));
      },
      [setSelectedFiles, selectedFiles],
    );

    const handleCancelUpload = (uploads: Upload[]) => {
      uploads.forEach((upload) => {
        if (upload.status === UploadStatus.Loading) {
          mx.cancelUpload(upload.promise);
        }
      });
      handleRemoveUpload(uploads.map((upload) => upload.file));
    };

    const handleSendUpload = async (uploads: UploadSuccess[]) => {
      const contentsPromises = uploads.map(async (upload) => {
        const fileItem = selectedFiles.find((f) => f.file === upload.file);
        if (!fileItem) throw new Error('Broken upload');

        if (fileItem.file.type.startsWith('image')) {
          return getImageMsgContent(mx, fileItem, upload.mxc);
        }
        if (fileItem.file.type.startsWith('video')) {
          return getVideoMsgContent(mx, fileItem, upload.mxc);
        }
        if (fileItem.file.type.startsWith('audio')) {
          return getAudioMsgContent(fileItem, upload.mxc);
        }
        return getFileMsgContent(fileItem, upload.mxc);
      });
      handleCancelUpload(uploads);
      const contents = fulfilledPromiseSettledResult(await Promise.allSettled(contentsPromises));

      // MSC4274: several attachments as one message rather than one each.
      //
      // Sending five photos is one action to the sender and, without this, five
      // rows, five timestamps and five notification lines to everyone else. Off
      // by default because the identifier is still unstable — a client that has
      // not implemented it shows the fallback `body` and nothing else, so this
      // is only worth turning on where people know their room can read it.
      if (galleryUploads && contents.length > 1) {
        const galleryContent: IContent = {
          msgtype: GALLERY_MSGTYPE,
          body: contents.map((content) => content.body).join('\n'),
          itemtypes: contents.map((content) => {
            const { msgtype, ...rest } = content as IContent & { msgtype: string };
            return { ...rest, itemtype: msgtype };
          }),
        };
        applyRelation(galleryContent);
        mx.sendMessage(roomId, galleryContent as any);
        setReplyDraft(undefined);
        return;
      }

      contents.forEach((content, index) => {
        // Attachments sent from a thread composer must stay in the thread, and
        // an attachment sent while a reply is drafted must carry that reply —
        // this path used to apply the thread relation only, so replying and then
        // attaching a file silently dropped the reply.
        //
        // The reply itself goes on the first attachment alone: stamping every
        // file of a multi-file send with `m.in_reply_to` renders as N separate
        // replies to the same message. The rest still take the thread relation.
        applyRelation(content as IContent, { ignoreReplyDraft: index > 0 });
        mx.sendMessage(roomId, content as any);
      });
      setReplyDraft(undefined);
    };

    /**
     * Stamps the outgoing content with whatever relation applies: an explicit
     * reply if one is drafted, otherwise the thread this composer belongs to.
     *
     * Every send path goes through here. A thread composer that forgot to do
     * this on one path (attachments, say) would drop that message into the main
     * room instead, which looks like the message went to the wrong place —
     * because it did.
     *
     * `ignoreReplyDraft` is for the second and later files of one multi-file
     * send: the reply belongs to the first message only, but every message
     * still needs the thread relation.
     */
    const applyRelation = useCallback(
      (content: IContent, opts?: { ignoreReplyDraft?: boolean }) => {
        if (replyDraft && !opts?.ignoreReplyDraft) {
          content['m.relates_to'] = {
            'm.in_reply_to': {
              event_id: replyDraft.eventId,
            },
          };
          if (replyDraft.relation?.rel_type === RelationType.Thread) {
            content['m.relates_to'].event_id = replyDraft.relation.event_id;
            content['m.relates_to'].rel_type = RelationType.Thread;
            content['m.relates_to'].is_falling_back = false;
          }
          return;
        }

        if (threadRootId) {
          // A plain message in a thread still carries a reply fallback, so
          // clients that do not understand threads show it as a reply to the
          // most recent thread event rather than as a loose message.
          content['m.relates_to'] = {
            rel_type: RelationType.Thread,
            event_id: threadRootId,
            is_falling_back: true,
            'm.in_reply_to': {
              event_id: threadLatestEventId ?? threadRootId,
            },
          };
        }
      },
      [replyDraft, threadRootId, threadLatestEventId],
    );

    // Voice messages bypass the upload board on purpose. The board is a staging
    // area you add to and then send; a voice note is recorded, reviewed and
    // sent as one action, and showing it as a pending file card in between
    // would invite the user to send it twice.
    const handleSendVoice = useCallback(async () => {
      const { recording } = voiceRecorder;
      if (!recording) return;

      voiceRecorder.setSending(true);
      try {
        const file = new File([recording.blob], 'Voice message.ogg', { type: 'audio/ogg' });
        const encrypted = room.hasEncryptionStateEvent() ? await encryptFile(file) : undefined;
        const uploadFile = encrypted?.file ?? file;

        const mxc = await new Promise<string>((resolve, reject) => {
          uploadContent(mx, uploadFile, {
            // The filename says "Voice message" in every client that reads it,
            // so there is nothing to hide behind hideFilename here.
            onSuccess: resolve,
            onError: reject,
          });
        });

        const content = getVoiceMsgContent(
          {
            file: uploadFile,
            originalFile: file,
            encInfo: encrypted?.encInfo,
            metadata: { markedAsSpoiler: false },
          },
          mxc,
          recording.durationSeconds * 1000,
          recording.waveform,
        );

        const mentionData = getMentions(mx, roomId, editor);
        if (replyDraft && replyDraft.userId !== mx.getUserId()) {
          mentionData.users.add(replyDraft.userId);
        }
        content['m.mentions'] = getMentionContent(Array.from(mentionData.users), mentionData.room);

        applyRelation(content);

        await mx.sendMessage(roomId, content as any);
        voiceRecorder.discard();
        setReplyDraft(undefined);
      } catch (e) {
        console.error('Failed to send voice message', e);
        // Back to the preview with the audio intact — a failed upload must not
        // silently eat a recording the user cannot make again.
        voiceRecorder.setSending(false);
      }
    }, [mx, room, roomId, editor, replyDraft, setReplyDraft, voiceRecorder, applyRelation]);

    const submit = useCallback(() => {
      uploadBoardHandlers.current?.handleSend();

      const commandName = getBeginCommand(editor);
      let plainText = toPlainText(editor.children, isMarkdown).trim();
      let customHtml = trimCustomHtml(
        toMatrixCustomHTML(editor.children, {
          allowTextFormatting: true,
          allowBlockMarkdown: isMarkdown,
          allowInlineMarkdown: isMarkdown,
        }),
      );
      let msgType = MsgType.Text;
      let effectMsgType: string | undefined;
      const effectCommand =
        commandName && isEffectName(commandName) ? (commandName as EffectName) : undefined;

      // A command this client does not implement belongs to a bot in the room,
      // and a bot command is just text the bot parses — exactly as on Telegram.
      // So it keeps its leading `/` and gets sent as an ordinary message.
      //
      // Without this distinction every unknown command was silently eaten: the
      // branch at the end of this chain resets the editor and returns whether
      // or not it found a handler, so the message was never sent and nothing
      // said why.
      const isBuiltInCommand = commandName !== undefined && commandName in commands;

      if (commandName && isBuiltInCommand) {
        plainText = trimCommand(commandName, plainText);
        customHtml = trimCommand(commandName, customHtml);
      }
      if (commandName === Command.Me) {
        msgType = MsgType.Emote;
      } else if (commandName === Command.Notice) {
        msgType = MsgType.Notice;
      } else if (commandName === Command.Shrug) {
        plainText = `${SHRUG} ${plainText}`;
        customHtml = `${SHRUG} ${customHtml}`;
      } else if (commandName === Command.TableFlip) {
        plainText = `${TABLEFLIP} ${plainText}`;
        customHtml = `${TABLEFLIP} ${customHtml}`;
      } else if (commandName === Command.UnFlip) {
        plainText = `${UNFLIP} ${plainText}`;
        customHtml = `${UNFLIP} ${customHtml}`;
      } else if (commandName === Command.Rainbow || commandName === Command.RainbowMe) {
        if (commandName === Command.RainbowMe) msgType = MsgType.Emote;
        // Colour the plain text, not the generated HTML: wrapping already-built
        // markup would put a <font> tag around every tag character too.
        customHtml = rainbowHtml(plainText);
      } else if (commandName === Command.Plain) {
        // Markdown left as typed — the point of /plain is that `*this*` stays
        // `*this*`, so the HTML body is dropped entirely below.
        customHtml = plainText;
      } else if (commandName === Command.Html) {
        // The user asked for raw HTML. It is still sanitised on render, by the
        // same parser that sanitises everyone else's messages.
        customHtml = plainText;
      } else if (commandName === Command.Poll) {
        // Opens the prompt instead of sending anything. The typed remainder is
        // discarded rather than pre-filling the question, because `/poll` with
        // trailing text reads as "post this poll" and silently doing half of
        // that would be worse than doing none of it.
        setPollPrompt(true);
        resetEditor(editor);
        resetEditorHistory(editor);
        sendTypingStatus(false);
        return;
      } else if (commandName === Command.Location && mapStyleUrl) {
        setLocationPrompt(true);
        resetEditor(editor);
        resetEditorHistory(editor);
        sendTypingStatus(false);
        return;
      } else if (effectCommand) {
        // Effect messages are ordinary text with a custom msgtype. Clients that
        // do not know the msgtype fall back to showing the body, which is why
        // an empty one gets a default rather than posting a blank line.
        if (plainText === '') {
          plainText = `sends ${effectCommand}`;
          customHtml = plainText;
        }
        effectMsgType = EFFECT_MSG_TYPES[effectCommand];
      } else if (commandName && isBuiltInCommand) {
        const commandContent = commands[commandName as Command];
        if (commandContent) {
          commandContent.exe(plainText);
        }
        resetEditor(editor);
        resetEditorHistory(editor);
        sendTypingStatus(false);
        return;
      }

      if (plainText === '') return;

      const body = plainText;
      const formattedBody = customHtml;
      const mentionData = getMentions(mx, roomId, editor);

      const content: IContent = {
        msgtype: effectMsgType ?? msgType,
        body,
      };

      if (replyDraft && replyDraft.userId !== mx.getUserId()) {
        mentionData.users.add(replyDraft.userId);
      }

      const mMentions = getMentionContent(Array.from(mentionData.users), mentionData.room);
      content['m.mentions'] = mMentions;

      // `/html` is the one case where body and formatted body are identical on
      // purpose — the typed text IS the markup — so the usual "they match, skip
      // the HTML" shortcut would throw away the entire point of the command.
      const forceHtml = commandName === Command.Html;

      if (forceHtml || replyDraft || !customHtmlEqualsPlainText(formattedBody, body)) {
        content.format = 'org.matrix.custom.html';
        content.formatted_body = formattedBody;
      }
      applyRelation(content);
      mx.sendMessage(roomId, content as any);
      resetEditor(editor);
      resetEditorHistory(editor);
      setReplyDraft(undefined);
      sendTypingStatus(false);
      // Put the caret back in the composer on touch devices. Losing focus there
      // dismisses the on-screen keyboard, so sending two messages in a row cost
      // a tap on the input in between.
      if (isMobile) safeFocusEditor(editor);
    }, [
      mx,
      roomId,
      editor,
      replyDraft,
      sendTypingStatus,
      setReplyDraft,
      isMarkdown,
      commands,
      applyRelation,
      mapStyleUrl,
      isMobile,
    ]);

    // A quick-reply key sends its label as an ordinary message — no callback,
    // no markup — so a bot handles it with the same code that handles someone
    // typing the word, and every other client in the room sees a normal
    // message. That is what Telegram does, and it is why reply keyboards need
    // no support on the receiving side at all.
    const handleQuickReply = useCallback(
      (label: string) => {
        const content: IContent = { msgtype: MsgType.Text, body: label };
        applyRelation(content);
        mx.sendMessage(roomId, content as any);
        sendTypingStatus(false);
      },
      [mx, roomId, applyRelation, sendTypingStatus],
    );

    const handleKeyDown: KeyboardEventHandler = useCallback(
      (evt) => {
        if (
          (isKeyHotkey(sendKeys, evt) || (!enterForNewline && isKeyHotkey('enter', evt))) &&
          !isComposing(evt)
        ) {
          evt.preventDefault();
          submit();
        }
        if (isKeyHotkey('escape', evt)) {
          evt.preventDefault();
          if (autocompleteQuery) {
            setAutocompleteQuery(undefined);
            return;
          }
          setReplyDraft(undefined);
        }
      },
      [submit, setReplyDraft, enterForNewline, autocompleteQuery, isComposing, sendKeys],
    );

    const handleKeyUp: KeyboardEventHandler = useCallback(
      (evt) => {
        if (isKeyHotkey('escape', evt)) {
          evt.preventDefault();
          return;
        }

        if (!hideTypingStatus) {
          sendTypingStatus(!isEmptyEditor(editor));
        }

        const prevWordRange = getPrevWorldRange(editor);
        const query = prevWordRange
          ? getAutocompleteQuery<AutocompletePrefix>(editor, prevWordRange, AUTOCOMPLETE_PREFIXES)
          : undefined;
        setAutocompleteQuery(query);
      },
      [editor, sendTypingStatus, hideTypingStatus],
    );

    const handleCloseAutocomplete = useCallback(() => {
      setAutocompleteQuery(undefined);
      safeFocusEditor(editor);
    }, [editor]);

    const handleEmoticonSelect = (key: string, shortcode: string) => {
      editor.insertNode(createEmoticonElement(key, shortcode));
      moveCursor(editor);
    };

    const handleGifSelect = async (fav: FavoriteGif) => {
      const sendGifContent = (content: IContent) => {
        applyRelation(content);
        mx.sendMessage(roomId, content as any);
        setReplyDraft(undefined);
      };

      const safeGifName = (name: string, fallback: string) =>
        name
          .replace(/[/\\?%*:|"<>/]/g, '')
          .trim()
          .slice(0, 50) || fallback;

      try {
        // An unencrypted mxc favourite going into an unencrypted room can
        // reuse the already uploaded content without a re-upload.
        if (fav.kind === 'mxc' && !fav.video && !fav.encInfo && !room.hasEncryptionStateEvent()) {
          sendGifContent({
            msgtype: MsgType.Image,
            body: fav.body,
            filename: fav.body,
            url: fav.mxc,
            info: fav.info,
          });
          return;
        }

        let blob: Blob;
        let filename: string;
        let videoGif = fav.kind === 'url' || (fav.kind === 'mxc' && fav.video === true);
        if (fav.kind === 'klipy') {
          const format = getGifToSend(fav.gif);
          if (!format?.url) return;
          videoGif = isGifVideo(format);
          const resp = await fetch(format.url);
          if (!resp.ok) return;
          blob = await resp.blob();
          filename = `${safeGifName(fav.gif.title || 'gif', 'gif')}.${videoGif ? 'mp4' : 'gif'}`;
        } else if (fav.kind === 'mxc') {
          const mediaUrl = mxcUrlToHttp(mx, fav.mxc, useAuthentication);
          if (!mediaUrl) return;
          if (fav.encInfo) {
            const { encInfo } = fav;
            blob = await downloadEncryptedMedia(mediaUrl, (encBuf) =>
              decryptFile(encBuf, fav.info?.mimetype ?? 'image/gif', encInfo),
            );
          } else {
            const resp = await fetch(mediaUrl);
            if (!resp.ok) return;
            blob = await resp.blob();
          }
          const extension = videoGif ? 'mp4' : 'gif';
          const baseName = fav.body.replace(/\.(?:gif|mp4)$/i, '');
          filename = new RegExp(`\\.${extension}$`, 'i').test(fav.body)
            ? fav.body
            : `${safeGifName(baseName, 'gif')}.${extension}`;
        } else {
          const resp = await fetch(fav.videoUrl);
          if (!resp.ok) return;
          blob = await resp.blob();
          filename = `${safeGifName(fav.title || 'gif', 'gif')}.mp4`;
        }

        const defaultType = videoGif ? 'video/mp4' : 'image/gif';
        const file = new File([blob], filename, {
          type: blob.type || defaultType,
        });

        const encData = room.hasEncryptionStateEvent() ? await encryptFile(file) : undefined;
        const uploadFile = encData?.file ?? file;

        const uploadData = await mx.uploadContent(uploadFile);
        const mxc = uploadData?.content_uri;
        if (!mxc) return;

        const item: TUploadItem = {
          file,
          originalFile: file,
          encInfo: encData?.encInfo,
          metadata: { markedAsSpoiler: false },
        };
        const content = videoGif
          ? await getVideoMsgContent(mx, item, mxc)
          : await getImageMsgContent(mx, item, mxc);
        if (videoGif) content[MATRIX_GIF_PROPERTY_NAME] = true;

        sendGifContent(content);
      } catch (e) {
        console.error('Failed to send GIF', e);
      }
    };

    const handleStickerSelect = async (mxc: string, shortcode: string, label: string) => {
      const stickerUrl = mxcUrlToHttp(mx, mxc, useAuthentication);
      if (!stickerUrl) return;

      // MSC4230 covers `m.sticker` as well as `m.image`, and animated stickers
      // are the common case — a receiver that thumbnails one gets a still.
      const stickerBlob = await getImageUrlBlob(stickerUrl);
      const info = {
        ...(await getImageInfo(await loadImageElement(stickerUrl), stickerBlob)),
        ...animatedImageInfo(await blobIsAnimated(stickerBlob)),
      };

      // Stickers are a send path like any other, so they carry the drafted
      // reply and the thread relation too. Without this, picking a sticker
      // while a reply was staged posted it as a loose message — and inside a
      // thread it landed in the main room.
      const content = {
        body: label,
        url: mxc,
        info,
      };
      applyRelation(content as IContent);
      mx.sendEvent(roomId, EventType.Sticker, content);
      setReplyDraft(undefined);
    };

    return (
      <div ref={ref}>
        {pollPrompt && <PollCreatePrompt room={room} requestClose={() => setPollPrompt(false)} />}
        {locationPrompt && (
          <LocationPicker
            room={room}
            threadRootId={threadRootId}
            requestClose={() => setLocationPrompt(false)}
          />
        )}
        {selectedFiles.length > 0 && (
          <UploadBoard
            header={
              <UploadBoardHeader
                open={uploadBoard}
                onToggle={() => setUploadBoard(!uploadBoard)}
                uploadFamilyObserverAtom={uploadFamilyObserverAtom}
                onSend={handleSendUpload}
                imperativeHandlerRef={uploadBoardHandlers}
                onCancel={handleCancelUpload}
              />
            }
          >
            {uploadBoard && (
              <Scroll size="300" hideTrack visibility="Hover">
                <UploadBoardContent>
                  {Array.from(selectedFiles)
                    .reverse()
                    .map((fileItem, index) => (
                      <UploadCardRenderer
                        // eslint-disable-next-line react/no-array-index-key
                        key={index}
                        isEncrypted={!!fileItem.encInfo}
                        fileItem={fileItem}
                        setMetadata={handleFileMetadata}
                        onRemove={handleRemoveUpload}
                      />
                    ))}
                </UploadBoardContent>
              </Scroll>
            )}
          </UploadBoard>
        )}
        {micPrompt && (
          <Overlay open backdrop={<OverlayBackdrop />}>
            <OverlayCenter>
              <FocusTrap
                focusTrapOptions={{
                  onDeactivate: () => setMicPrompt(false),
                  clickOutsideDeactivates: true,
                  escapeDeactivates: stopPropagation,
                }}
              >
                <MicPermissionDialog
                  permission={micPermission}
                  onAllow={handleMicAllow}
                  onClose={() => setMicPrompt(false)}
                />
              </FocusTrap>
            </OverlayCenter>
          </Overlay>
        )}
        <Overlay
          open={dropZoneVisible}
          backdrop={<OverlayBackdrop />}
          style={{ pointerEvents: 'none' }}
        >
          <OverlayCenter>
            <Dialog variant="Primary">
              <Box
                direction="Column"
                justifyContent="Center"
                alignItems="Center"
                gap="500"
                style={{ padding: toRem(60) }}
              >
                <Icon size="600" src={Icons.File} />
                <Text size="H4" align="Center">
                  {`Drop Files in "${room?.name || 'Room'}"`}
                </Text>
                <Text align="Center">Drag and drop files here or click for selection dialog</Text>
              </Box>
            </Dialog>
          </OverlayCenter>
        </Overlay>
        {autocompleteQuery?.prefix === AutocompletePrefix.RoomMention && (
          <RoomMentionAutocomplete
            roomId={roomId}
            editor={editor}
            query={autocompleteQuery}
            requestClose={handleCloseAutocomplete}
          />
        )}
        {autocompleteQuery?.prefix === AutocompletePrefix.UserMention && (
          <UserMentionAutocomplete
            room={room}
            editor={editor}
            query={autocompleteQuery}
            requestClose={handleCloseAutocomplete}
          />
        )}
        {autocompleteQuery?.prefix === AutocompletePrefix.Emoticon && (
          <EmoticonAutocomplete
            imagePackRooms={imagePackRooms}
            editor={editor}
            query={autocompleteQuery}
            requestClose={handleCloseAutocomplete}
          />
        )}
        {autocompleteQuery?.prefix === AutocompletePrefix.Command && (
          <CommandAutocomplete
            room={room}
            editor={editor}
            query={autocompleteQuery}
            requestClose={handleCloseAutocomplete}
          />
        )}
        <CustomEditor
          editableName="RoomInput"
          editor={editor}
          onChange={handleEditorChange}
          // A bot's `input_field_placeholder` says what it is waiting for,
          // which is more useful than the generic prompt while it is waiting.
          placeholder={
            (botKeyboard.state.kind === 'force_reply' || botKeyboard.state.kind === 'keyboard') &&
            botKeyboard.state.markup.input_field_placeholder
              ? botKeyboard.state.markup.input_field_placeholder
              : 'Send a message...'
          }
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          onPaste={handlePaste}
          onDrop={handleDrop}
          top={
            <>
              <BotReplyKeyboard room={room} keyboard={botKeyboard} onPressKey={handleQuickReply} />
              {voiceRecorder.error && (
                <Box
                  alignItems="Center"
                  gap="200"
                  style={{ padding: `${config.space.S200} ${config.space.S300} 0` }}
                >
                  <Box grow="Yes">
                    <Text size="T200" style={{ color: color.Critical.Main }}>
                      {voiceRecorder.error}
                    </Text>
                  </Box>
                  <IconButton
                    onClick={voiceRecorder.clearError}
                    variant="SurfaceVariant"
                    size="300"
                    radii="300"
                    aria-label="Dismiss"
                  >
                    <Icon src={Icons.Cross} size="50" />
                  </IconButton>
                </Box>
              )}
              {voiceActive && <VoiceRecordBar controls={voiceRecorder} onSend={handleSendVoice} />}
              {replyDraft && (
                <div>
                  <Box
                    alignItems="Center"
                    gap="300"
                    style={{ padding: `${config.space.S200} ${config.space.S300} 0` }}
                  >
                    {/* Invisible spacer matching the attachment button's width so the
                      replied-to message stays aligned with the text input below.
                      The close button now lives on the right, nearer the send
                      controls — less mouse travel from the compose area. */}
                    <Box shrink="No" aria-hidden style={{ visibility: 'hidden' }}>
                      <IconButton variant="SurfaceVariant" size="300" radii="300" tabIndex={-1}>
                        <Icon src={Icons.Cross} size="50" />
                      </IconButton>
                    </Box>
                    <Box grow="Yes" direction="Row" gap="200" alignItems="Center">
                      {replyDraft.relation?.rel_type === RelationType.Thread && <ThreadIndicator />}
                      <ReplyLayout
                        userColor={replyUsernameColor}
                        username={
                          <Text size="T300" truncate>
                            <b>
                              {getMemberDisplayName(room, replyDraft.userId) ??
                                getMxIdLocalPart(replyDraft.userId) ??
                                replyDraft.userId}
                            </b>
                          </Text>
                        }
                      >
                        <Text size="T300" truncate>
                          {trimReplyFromBody(replyDraft.body)}
                        </Text>
                      </ReplyLayout>
                    </Box>
                    <Box shrink="No">
                      <IconButton
                        onClick={() => setReplyDraft(undefined)}
                        variant="SurfaceVariant"
                        size="300"
                        radii="300"
                      >
                        <Icon src={Icons.Cross} size="50" />
                      </IconButton>
                    </Box>
                  </Box>
                </div>
              )}
            </>
          }
          before={
            <>
              <IconButton
                onClick={() => pickFile('*/*')}
                variant="SurfaceVariant"
                size="300"
                radii="300"
                aria-label="Attach file"
              >
                <Icon src={Icons.PlusCircle} />
              </IconButton>
              {/* Only appears when a bot in this room published commands or
                  asked for a menu button. */}
              <BotMenuButton room={room} editor={editor} />
              {/* Polls and location sharing are reached with `/poll` and
                  `/location` rather than by a button each. Both are occasional
                  actions that open a full prompt, and a permanent icon for
                  each crowded the composer's left edge — on a phone the attach
                  button ended up sharing the row with two things most messages
                  never use. */}
            </>
          }
          after={
            <>
              {voiceSupported && (
                // Tap to start, tap again to stop — deliberately not
                // hold-to-record. A hold gesture on mobile fights the swipe
                // handlers behind the composer and loses the recording the
                // moment a finger slips off the button.
                <IconButton
                  variant={voiceActive ? 'Primary' : 'SurfaceVariant'}
                  size="300"
                  radii="300"
                  aria-label={
                    voiceRecorder.status === VoiceRecordStatus.Recording
                      ? 'Stop recording'
                      : 'Record voice message'
                  }
                  aria-pressed={voiceActive}
                  disabled={
                    voiceRecorder.status === VoiceRecordStatus.Starting ||
                    voiceRecorder.status === VoiceRecordStatus.Sending
                  }
                  onClick={handleVoiceRecordClick}
                >
                  <Icon
                    src={
                      voiceRecorder.status === VoiceRecordStatus.Recording
                        ? Icons.MicMute
                        : Icons.Mic
                    }
                  />
                </IconButton>
              )}
              <IconButton
                variant="SurfaceVariant"
                size="300"
                radii="300"
                onClick={() => setToolbar(!toolbar)}
              >
                <Icon src={toolbar ? Icons.AlphabetUnderline : Icons.Alphabet} />
              </IconButton>
              <UseStateProvider initial={undefined}>
                {(emojiBoardTab: EmojiBoardTab | undefined, setEmojiBoardTab) => (
                  <>
                    <EmojiPickerKeybind
                      onToggle={() =>
                        setEmojiBoardTab((t) =>
                          t === EmojiBoardTab.Emoji ? undefined : EmojiBoardTab.Emoji,
                        )
                      }
                    />
                    <PopOut
                      offset={16}
                      alignOffset={-44}
                      position="Top"
                      align="End"
                      anchor={
                        emojiBoardTab === undefined
                          ? undefined
                          : (emojiBtnRef.current?.getBoundingClientRect() ?? undefined)
                      }
                      content={
                        <EmojiBoard
                          tab={emojiBoardTab}
                          onTabChange={setEmojiBoardTab}
                          imagePackRooms={imagePackRooms}
                          returnFocusOnDeactivate={false}
                          allowMashup
                          onEmojiSelect={handleEmoticonSelect}
                          onCustomEmojiSelect={handleEmoticonSelect}
                          onStickerSelect={handleStickerSelect}
                          onGifSelect={handleGifSelect}
                          requestClose={() => {
                            setEmojiBoardTab((t) => {
                              if (t) {
                                if (!mobileOrTablet()) safeFocusEditor(editor);
                                return undefined;
                              }
                              return t;
                            });
                          }}
                        />
                      }
                    >
                      {/*
                        No GIF button here. GIFs are a tab on the board the
                        sticker and emoji buttons already open — one surface for
                        every kind of thing you can insert, rather than a third
                        button beside them that opens the same board on a
                        different tab. The `gifPicker` setting still decides
                        whether that tab exists at all; it is read where the tab
                        strip is built (emoji-board/components/Tabs.tsx).
                      */}
                      {!hideStickerBtn && (
                        <IconButton
                          aria-pressed={emojiBoardTab === EmojiBoardTab.Sticker}
                          onClick={() => setEmojiBoardTab(EmojiBoardTab.Sticker)}
                          variant="SurfaceVariant"
                          size="300"
                          radii="300"
                        >
                          <Icon
                            src={Icons.Sticker}
                            filled={emojiBoardTab === EmojiBoardTab.Sticker}
                          />
                        </IconButton>
                      )}
                      <IconButton
                        ref={emojiBtnRef}
                        aria-pressed={
                          hideStickerBtn ? !!emojiBoardTab : emojiBoardTab === EmojiBoardTab.Emoji
                        }
                        onClick={() => setEmojiBoardTab(EmojiBoardTab.Emoji)}
                        variant="SurfaceVariant"
                        size="300"
                        radii="300"
                      >
                        <Icon
                          src={Icons.Smile}
                          filled={
                            hideStickerBtn ? !!emojiBoardTab : emojiBoardTab === EmojiBoardTab.Emoji
                          }
                        />
                      </IconButton>
                    </PopOut>
                  </>
                )}
              </UseStateProvider>
              <Box
                style={{
                  width: '1px',
                  height: '24px',
                  backgroundColor: color.SurfaceVariant.ContainerLine,
                  marginLeft: '6px',
                  marginRight: '6px',
                }}
              />
              {/*
                Sending by touch is handled on touchend, not click. The default
                action of a touch on a button moves focus to it, which blurs the
                editor and dismisses the on-screen keyboard before `submit` can
                put the caret back — so the keyboard closed on every send.
                Preventing the default keeps focus where it is; the click that
                the browser synthesises afterwards is dropped by the timestamp
                guard so the message is not sent twice.
              */}
              <IconButton
                onTouchEnd={(evt) => {
                  evt.preventDefault();
                  lastSendTouchEndRef.current = evt.timeStamp;
                  submit();
                }}
                onClick={(evt) => {
                  if (evt.timeStamp - lastSendTouchEndRef.current < 1000) return;
                  submit();
                }}
                variant="Primary"
                size="300"
                radii="300"
              >
                <Icon src={Icons.Send} />
              </IconButton>
            </>
          }
          bottom={
            toolbar && (
              <div>
                <Line variant="SurfaceVariant" size="300" />
                <Toolbar />
              </div>
            )
          }
        />
      </div>
    );
  },
);

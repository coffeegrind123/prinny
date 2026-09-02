import { useCallback, useEffect, useState } from 'react';
import { FocusTrap } from 'focus-trap-react';
import {
  Box,
  Text,
  Button,
  Spinner,
  Dialog,
  Overlay,
  OverlayCenter,
  OverlayBackdrop,
  Header,
  config,
  color,
  IconButton,
  Icon,
  Icons,
} from 'folds';
import {
  IPushRules,
  MatrixClient,
  MatrixError,
  PushRuleAction,
  PushRuleKind,
  RuleId,
} from 'matrix-js-sdk';
import { SequenceCard } from '../../../components/sequence-card';
import { SequenceCardStyle } from '../styles.css';
import { SettingTile } from '../../../components/setting-tile';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { AsyncStatus, useAsyncCallback } from '../../../hooks/useAsyncCallback';
import { getNotificationModeActions, NotificationMode } from '../../../hooks/useNotificationMode';
import { stopPropagation } from '../../../utils/keyboard';

type DefaultRuleActions = {
  kind: PushRuleKind;
  ruleId: RuleId;
  actions: PushRuleAction[];
};

const DEFAULT_RULE_ACTIONS: DefaultRuleActions[] = [
  {
    kind: PushRuleKind.Override,
    ruleId: RuleId.IsUserMention,
    actions: getNotificationModeActions(NotificationMode.NotifyLoud, { highlight: true }),
  },
  {
    kind: PushRuleKind.Override,
    ruleId: RuleId.ContainsDisplayName,
    actions: getNotificationModeActions(NotificationMode.NotifyLoud, { highlight: true }),
  },
  {
    kind: PushRuleKind.ContentSpecific,
    ruleId: RuleId.ContainsUserName,
    actions: getNotificationModeActions(NotificationMode.NotifyLoud, { highlight: true }),
  },
  {
    kind: PushRuleKind.Override,
    ruleId: RuleId.IsRoomMention,
    actions: getNotificationModeActions(NotificationMode.Notify, { highlight: true }),
  },
  {
    kind: PushRuleKind.Override,
    ruleId: RuleId.AtRoomNotification,
    actions: getNotificationModeActions(NotificationMode.Notify, { highlight: true }),
  },
  {
    kind: PushRuleKind.Override,
    ruleId: RuleId.InviteToSelf,
    actions: getNotificationModeActions(NotificationMode.NotifyLoud),
  },
  {
    kind: PushRuleKind.Override,
    ruleId: RuleId.Tombstone,
    actions: getNotificationModeActions(NotificationMode.Notify, { highlight: true }),
  },
  {
    kind: PushRuleKind.Underride,
    ruleId: RuleId.DM,
    actions: getNotificationModeActions(NotificationMode.NotifyLoud),
  },
  {
    kind: PushRuleKind.Underride,
    ruleId: RuleId.EncryptedDM,
    actions: getNotificationModeActions(NotificationMode.NotifyLoud),
  },
  {
    kind: PushRuleKind.Underride,
    ruleId: RuleId.Message,
    actions: getNotificationModeActions(NotificationMode.Notify),
  },
  {
    kind: PushRuleKind.Underride,
    ruleId: RuleId.EncryptedMessage,
    actions: getNotificationModeActions(NotificationMode.Notify),
  },
];

const resetPushRules = async (mx: MatrixClient): Promise<void> => {
  const pushRules: IPushRules = await mx.getPushRules();
  const keywordRules = (pushRules.global[PushRuleKind.ContentSpecific] ?? []).filter(
    (rule) => !rule.rule_id.startsWith('.'),
  );
  await Promise.all(
    keywordRules.map((rule) =>
      mx.deletePushRule('global', PushRuleKind.ContentSpecific, rule.rule_id),
    ),
  );

  await Promise.all(
    DEFAULT_RULE_ACTIONS.map(async ({ kind, ruleId, actions }) => {
      const rule = pushRules.global[kind]?.find((r) => r.rule_id === ruleId);
      if (!rule) return;
      await mx.setPushRuleActions('global', kind, ruleId, actions);
      if (!rule.enabled) await mx.setPushRuleEnabled('global', kind, ruleId, true);
    }),
  );

  const master = pushRules.global[PushRuleKind.Override]?.find(
    (rule) => rule.rule_id === RuleId.Master,
  );
  if (master?.enabled) {
    await mx.setPushRuleEnabled('global', PushRuleKind.Override, RuleId.Master, false);
  }
};

type ResetPromptProps = {
  onDone: () => void;
  onCancel: () => void;
};
function ResetPrompt({ onDone, onCancel }: ResetPromptProps) {
  const mx = useMatrixClient();

  const [resetState, reset] = useAsyncCallback<void, MatrixError, []>(
    useCallback(() => resetPushRules(mx), [mx]),
  );

  useEffect(() => {
    if (resetState.status === AsyncStatus.Success) {
      onDone();
    }
  }, [resetState, onDone]);

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
          <Dialog variant="Surface" role="dialog" aria-label="Reset Notifications">
            <Header
              style={{
                padding: `0 ${config.space.S200} 0 ${config.space.S400}`,
                borderBottomWidth: config.borderWidth.B300,
              }}
              variant="Surface"
              size="500"
            >
              <Box grow="Yes">
                <Text size="H4">Reset Notifications</Text>
              </Box>
              <IconButton size="300" onClick={onCancel} radii="300">
                <Icon src={Icons.Cross} />
              </IconButton>
            </Header>
            <Box style={{ padding: config.space.S400 }} direction="Column" gap="400">
              <Box direction="Column" gap="200">
                <Text priority="400">
                  Restore default message notification rules? Any keyword notifications will be
                  removed. Room specific notification settings are not affected.
                </Text>
                {resetState.status === AsyncStatus.Error && (
                  <Text style={{ color: color.Critical.Main }} size="T300">
                    Failed to reset notifications! {resetState.error.message}
                  </Text>
                )}
              </Box>
              <Button
                type="submit"
                variant="Critical"
                onClick={reset}
                before={
                  resetState.status === AsyncStatus.Loading ? (
                    <Spinner fill="Solid" variant="Critical" size="200" />
                  ) : undefined
                }
                aria-disabled={
                  resetState.status === AsyncStatus.Loading ||
                  resetState.status === AsyncStatus.Success
                }
              >
                <Text size="B400">
                  {resetState.status === AsyncStatus.Loading ? 'Resetting...' : 'Reset'}
                </Text>
              </Button>
            </Box>
          </Dialog>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}

export function ResetNotification() {
  const [prompt, setPrompt] = useState(false);

  return (
    <Box direction="Column" gap="100">
      <Text size="L400">Reset</Text>
      <SequenceCard
        className={SequenceCardStyle}
        variant="SurfaceVariant"
        direction="Column"
        gap="400"
      >
        <SettingTile
          title="Reset Notifications"
          description="Restore default message notification rules and remove keyword notifications."
          after={
            <Button
              size="300"
              radii="300"
              variant="Critical"
              fill="Soft"
              outlined
              onClick={() => setPrompt(true)}
            >
              <Text size="B300">Reset</Text>
            </Button>
          }
        />
      </SequenceCard>
      {prompt && <ResetPrompt onDone={() => setPrompt(false)} onCancel={() => setPrompt(false)} />}
    </Box>
  );
}

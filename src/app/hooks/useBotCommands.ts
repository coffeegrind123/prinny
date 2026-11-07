import { Room } from 'matrix-js-sdk';
import { useMemo } from 'react';
import { useJoinedBotDescriptions, useJoinedRoomBots } from './useBotInfo';
import { getMemberDisplayName } from '../utils/room';
import { getMxIdLocalPart } from '../utils/matrix';
import type { BotInfo, Msc4391CommandDescription } from '../../types/matrix/bot';
import {
  addressCommand,
  argsHintOf,
  descriptionText,
  type BotDescriptions,
  type InvocableCommand,
} from '../utils/botInvocation';

export type BotCommandEntry = InvocableCommand & {
  /** Command name without the leading slash; may contain spaces (MSC4391 subcommands). */
  name: string;
  description: string;
  /** Usage hint, e.g. `<path>`. */
  args?: string;
  botName: string;
};

type Source = { command: string; description: string; args?: string };

/**
 * One bot's commands, in the order its `app.prinny.bot.info` lists them, then
 * any it only describes through MSC4391 (in name order). The MSC4391
 * description, where there is one, supplies the schema for the invocation;
 * the info supplies the order and the wording Prinny shows.
 */
const commandsOf = (
  info: BotInfo | undefined,
  descriptions: Msc4391CommandDescription[] | undefined,
): (Source & { msc4391?: Msc4391CommandDescription })[] => {
  const byName = new Map((descriptions ?? []).map((d) => [d.command, d]));
  const out: (Source & { msc4391?: Msc4391CommandDescription })[] = [];
  info?.commands?.forEach((command) => {
    const msc4391 = byName.get(command.command);
    byName.delete(command.command);
    out.push(msc4391 ? { ...command, msc4391 } : { ...command });
  });
  byName.forEach((msc4391) => {
    const source: Source & { msc4391?: Msc4391CommandDescription } = {
      command: msc4391.command,
      description: descriptionText(msc4391),
      msc4391,
    };
    const args = argsHintOf(msc4391);
    if (args) source.args = args;
    out.push(source);
  });
  return out;
};

/**
 * Commands offered by bots in this room.
 *
 * The bot half of the client's slash-command menu. Built-in commands come from
 * `useCommands`; these come off the wire: `app.prinny.bot.info` and MSC4391
 * command descriptions, from bots still joined. A bot can change them at any
 * time by republishing either.
 */
export const useBotCommands = (room: Room, builtInNames: string[]): BotCommandEntry[] => {
  const bots = useJoinedRoomBots(room);
  const descriptions: BotDescriptions = useJoinedBotDescriptions(room);

  return useMemo(() => {
    const builtIn = new Set(builtInNames);
    const botIds = [...new Set([...bots.keys(), ...descriptions.keys()])];
    const perBot = botIds.map(
      (botUserId) =>
        [botUserId, commandsOf(bots.get(botUserId), descriptions.get(botUserId))] as const,
    );

    // Count first, so the decision to address a command is made with the whole
    // room in view rather than in bot-registration order.
    const providers = new Map<string, number>();
    perBot.forEach(([, commands]) => {
      commands.forEach((command) => {
        providers.set(command.command, (providers.get(command.command) ?? 0) + 1);
      });
    });

    const entries: BotCommandEntry[] = [];
    perBot.forEach(([botUserId, commands]) => {
      const botName =
        bots.get(botUserId)?.name ??
        getMemberDisplayName(room, botUserId) ??
        getMxIdLocalPart(botUserId) ??
        botUserId;
      const localpart = getMxIdLocalPart(botUserId) ?? botUserId;

      commands.forEach((command) => {
        // A built-in clashes on the first word: `/me x` is ours whatever follows.
        const firstWord = command.command.split(' ')[0];
        const ambiguous = builtIn.has(firstWord) || (providers.get(command.command) ?? 0) > 1;
        const addressedName = addressCommand(command.command, localpart);
        const entry: BotCommandEntry = {
          name: command.command,
          description: command.description,
          botUserId,
          botName,
          insertName: ambiguous ? addressedName : command.command,
          addressedName,
        };
        if (command.args) entry.args = command.args;
        if (command.msc4391) entry.msc4391 = command.msc4391;
        entries.push(entry);
      });
    });

    return entries;
  }, [bots, descriptions, room, builtInNames]);
};

import { Room } from 'matrix-js-sdk';
import { useMemo } from 'react';
import { useJoinedRoomBots } from './useBotInfo';
import { getMemberDisplayName } from '../utils/room';
import { getMxIdLocalPart } from '../utils/matrix';

export type BotCommandEntry = {
  /** Command name without the leading slash. */
  name: string;
  description: string;
  /** Usage hint, e.g. `<path>`. */
  args?: string;
  botUserId: string;
  botName: string;
  /**
   * What to actually insert.
   *
   * Usually just `name`, but `name@localpart` when the same command is offered
   * by more than one bot, or shadows one of this client's own commands.
   * Telegram's convention, and it exists for the same reason: without it, two
   * bots offering `/status` both answer, and neither knows it was ambiguous.
   */
  insertName: string;
};

/**
 * Commands advertised by bots in this room.
 *
 * The bot half of the client's slash-command menu. Built-in commands come from
 * `useCommands`; these come off the wire, and a bot can change them at any
 * time by republishing its `app.prinny.bot.info`.
 */
export const useBotCommands = (room: Room, builtInNames: string[]): BotCommandEntry[] => {
  const bots = useJoinedRoomBots(room);

  return useMemo(() => {
    const builtIn = new Set(builtInNames);

    // Count first, so the decision to address a command is made with the whole
    // room in view rather than in bot-registration order.
    const providers = new Map<string, number>();
    bots.forEach((info) => {
      info.commands?.forEach((command) => {
        providers.set(command.command, (providers.get(command.command) ?? 0) + 1);
      });
    });

    const entries: BotCommandEntry[] = [];
    bots.forEach((info, botUserId) => {
      const botName =
        info.name ??
        getMemberDisplayName(room, botUserId) ??
        getMxIdLocalPart(botUserId) ??
        botUserId;
      const localpart = getMxIdLocalPart(botUserId) ?? botUserId;

      info.commands?.forEach((command) => {
        const ambiguous = builtIn.has(command.command) || (providers.get(command.command) ?? 0) > 1;
        const entry: BotCommandEntry = {
          name: command.command,
          description: command.description,
          botUserId,
          botName,
          insertName: ambiguous ? `${command.command}@${localpart}` : command.command,
        };
        if (command.args) entry.args = command.args;
        entries.push(entry);
      });
    });

    return entries;
  }, [bots, room, builtInNames]);
};

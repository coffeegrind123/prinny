import { useEffect, useMemo, useState } from 'react';
import { MatrixEvent, Poll, PollEvent, Room } from 'matrix-js-sdk';
import { Relations } from 'matrix-js-sdk/lib/models/relations';
import { M_POLL_KIND_DISCLOSED } from 'matrix-js-sdk/lib/@types/polls';
import { useMatrixClient } from './useMatrixClient';
import { tallyBallots } from '../utils/pollTally';

export type PollAnswerTally = {
  id: string;
  text: string;
  count: number;
  /** True when the viewer picked this answer. */
  mine: boolean;
  /** True when this answer won, once the poll has ended. */
  winner: boolean;
};

export type PollState = {
  question: string;
  answers: PollAnswerTally[];
  totalVotes: number;
  maxSelections: number;
  /** Undisclosed polls hide their tallies until they end. */
  disclosed: boolean;
  ended: boolean;
  /** How many related events could not be decrypted; tallies are short by this. */
  undecryptableCount: number;
  loading: boolean;
};

const readAnswers = (event: MatrixEvent): string[] => {
  const content = event.getContent();
  const block =
    content['org.matrix.msc3381.poll.response'] ?? content['m.poll.response'] ?? undefined;
  const answers = block?.answers;
  if (!Array.isArray(answers)) return [];
  return answers.filter((a: unknown): a is string => typeof a === 'string');
};

/**
 * Live tallies for a poll, from the js-sdk's own `Poll` model.
 *
 * The model does the hard parts — paginating responses, discarding votes cast
 * after the poll ended, tracking relations it could not decrypt — so this hook
 * subscribes rather than reimplementing the counting rules. What it does own is
 * the per-voter reduction: one voter, one (latest) ballot.
 */
export const usePoll = (room: Room, pollStartEvent: MatrixEvent): PollState | undefined => {
  const mx = useMatrixClient();
  const pollId = pollStartEvent.getId();

  const [relations, setRelations] = useState<Relations>();
  const [loaded, setLoaded] = useState(false);
  const [revision, setRevision] = useState(0);

  // `room.polls` is filled by the sdk as it processes timeline events, which
  // can happen after this component first renders — a poll scrolled into view
  // from backfill is routinely absent for a tick. Without this subscription it
  // would stay absent forever and render as a broken poll.
  useEffect(() => {
    const onNewPoll = () => setRevision((n) => n + 1);
    room.on(PollEvent.New, onNewPoll);
    return () => {
      room.off(PollEvent.New, onNewPoll);
    };
  }, [room]);

  const poll: Poll | undefined = pollId ? room.polls.get(pollId) : undefined;

  useEffect(() => {
    if (!poll) return undefined;
    let alive = true;

    // Kicks off the paginated fetch. Without it, a poll scrolled into view from
    // backfill shows every answer at zero — which reads as "nobody voted"
    // rather than "not loaded yet".
    poll.getResponses().then(
      (result) => {
        if (!alive) return;
        setRelations(result);
        setLoaded(true);
      },
      () => {
        if (alive) setLoaded(true);
      },
    );

    const onResponses = (result: Relations) => {
      if (!alive) return;
      setRelations(result);
      // Relations is mutated in place, so a new object identity is not
      // guaranteed — bump a counter to force the tallies to re-derive.
      setRevision((n) => n + 1);
    };
    const onChange = () => {
      if (alive) setRevision((n) => n + 1);
    };

    poll.on(PollEvent.Responses, onResponses);
    poll.on(PollEvent.End, onChange);
    poll.on(PollEvent.UndecryptableRelations, onChange);
    return () => {
      alive = false;
      poll.off(PollEvent.Responses, onResponses);
      poll.off(PollEvent.End, onChange);
      poll.off(PollEvent.UndecryptableRelations, onChange);
    };
  }, [poll]);

  return useMemo(() => {
    if (!poll) return undefined;

    const { pollEvent } = poll;
    const userId = mx.getSafeUserId();
    const responseEvents = relations?.getRelations() ?? [];

    const latestByUser = new Map<string, string[]>();
    responseEvents.forEach((event) => {
      const sender = event.getSender();
      if (!sender) return;
      // Relations come back oldest-first, so the last write wins and each voter
      // ends up with their most recent ballot.
      latestByUser.set(sender, readAnswers(event));
    });

    const { counts, ballots } = tallyBallots(latestByUser, {
      answerIds: pollEvent.answers.map((answer) => answer.id),
      maxSelections: pollEvent.maxSelections,
    });

    const myAnswers = new Set(latestByUser.get(userId) ?? []);
    const highest = Math.max(0, ...Array.from(counts.values()));

    const answers: PollAnswerTally[] = pollEvent.answers.map((answer) => ({
      id: answer.id,
      text: answer.text,
      count: counts.get(answer.id) ?? 0,
      mine: myAnswers.has(answer.id),
      winner: poll.isEnded && highest > 0 && (counts.get(answer.id) ?? 0) === highest,
    }));

    return {
      question: pollEvent.question.text,
      answers,
      totalVotes: ballots,
      maxSelections: pollEvent.maxSelections,
      disclosed: pollEvent.kind.matches(M_POLL_KIND_DISCLOSED.name),
      ended: poll.isEnded,
      undecryptableCount: poll.undecryptableRelationsCount,
      loading: !loaded,
    };
    // `revision` is the signal that the mutable model changed underneath us.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poll, mx, relations, revision, loaded]);
};

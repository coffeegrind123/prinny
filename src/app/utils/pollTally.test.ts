import { describe, expect, it } from 'vitest';
import { tallyBallots } from './pollTally';

const POLL = { answerIds: ['a', 'b', 'c'], maxSelections: 2 };

describe('tallyBallots (MSC3381 m.poll.response rules)', () => {
  it('counts a repeated answer once: each sender gets one vote per option', () => {
    // A ballot of ["a","a","a"] used to add three votes to "a".
    const { counts, ballots } = tallyBallots(new Map([['@x:hs', ['a', 'a', 'a']]]), POLL);
    expect(counts.get('a')).toBe(1);
    expect(ballots).toBe(1);
  });

  it('spoils the whole ballot when any answer is unknown, rather than dropping that answer', () => {
    const { counts, ballots } = tallyBallots(new Map([['@x:hs', ['a', 'zzz']]]), POLL);
    expect(counts.get('a')).toBeUndefined();
    expect(ballots).toBe(0);
  });

  it('truncates to max_selections before checking, so a junk entry past the limit is ignored', () => {
    const { counts, ballots } = tallyBallots(new Map([['@x:hs', ['a', 'b', 'zzz']]]), POLL);
    expect(counts.get('a')).toBe(1);
    expect(counts.get('b')).toBe(1);
    expect(ballots).toBe(1);
  });

  it('treats an empty selection as no vote, and counts ordinary ballots', () => {
    const { counts, ballots } = tallyBallots(
      new Map([
        ['@x:hs', []],
        ['@y:hs', ['b']],
        ['@z:hs', ['b', 'c']],
      ]),
      POLL,
    );
    expect(counts.get('b')).toBe(2);
    expect(counts.get('c')).toBe(1);
    expect(ballots).toBe(2);
  });
});

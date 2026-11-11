import type { Session } from '@slop-control/shared';
import { describe, expect, it } from 'vitest';
import {
  commandInMessage,
  continueMessage,
  followUpAction,
  formatDuration,
  isOlderSession,
  phaseState,
  resultWording,
  roundLabel,
  scopeFlagLabel,
  sessionArtifactPath,
  sessionOutcome,
  sessionTimeline,
} from '../src/lib/session-view';

const session = (overrides: Partial<Session>): Session =>
  ({
    id: 'abcdef1234',
    phase: 'investigation',
    round: 1,
    status: 'ended',
    statusReason: null,
    scopeFlags: [],
    setup: {
      instruction: 'Investigate this ticket.',
      scope: { mayChangeCode: false },
      stopCondition: { requiredArtifactPath: '.slop/investigation.md' },
      userLevelSource: false,
    },
    artifactStatus: 'complete',
    runtimeSessionId: 'runtime-1',
    worktreePath: '/data/worktrees/w1/owner-repo-1-abcdef12',
    startedAt: '2026-11-02T10:00:00Z',
    endedAt: '2026-11-02T10:30:00Z',
    ...overrides,
  }) as Session;

describe('phaseState', () => {
  it('is idle with no session in the phase', () => {
    expect(phaseState([session({ phase: 'planning' })], 'investigation')).toBe('idle');
  });

  it('is running while any session in the phase is active', () => {
    const list = [session({ status: 'running', artifactStatus: null }), session({})];
    expect(phaseState(list, 'investigation')).toBe('running');
  });

  it('stays done when a later session missed its artifact', () => {
    const list = [session({ artifactStatus: 'incomplete' }), session({})];
    expect(phaseState(list, 'investigation')).toBe('done');
  });

  it('is incomplete when no session produced the artifact', () => {
    const list = [session({ status: 'failed', artifactStatus: 'incomplete' })];
    expect(phaseState(list, 'investigation')).toBe('incomplete');
  });
});

describe('sessionOutcome', () => {
  it('keeps a normal end without its artifact apart from a complete one', () => {
    expect(sessionOutcome(session({}))).toEqual({
      label: 'Complete · investigation.md',
      tone: 'ok',
    });
    expect(sessionOutcome(session({ artifactStatus: 'incomplete' }))).toEqual({
      label: 'Incomplete · no investigation.md',
      tone: 'warn',
    });
  });

  it('reports a failure as failed even with no artifact check to mention', () => {
    expect(sessionOutcome(session({ status: 'failed' })).tone).toBe('danger');
  });
});

describe('a session round', () => {
  it('is not labelled for round 1, and is for later rounds', () => {
    expect(roundLabel(session({ round: 1 }))).toBeNull();
    expect(roundLabel(session({ round: 2 }))).toBe('Round 2');
    expect(roundLabel(session({ round: 3 }))).toBe('Round 3');
  });

  it('reads as incomplete when a later round produced nothing new, with the earlier result offered', () => {
    const wording = resultWording(session({ round: 2, artifactStatus: 'incomplete' }), 1);
    expect(wording).toMatchObject({ tone: 'warn', earlierResult: true });
    expect(wording?.label).toContain('incomplete');
    expect(wording?.detail).toContain('round 1');
    expect(sessionOutcome(session({ round: 2, artifactStatus: 'incomplete' })).label).toBe(
      'Incomplete · round 2 wrote nothing new',
    );
  });

  it('offers no earlier result when no round ever stored one', () => {
    expect(resultWording(session({ round: 2, artifactStatus: 'incomplete' }), null)).toMatchObject({
      label: 'Result incomplete',
      earlierResult: false,
    });
    expect(resultWording(session({ artifactStatus: 'incomplete' }), null)).toMatchObject({
      earlierResult: false,
    });
  });

  it('names the round of a complete later result, and says nothing while a round runs', () => {
    expect(resultWording(session({ round: 2 }), 2)?.label).toBe('Result complete · round 2');
    expect(resultWording(session({}), 1)?.label).toBe('Result complete');
    expect(resultWording(session({ status: 'running', artifactStatus: null }), 1)).toBeNull();
  });
});

describe('scopeFlagLabel', () => {
  it('describes a code change in a read-only phase', () => {
    expect(scopeFlagLabel(['code_changed'])).toBe('Changed code in a read-only phase');
  });

  it('is absent for a session with no flags', () => {
    expect(scopeFlagLabel([])).toBeNull();
  });
});

describe('followUpAction', () => {
  it('offers a follow-up for an ended session Claude Code started', () => {
    expect(followUpAction(session({}))).toBe('follow_up');
    expect(followUpAction(session({ status: 'stopped' }))).toBe('follow_up');
  });

  it('offers Continue when the session also missed its artifact', () => {
    expect(followUpAction(session({ artifactStatus: 'incomplete' }))).toBe('continue');
    expect(followUpAction(session({ status: 'failed', artifactStatus: 'incomplete' }))).toBe(
      'continue',
    );
  });

  it('offers neither while the session is active', () => {
    expect(followUpAction(session({ status: 'starting', artifactStatus: null }))).toBe('none');
    expect(followUpAction(session({ status: 'running', artifactStatus: null }))).toBe('none');
    expect(
      followUpAction(session({ status: 'starting', artifactStatus: null, runtimeSessionId: null })),
    ).toBe('none');
  });

  it("says a session can't be resumed when Claude Code never started it", () => {
    expect(
      followUpAction(
        session({ status: 'failed', artifactStatus: 'incomplete', runtimeSessionId: null }),
      ),
    ).toBe('not_resumable');
  });

  it('prefills Continue with a request for the artifact at the path the session was given', () => {
    const custom = session({
      setup: {
        instruction: 'Plan it.',
        scope: { mayChangeCode: false },
        stopCondition: { requiredArtifactPath: '.slop/custom-plan.md' },
        userLevelSource: false,
      },
    });
    expect(sessionArtifactPath(custom)).toBe('.slop/custom-plan.md');
    expect(continueMessage(custom)).toContain('`.slop/custom-plan.md`');
  });
});

describe('sessionTimeline', () => {
  const titles = (value: Session) => sessionTimeline(value, Date.parse('2026-11-02T10:14:00Z'));

  it('shows a running session as still running, with its end still to come', () => {
    const steps = titles(session({ status: 'running', artifactStatus: null, endedAt: null }));
    expect(steps.map((step) => step.title)).toEqual([
      'Starting',
      'Running',
      'Still running · 14 min',
      'Ended · Failed · Stopped',
    ]);
  });

  it('skips the running step for a session the runtime never reported', () => {
    const steps = titles(
      session({
        status: 'failed',
        statusReason: 'server_restarted',
        runtimeSessionId: null,
        artifactStatus: 'incomplete',
      }),
    );
    expect(steps.map((step) => step.title)).toEqual(['Starting', 'Failed', 'Result incomplete']);
    expect(steps[1]?.detail).toBe('server_restarted');
  });
});

describe('formatDuration', () => {
  const start = '2026-11-02T10:00:00Z';

  it.each([
    ['2026-11-02T10:00:30Z', 'under 1 min'],
    ['2026-11-02T10:14:00Z', '14 min'],
    ['2026-11-02T11:00:00Z', '1 h'],
    ['2026-11-02T11:12:00Z', '1 h 12 m'],
  ])('formats a session ending at %s as %s', (end, expected) => {
    expect(formatDuration(start, end)).toBe(expected);
  });
});

describe('commandInMessage', () => {
  it('finds the command in a message that names one', () => {
    expect(
      commandInMessage("Claude Code isn't signed in. Run `claude auth login` on the host."),
    ).toBe('claude auth login');
  });

  it('finds nothing in a message that names none', () => {
    expect(commandInMessage("Claude Code isn't installed on the host.")).toBeNull();
  });
});

describe('isOlderSession', () => {
  const at = (round: number, status: Session['status']) => ({ round, status });

  it.each([
    ['a lower round', at(1, 'stopped'), at(2, 'starting'), true],
    ['the same round at an earlier status', at(2, 'running'), at(2, 'stopped'), true],
    ['starting against running', at(1, 'starting'), at(1, 'running'), true],
    ['the same position', at(2, 'running'), at(2, 'running'), false],
    ['failed against stopped', at(1, 'failed'), at(1, 'stopped'), false],
    ['stopped against ended', at(1, 'stopped'), at(1, 'ended'), false],
    ['ended against failed', at(1, 'ended'), at(1, 'failed'), false],
    ['a later status in the same round', at(1, 'ended'), at(1, 'running'), false],
    ['a higher round at starting, after ended', at(3, 'starting'), at(2, 'ended'), false],
    ['a higher round at starting, after failed', at(3, 'starting'), at(2, 'failed'), false],
    ['a higher round at starting, after stopped', at(3, 'starting'), at(2, 'stopped'), false],
  ])('%s', (_name, incoming, cached, older) => {
    expect(isOlderSession(incoming, cached)).toBe(older);
  });
});

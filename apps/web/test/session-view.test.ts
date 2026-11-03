import type { Session } from '@slop-control/shared';
import { describe, expect, it } from 'vitest';
import {
  commandInMessage,
  formatDuration,
  phaseState,
  sessionOutcome,
  sessionTimeline,
} from '../src/lib/session-view';

const session = (overrides: Partial<Session>): Session =>
  ({
    id: 'abcdef1234',
    phase: 'investigation',
    status: 'ended',
    statusReason: null,
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

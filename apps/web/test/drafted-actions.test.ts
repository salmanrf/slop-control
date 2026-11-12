import type { DraftedAction, Session } from '@slop-control/shared';
import { describe, expect, it } from 'vitest';
import {
  actionAnchor,
  actionResult,
  actionStatus,
  actionSummary,
  actionTypeLabel,
  inboxActions,
  isOlderAction,
  isWaiting,
  nothingToPush,
  withInboxAction,
  withSessionAction,
} from '../src/lib/drafted-actions';

const action = (overrides: Partial<DraftedAction>): DraftedAction =>
  ({
    id: 'act-1',
    type: 'open_pr',
    status: 'pending',
    ticketKey: 'T-1',
    payload: { title: 'Fix it', body: 'Report', baseBranch: 'main', headBranch: 'slop/t-1' },
    result: null,
    error: null,
    createdAt: '2026-11-12T09:00:00Z',
    updatedAt: '2026-11-12T09:00:00Z',
    ...overrides,
  }) as DraftedAction;

describe('how an action is described', () => {
  it('names each type', () => {
    expect(actionTypeLabel({ type: 'open_pr' })).toBe('Open PR');
    expect(actionTypeLabel({ type: 'ticket_comment' })).toBe('Ticket comment');
    expect(actionTypeLabel({ type: 'ticket_transition' })).toBe('Status change');
  });

  it.each([
    ['pending', 'Waiting for approval', 'warn'],
    ['dispatching', 'Sending', 'ok'],
    ['succeeded', 'Sent', 'ok'],
    ['failed', 'Failed', 'danger'],
    ['rejected', 'Rejected', 'neutral'],
  ] as const)('describes %s', (status, label, tone) => {
    expect(actionStatus({ status })).toEqual({ label, tone });
  });

  it('says what approving would send', () => {
    expect(actionSummary(action({}))).toBe('slop/t-1 into main');
    expect(actionSummary(action({ type: 'ticket_comment', payload: { body: 'Review' } }))).toBe(
      'Comment on T-1',
    );
    expect(
      actionSummary(action({ type: 'ticket_transition', payload: { toStatus: 'In review' } })),
    ).toBe('Move T-1 to In review');
  });

  it('has no result until it has succeeded', () => {
    expect(actionResult(action({}))).toBeNull();
    expect(actionResult(action({ status: 'failed', error: 'GitHub said no' }))).toBeNull();
  });

  it('links an opened pull request', () => {
    const result = { number: 12, url: 'https://github.com/acme/widgets/pull/12', commit: 'abc' };
    expect(actionResult(action({ status: 'succeeded', result }))).toEqual({
      text: 'Pull request #12',
      url: 'https://github.com/acme/widgets/pull/12',
    });
  });

  it('links a posted comment, and has no link for one on a built-in ticket', () => {
    const comment = { type: 'ticket_comment', status: 'succeeded', payload: { body: 'Review' } };
    expect(
      actionResult(action({ ...comment, result: { url: 'https://github.com/c/1' } } as never)),
    ).toEqual({ text: 'Comment posted', url: 'https://github.com/c/1' });
    expect(actionResult(action({ ...comment, result: { url: null } } as never))).toEqual({
      text: 'Comment added to the ticket',
      url: null,
    });
  });

  it("names the ticket's new status after a move", () => {
    expect(
      actionResult(
        action({
          type: 'ticket_transition',
          status: 'succeeded',
          payload: { toStatus: 'In review' },
          result: { status: 'In review' },
        }),
      ),
    ).toEqual({ text: 'Ticket moved to In review', url: null });
  });

  it('gives each action an anchor on its session page', () => {
    expect(actionAnchor('act-1')).toBe('action-act-1');
  });
});

describe('the approvals inbox', () => {
  it('counts pending and failed actions, and no others', () => {
    const waiting = (['pending', 'rejected', 'dispatching', 'succeeded', 'failed'] as const).filter(
      (status) => isWaiting({ status }),
    );
    expect(waiting).toEqual(['pending', 'failed']);
  });

  it('lists what is waiting newest first', () => {
    const list = [
      action({ id: 'old', createdAt: '2026-11-10T09:00:00Z' }),
      action({ id: 'sent', status: 'succeeded', createdAt: '2026-11-12T09:00:00Z' }),
      action({ id: 'new', status: 'failed', createdAt: '2026-11-11T09:00:00Z' }),
    ];
    expect(inboxActions(list).map((item) => item.id)).toEqual(['new', 'old']);
  });

  it('takes in a new draft, updates one in place, and lets a decided one leave', () => {
    const first = action({ id: 'a', createdAt: '2026-11-10T09:00:00Z' });
    const second = action({ id: 'b', createdAt: '2026-11-11T09:00:00Z' });
    expect(withInboxAction([first], second).map((item) => item.id)).toEqual(['b', 'a']);
    expect(
      withInboxAction([second, first], { ...first, status: 'failed' }).map((item) => item.status),
    ).toEqual(['pending', 'failed']);
    expect(withInboxAction([second, first], { ...second, status: 'rejected' })).toEqual([first]);
  });
});

describe("a session's list of actions", () => {
  it('replaces an action in place and adds a new one at the end', () => {
    const first = action({ id: 'a' });
    const second = action({ id: 'b' });
    expect(withSessionAction([first], second).map((item) => item.id)).toEqual(['a', 'b']);
    expect(
      withSessionAction([first, second], { ...first, status: 'succeeded' }).map((i) => i.status),
    ).toEqual(['succeeded', 'pending']);
  });
});

describe('isOlderAction', () => {
  const at = (status: DraftedAction['status'], second: number) => ({
    status,
    updatedAt: `2026-11-12T10:00:0${second}Z`,
  });

  it('goes by when each state was saved', () => {
    expect(isOlderAction(at('pending', 1), at('dispatching', 2))).toBe(true);
    expect(isOlderAction(at('dispatching', 2), at('pending', 1))).toBe(false);
  });

  it('lets failed return to dispatching, since the later save wins', () => {
    expect(isOlderAction(at('dispatching', 5), at('failed', 3))).toBe(false);
    expect(isOlderAction(at('failed', 3), at('dispatching', 5))).toBe(true);
  });

  it('lets nothing follow a final status', () => {
    expect(isOlderAction(at('dispatching', 9), at('succeeded', 3))).toBe(true);
    expect(isOlderAction(at('pending', 9), at('rejected', 3))).toBe(true);
  });

  it('falls back to the order of statuses when two states share a time', () => {
    expect(isOlderAction(at('pending', 1), at('dispatching', 1))).toBe(true);
    expect(isOlderAction(at('succeeded', 1), at('dispatching', 1))).toBe(false);
    expect(isOlderAction(at('pending', 1), at('pending', 1))).toBe(false);
  });
});

describe('nothingToPush', () => {
  const done = { phase: 'implementation', status: 'ended', artifactStatus: 'complete' } as Session;
  const empty = { commitCount: 0, uncommitted: null };

  it('holds for a finished implementation session with no commits and no open PR action', () => {
    expect(nothingToPush(done, [], empty)).toEqual({ uncommitted: [] });
  });

  it('lists the files the session left uncommitted', () => {
    const uncommitted = [{ path: 'src/a.ts', state: 'modified' as const }];
    expect(nothingToPush(done, [], { commitCount: 0, uncommitted })).toEqual({ uncommitted });
  });

  it('does not hold once there are commits or an open PR action', () => {
    expect(nothingToPush(done, [], { commitCount: 2, uncommitted: null })).toBeNull();
    expect(nothingToPush(done, [action({ status: 'rejected' })], empty)).toBeNull();
  });

  it('does not hold for another phase, an unfinished round, or a missing report', () => {
    expect(nothingToPush({ ...done, phase: 'code_review' }, [], empty)).toBeNull();
    expect(nothingToPush({ ...done, status: 'running' }, [], empty)).toBeNull();
    expect(nothingToPush({ ...done, artifactStatus: 'incomplete' }, [], empty)).toBeNull();
  });

  it('says nothing until the actions and the diff are both known', () => {
    expect(nothingToPush(done, undefined, empty)).toBeNull();
    expect(nothingToPush(done, [], undefined)).toBeNull();
  });
});

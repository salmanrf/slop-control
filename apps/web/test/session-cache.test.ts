import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DraftedAction, DraftedActionDetail, Session } from '@slop-control/shared';
import {
  applyActionUpdate,
  applySessionUpdate,
  keys,
  refetchActionQueries,
  refetchSessionQueries,
} from '../src/lib/session-cache';

const session = (
  id: string,
  status: Session['status'],
  ticketKey = 'acme/widgets#1',
  ticketSourceId = 's1',
) => ({ id, status, ticketKey, ticketSourceId, workspaceId: 'w1' }) as Session;

describe('session cache', () => {
  let client: QueryClient;

  beforeEach(() => {
    client = new QueryClient();
  });

  it('writes the session into its own query', () => {
    applySessionUpdate(client, session('a', 'running'));
    expect(client.getQueryData(keys.session('w1', 'a'))).toMatchObject({ status: 'running' });
  });

  it("replaces the session in place in its ticket's list", () => {
    const key = keys.ticketSessions('w1', 's1', 'acme/widgets#1');
    client.setQueryData(key, [session('b', 'running'), session('a', 'running')]);
    applySessionUpdate(client, session('a', 'ended'));
    expect(client.getQueryData<Session[]>(key)!.map((s) => [s.id, s.status])).toEqual([
      ['b', 'running'],
      ['a', 'ended'],
    ]);
  });

  it("adds a new session to the top of its ticket's list", () => {
    const key = keys.ticketSessions('w1', 's1', 'acme/widgets#1');
    client.setQueryData(key, [session('a', 'ended')]);
    applySessionUpdate(client, session('b', 'starting'));
    expect(client.getQueryData<Session[]>(key)!.map((s) => s.id)).toEqual(['b', 'a']);
  });

  it("leaves another ticket's list alone", () => {
    const other = keys.ticketSessions('w1', 's1', 'acme/widgets#2');
    client.setQueryData(other, []);
    applySessionUpdate(client, session('a', 'running'));
    expect(client.getQueryData(other)).toEqual([]);
  });

  it('keeps the same key in two sources apart', () => {
    const builtIn = keys.ticketSessions('w1', 's1', 'T-1');
    const other = keys.ticketSessions('w1', 's2', 'T-1');
    client.setQueryData(builtIn, []);
    client.setQueryData(other, []);
    applySessionUpdate(client, session('a', 'running', 'T-1', 's2'));
    expect(client.getQueryData(builtIn)).toEqual([]);
    expect(client.getQueryData<Session[]>(other)!.map((s) => s.id)).toEqual(['a']);
  });

  it("refetches the launch preview of the session's ticket, and no other ticket's", () => {
    const mine = keys.launchPreview('w1', 's1', 'acme/widgets#1', '', '');
    const minePlanning = keys.launchPreview('w1', 's1', 'acme/widgets#1', 'planning', 'r1');
    const otherTicket = keys.launchPreview('w1', 's1', 'acme/widgets#2', '', '');
    const otherSource = keys.launchPreview('w1', 's2', 'acme/widgets#1', '', '');
    for (const key of [mine, minePlanning, otherTicket, otherSource]) {
      client.setQueryData(key, { phase: 'investigation' });
    }

    applySessionUpdate(client, { ...session('a', 'ended'), artifactStatus: 'complete' });

    const stale = (key: readonly unknown[]) => client.getQueryState(key)?.isInvalidated;
    expect(stale(mine)).toBe(true);
    expect(stale(minePlanning)).toBe(true);
    expect(stale(otherTicket)).toBe(false);
    expect(stale(otherSource)).toBe(false);
  });

  it('does not create a list nobody has loaded', () => {
    applySessionUpdate(client, session('a', 'running'));
    expect(client.getQueryData(keys.ticketSessions('w1', 's1', 'acme/widgets#1'))).toBeUndefined();
  });

  it('refreshes an artifact query once the session has an artifact status', () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    applySessionUpdate(client, { ...session('a', 'ended'), artifactStatus: 'complete' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: keys.artifact('w1', 'a') });
  });

  describe('an update that is older than the cached session', () => {
    const inRound = (round: number, status: Session['status']) => ({
      ...session('a', status),
      round,
    });
    const sessionKey = keys.session('w1', 'a');
    const listKey = keys.ticketSessions('w1', 's1', 'acme/widgets#1');

    it('is dropped, as when a stop answer arrives after the stopped frame', () => {
      client.setQueryData(listKey, [inRound(3, 'running')]);
      applySessionUpdate(client, inRound(3, 'stopped'));
      const preview = keys.launchPreview('w1', 's1', 'acme/widgets#1', '', '');
      client.setQueryData(preview, { phase: 'investigation' });

      applySessionUpdate(client, inRound(3, 'running'));

      expect(client.getQueryData(sessionKey)).toMatchObject({ status: 'stopped' });
      expect(client.getQueryData<Session[]>(listKey)!.map((s) => s.status)).toEqual(['stopped']);
      expect(client.getQueryState(preview)?.isInvalidated).toBe(false);
    });

    it('is dropped when only the ticket list holds the newer state', () => {
      client.setQueryData(listKey, [inRound(1, 'stopped')]);
      applySessionUpdate(client, inRound(1, 'running'));
      expect(client.getQueryData<Session[]>(listKey)!.map((s) => s.status)).toEqual(['stopped']);
      expect(client.getQueryData(sessionKey)).toBeUndefined();
    });

    it('does not cover an update at the same position', () => {
      applySessionUpdate(client, inRound(1, 'stopped'));
      applySessionUpdate(client, { ...inRound(1, 'stopped'), worktreeRemovedAt: '2026-11-11' });
      expect(client.getQueryData(sessionKey)).toMatchObject({ worktreeRemovedAt: '2026-11-11' });
    });

    it('does not cover the next round starting', () => {
      applySessionUpdate(client, inRound(1, 'stopped'));
      applySessionUpdate(client, inRound(2, 'running'));
      expect(client.getQueryData(sessionKey)).toMatchObject({ status: 'running', round: 2 });
    });
  });

  it("refetches only this workspace's session queries after a reconnect", async () => {
    const fetchMine = vi.fn(async () => session('a', 'ended'));
    const fetchTheirs = vi.fn(async () => session('z', 'ended'));
    client.setQueryData(keys.session('w1', 'a'), session('a', 'running'));
    client.setQueryData(keys.session('w2', 'z'), session('z', 'running'));
    const mine = client.getQueryCache().find({ queryKey: keys.session('w1', 'a') })!;
    const theirs = client.getQueryCache().find({ queryKey: keys.session('w2', 'z') })!;
    mine.setOptions({ queryKey: keys.session('w1', 'a'), queryFn: fetchMine });
    theirs.setOptions({ queryKey: keys.session('w2', 'z'), queryFn: fetchTheirs });

    await refetchSessionQueries(client, 'w1');

    expect(fetchMine).toHaveBeenCalled();
    expect(fetchTheirs).not.toHaveBeenCalled();
    expect(client.getQueryData(keys.session('w1', 'a'))).toMatchObject({ status: 'ended' });
  });

  describe('a drafted action update', () => {
    const action = (
      id: string,
      status: DraftedAction['status'],
      updatedAt = '2026-11-12T10:00:00Z',
      overrides: Partial<DraftedAction> = {},
    ) =>
      ({
        id,
        status,
        updatedAt,
        createdAt: '2026-11-12T09:00:00Z',
        type: 'open_pr',
        workspaceId: 'w1',
        sessionId: 'a',
        ticketSourceId: 's1',
        ticketKey: 'T-1',
        ...overrides,
      }) as DraftedAction;
    const listKey = keys.sessionActions('w1', 'a');
    const inboxKey = keys.inbox('w1');
    const ids = (key: readonly unknown[]) =>
      client.getQueryData<DraftedAction[]>(key)!.map((item) => [item.id, item.status]);

    it("adds a new draft to the end of its session's list and the top of the inbox", () => {
      const earlier = action('x', 'pending', undefined, { createdAt: '2026-11-12T08:00:00Z' });
      client.setQueryData(listKey, [earlier]);
      client.setQueryData(inboxKey, [earlier]);

      applyActionUpdate(client, action('y', 'pending'));

      expect(ids(listKey)).toEqual([
        ['x', 'pending'],
        ['y', 'pending'],
      ]);
      expect(ids(inboxKey)).toEqual([
        ['y', 'pending'],
        ['x', 'pending'],
      ]);
    });

    it('keeps an approved action on its session and takes it out of the inbox', () => {
      client.setQueryData(listKey, [action('x', 'pending')]);
      client.setQueryData(inboxKey, [action('x', 'pending')]);

      applyActionUpdate(client, action('x', 'dispatching', '2026-11-12T10:00:01Z'));
      expect(ids(listKey)).toEqual([['x', 'dispatching']]);
      expect(ids(inboxKey)).toEqual([]);

      applyActionUpdate(client, action('x', 'failed', '2026-11-12T10:00:02Z'));
      expect(ids(listKey)).toEqual([['x', 'failed']]);
      expect(ids(inboxKey)).toEqual([['x', 'failed']]);
    });

    it("leaves another session's list alone, and creates no list nobody has loaded", () => {
      const other = keys.sessionActions('w1', 'b');
      client.setQueryData(other, []);
      applyActionUpdate(client, action('x', 'pending'));
      expect(client.getQueryData(other)).toEqual([]);
      expect(client.getQueryData(listKey)).toBeUndefined();
      expect(client.getQueryData(inboxKey)).toBeUndefined();
    });

    it('drops a state saved before the one already held', () => {
      client.setQueryData(listKey, [action('x', 'succeeded', '2026-11-12T10:00:05Z')]);
      client.setQueryData(inboxKey, []);

      applyActionUpdate(client, action('x', 'dispatching', '2026-11-12T10:00:01Z'));

      expect(ids(listKey)).toEqual([['x', 'succeeded']]);
      expect(ids(inboxKey)).toEqual([]);
    });

    it('lets a failed action be approved again', () => {
      client.setQueryData(listKey, [action('x', 'failed', '2026-11-12T10:00:02Z')]);
      applyActionUpdate(client, action('x', 'dispatching', '2026-11-12T10:00:09Z'));
      expect(ids(listKey)).toEqual([['x', 'dispatching']]);
    });

    it('updates the action inside a loaded detail, keeping its branch state', () => {
      const detailKey = keys.actionDetail('w1', 'x');
      const branch = { headCommit: 'abc', commitCount: 1, uncommitted: null };
      client.setQueryData(detailKey, { action: action('x', 'pending'), branch, transitions: null });

      applyActionUpdate(client, action('x', 'rejected', '2026-11-12T10:00:03Z'));

      expect(client.getQueryData<DraftedActionDetail>(detailKey)).toMatchObject({
        action: { status: 'rejected' },
        branch,
      });
    });

    it('rereads the credentials after a failed dispatch, which may have marked one', () => {
      client.setQueryData(keys.githubCredential('w1'), { isSet: true });
      client.setQueryData(keys.sources('w1'), []);
      applyActionUpdate(client, action('x', 'failed'));
      expect(client.getQueryState(keys.githubCredential('w1'))?.isInvalidated).toBe(true);
      expect(client.getQueryState(keys.sources('w1'))?.isInvalidated).toBe(true);
    });

    it("refetches only this workspace's action queries after a reconnect", async () => {
      const fetchMine = vi.fn(async () => [action('x', 'pending')]);
      const fetchTheirs = vi.fn(async () => []);
      client.setQueryData(keys.inbox('w1'), []);
      client.setQueryData(keys.inbox('w2'), []);
      const mine = client.getQueryCache().find({ queryKey: keys.inbox('w1') })!;
      const theirs = client.getQueryCache().find({ queryKey: keys.inbox('w2') })!;
      mine.setOptions({ queryKey: keys.inbox('w1'), queryFn: fetchMine });
      theirs.setOptions({ queryKey: keys.inbox('w2'), queryFn: fetchTheirs });

      await refetchActionQueries(client, 'w1');

      expect(fetchMine).toHaveBeenCalled();
      expect(fetchTheirs).not.toHaveBeenCalled();
      expect(ids(keys.inbox('w1'))).toEqual([['x', 'pending']]);
    });
  });
});

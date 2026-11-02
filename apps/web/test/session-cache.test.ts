import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '@slop-control/shared';
import { applySessionUpdate, keys, refetchSessionQueries } from '../src/lib/session-cache';

const session = (id: string, status: Session['status'], ticketKey = 'acme/widgets#1') =>
  ({ id, status, ticketKey, workspaceId: 'w1' }) as Session;

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
    const key = keys.ticketSessions('w1', 'acme/widgets#1');
    client.setQueryData(key, [session('b', 'running'), session('a', 'running')]);
    applySessionUpdate(client, session('a', 'ended'));
    expect(client.getQueryData<Session[]>(key)!.map((s) => [s.id, s.status])).toEqual([
      ['b', 'running'],
      ['a', 'ended'],
    ]);
  });

  it("adds a new session to the top of its ticket's list", () => {
    const key = keys.ticketSessions('w1', 'acme/widgets#1');
    client.setQueryData(key, [session('a', 'ended')]);
    applySessionUpdate(client, session('b', 'starting'));
    expect(client.getQueryData<Session[]>(key)!.map((s) => s.id)).toEqual(['b', 'a']);
  });

  it("leaves another ticket's list alone", () => {
    const other = keys.ticketSessions('w1', 'acme/widgets#2');
    client.setQueryData(other, []);
    applySessionUpdate(client, session('a', 'running'));
    expect(client.getQueryData(other)).toEqual([]);
  });

  it('does not create a list nobody has loaded', () => {
    applySessionUpdate(client, session('a', 'running'));
    expect(client.getQueryData(keys.ticketSessions('w1', 'acme/widgets#1'))).toBeUndefined();
  });

  it('refreshes an artifact query once the session has an artifact status', () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    applySessionUpdate(client, { ...session('a', 'ended'), artifactStatus: 'complete' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: keys.artifact('w1', 'a') });
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
});

import { describe, expect, it, vi } from 'vitest';
import { ApiRequestError, createApi } from '../src/lib/api';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function setup(response: Response) {
  const fetchFn = vi.fn(async () => response);
  const onUnauthorized = vi.fn();
  const api = createApi({
    getToken: async () => 'tok',
    onUnauthorized,
    fetchFn: fetchFn as unknown as typeof fetch,
  });
  return { api, fetchFn, onUnauthorized };
}

describe('api client', () => {
  it('sends the token on every request', async () => {
    const t = setup(json(200, []));
    await t.api.listWorkspaces();
    const [url, init] = t.fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/workspaces');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer tok');
  });

  it('URL-encodes ticket keys', async () => {
    const t = setup(json(200, {}));
    await t.api.getTicket('w1', 's1', 'acme/widgets#12');
    expect((t.fetchFn.mock.calls[0] as unknown as [string])[0]).toBe(
      '/api/workspaces/w1/sources/s1/tickets/acme%2Fwidgets%2312',
    );
  });

  it('lists tickets across sources with its filters in the query', async () => {
    const t = setup(json(200, { items: [], nextCursor: null, sources: [] }));
    await t.api.listTickets('w1', { sourceId: 's1', category: 'done', mine: false, cursor: 'c' });
    expect((t.fetchFn.mock.calls[0] as unknown as [string])[0]).toBe(
      '/api/workspaces/w1/tickets?sourceId=s1&category=done&mine=false&cursor=c',
    );
  });

  it('asks for a launch preview of the chosen phase and repo', async () => {
    const t = setup(json(200, {}));
    await t.api.launchPreview('w1', 's1', 'T-1', { phase: 'planning', linkedRepoId: 'r1' });
    expect((t.fetchFn.mock.calls[0] as unknown as [string])[0]).toBe(
      '/api/workspaces/w1/sources/s1/tickets/T-1/launch-preview?phase=planning&linkedRepoId=r1',
    );
  });

  it('sends a follow-up message to the session', async () => {
    const t = setup(json(202, {}));
    await t.api.sendMessage('w1', 'abc', 'Also commit your work.');
    const [url, init] = t.fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/workspaces/w1/sessions/abc/messages');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ message: 'Also commit your work.' });
  });

  const call = (t: ReturnType<typeof setup>) => {
    const [url, init] = t.fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    return { url, method: init.method, body: init.body ? JSON.parse(init.body as string) : null };
  };

  it("saves, checks, and removes a workspace's GitHub credential", async () => {
    const saved = setup(json(200, {}));
    await saved.api.setGithubCredential('w1', { token: 'ghp_x' });
    expect(call(saved)).toEqual({
      url: '/api/workspaces/w1/github-credential',
      method: 'PUT',
      body: { token: 'ghp_x' },
    });

    const checked = setup(json(200, {}));
    await checked.api.checkGithubCredential('w1');
    expect(call(checked)).toMatchObject({
      url: '/api/workspaces/w1/github-credential/check',
      method: 'POST',
    });

    const removed = setup(json(200, {}));
    await removed.api.removeGithubCredential('w1');
    expect(call(removed)).toMatchObject({
      url: '/api/workspaces/w1/github-credential',
      method: 'DELETE',
    });
  });

  it("removes a source's credential with a null token, and checks it again", async () => {
    const removed = setup(json(200, {}));
    await removed.api.updateSource('w1', 's1', { token: null });
    expect(call(removed)).toEqual({
      url: '/api/workspaces/w1/sources/s1',
      method: 'PATCH',
      body: { token: null },
    });

    const checked = setup(json(200, {}));
    await checked.api.checkSourceCredential('w1', 's1');
    expect(call(checked)).toMatchObject({
      url: '/api/workspaces/w1/sources/s1/credential-check',
      method: 'POST',
    });
  });

  it("lists the inbox with the server's default statuses, or with each one named", async () => {
    const inbox = setup(json(200, []));
    await inbox.api.listDraftedActions('w1');
    expect(call(inbox).url).toBe('/api/workspaces/w1/drafted-actions');

    const filtered = setup(json(200, []));
    await filtered.api.listDraftedActions('w1', ['pending', 'succeeded']);
    expect(call(filtered).url).toBe(
      '/api/workspaces/w1/drafted-actions?status=pending&status=succeeded',
    );
  });

  it("reads a session's drafted actions and its diff", async () => {
    const actions = setup(json(200, []));
    await actions.api.listSessionActions('w1', 'abc');
    expect(call(actions).url).toBe('/api/workspaces/w1/sessions/abc/drafted-actions');

    const diff = setup(json(200, {}));
    await diff.api.getSessionDiff('w1', 'abc');
    expect(call(diff).url).toBe('/api/workspaces/w1/sessions/abc/diff');
  });

  it('edits, approves with the commit that was shown, and rejects an action', async () => {
    const edited = setup(json(200, {}));
    await edited.api.updateDraftedAction('w1', 'act-1', { title: 'T', body: 'B' });
    expect(call(edited)).toEqual({
      url: '/api/workspaces/w1/drafted-actions/act-1',
      method: 'PATCH',
      body: { title: 'T', body: 'B' },
    });

    const approved = setup(json(200, {}));
    await approved.api.approveAction('w1', 'act-1', { expectedHeadCommit: 'abc123' });
    expect(call(approved)).toEqual({
      url: '/api/workspaces/w1/drafted-actions/act-1/approve',
      method: 'POST',
      body: { expectedHeadCommit: 'abc123' },
    });

    const rejected = setup(json(200, {}));
    await rejected.api.rejectAction('w1', 'act-1');
    expect(call(rejected)).toMatchObject({
      url: '/api/workspaces/w1/drafted-actions/act-1/reject',
      method: 'POST',
    });
  });

  it("raises the server's error code and message", async () => {
    const t = setup(json(503, { code: 'RUNTIME_NOT_READY', message: 'Run claude auth login.' }));
    const error = await t.api.listWorkspaces().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({
      code: 'RUNTIME_NOT_READY',
      message: 'Run claude auth login.',
      status: 503,
    });
  });

  it('sends an expired sign-in back to the sign-in page', async () => {
    const t = setup(json(401, { code: 'UNAUTHENTICATED', message: 'Sign in again.' }));
    await t.api.listWorkspaces().catch(() => undefined);
    expect(t.onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('does not treat other errors as a lost sign-in', async () => {
    const t = setup(json(404, { code: 'NOT_FOUND', message: 'Nope.' }));
    await t.api.listWorkspaces().catch(() => undefined);
    expect(t.onUnauthorized).not.toHaveBeenCalled();
  });

  it('reports a response that is not an ApiError in plain words', async () => {
    const t = setup(new Response('<html>Bad gateway</html>', { status: 502 }));
    const error = await t.api.listWorkspaces().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect((error as Error).message).not.toContain('<html>');
  });
});

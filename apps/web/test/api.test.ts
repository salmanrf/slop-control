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

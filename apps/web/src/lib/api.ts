import type {
  ApiError,
  ApiErrorCode,
  LaunchablePhase,
  LinkedRepo,
  Session,
  SessionArtifact,
  Ticket,
  TicketPage,
  Workspace,
} from '@slop-control/shared';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode | 'UNKNOWN',
    message: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export interface ApiOptions {
  getToken: () => Promise<string | null>;
  onUnauthorized: () => void;
  fetchFn?: typeof fetch;
}

export interface TicketListParams {
  linkedRepoId: string;
  search?: string;
  state?: 'open' | 'closed' | 'all';
  cursor?: string;
}

export type Api = ReturnType<typeof createApi>;

export function createApi({
  getToken,
  onUnauthorized,
  fetchFn = (...args) => fetch(...args),
}: ApiOptions) {
  const request = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const token = await getToken();
    const headers: Record<string, string> = {};
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';

    const response = await fetchFn(`/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.ok) return (await response.json()) as T;

    if (response.status === 401) onUnauthorized();
    throw await toError(response);
  };

  const w = encodeURIComponent;
  return {
    listWorkspaces: () => request<Workspace[]>('GET', '/workspaces'),
    createWorkspace: (name: string) => request<Workspace>('POST', '/workspaces', { name }),
    getWorkspace: (id: string) => request<Workspace>('GET', `/workspaces/${w(id)}`),

    listRepos: (id: string) => request<LinkedRepo[]>('GET', `/workspaces/${w(id)}/repos`),
    linkRepo: (id: string, localPath: string) =>
      request<LinkedRepo>('POST', `/workspaces/${w(id)}/repos`, { localPath }),

    listTickets: (id: string, params: TicketListParams) => {
      const query = new URLSearchParams({ linkedRepoId: params.linkedRepoId });
      if (params.search) query.set('search', params.search);
      if (params.state) query.set('state', params.state);
      if (params.cursor) query.set('cursor', params.cursor);
      return request<TicketPage>('GET', `/workspaces/${w(id)}/tickets?${query}`);
    },
    getTicket: (id: string, key: string) =>
      request<Ticket>('GET', `/workspaces/${w(id)}/tickets/${w(key)}`),

    listTicketSessions: (id: string, key: string) =>
      request<Session[]>('GET', `/workspaces/${w(id)}/tickets/${w(key)}/sessions`),
    startSession: (id: string, key: string, phase: LaunchablePhase) =>
      request<Session>('POST', `/workspaces/${w(id)}/tickets/${w(key)}/sessions`, { phase }),

    getSession: (id: string, sessionId: string) =>
      request<Session>('GET', `/workspaces/${w(id)}/sessions/${w(sessionId)}`),
    getArtifact: (id: string, sessionId: string) =>
      request<SessionArtifact>('GET', `/workspaces/${w(id)}/sessions/${w(sessionId)}/artifact`),
    stopSession: (id: string, sessionId: string) =>
      request<Session>('POST', `/workspaces/${w(id)}/sessions/${w(sessionId)}/stop`),
    removeWorktree: (id: string, sessionId: string, force: boolean) =>
      request<Session>(
        'DELETE',
        `/workspaces/${w(id)}/sessions/${w(sessionId)}/worktree${force ? '?force=true' : ''}`,
      ),
  };
}

async function toError(response: Response): Promise<ApiRequestError> {
  try {
    const body = (await response.json()) as Partial<ApiError>;
    if (body.code && body.message)
      return new ApiRequestError(response.status, body.code, body.message);
  } catch {
    // Not JSON: a proxy or a server that's down. Fall through to the plain message.
  }
  return new ApiRequestError(
    response.status,
    'UNKNOWN',
    `The server couldn't be reached properly (status ${response.status}).`,
  );
}

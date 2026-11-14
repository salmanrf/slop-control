import type {
  ApiError,
  ApiErrorCode,
  ApproveActionBody,
  BuiltInTicketComment,
  ConnectSourceBody,
  CreateBuiltInTicketBody,
  DraftedAction,
  DraftedActionDetail,
  DraftedActionStatus,
  LaunchablePhase,
  LaunchPreview,
  LinkedRepo,
  MergedTicketPage,
  PhaseSetup,
  Session,
  SessionArtifact,
  SessionDiff,
  SetCredentialBody,
  StartSessionBody,
  Ticket,
  TicketCategoryFilter,
  TicketSource,
  UpdateBuiltInTicketBody,
  UpdateDraftedActionBody,
  UpdatePhaseSetupBody,
  UpdateSourceBody,
  Workspace,
  WorkspaceCredentialStatus,
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
  sourceId?: string;
  search?: string;
  category?: TicketCategoryFilter;
  mine?: boolean;
  cursor?: string;
}

export interface LaunchPreviewParams {
  phase?: LaunchablePhase;
  linkedRepoId?: string;
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
  const ticketPath = (id: string, sourceId: string, key: string) =>
    `/workspaces/${w(id)}/sources/${w(sourceId)}/tickets/${w(key)}`;
  return {
    listWorkspaces: () => request<Workspace[]>('GET', '/workspaces'),
    createWorkspace: (name: string) => request<Workspace>('POST', '/workspaces', { name }),
    getWorkspace: (id: string) => request<Workspace>('GET', `/workspaces/${w(id)}`),

    listRepos: (id: string) => request<LinkedRepo[]>('GET', `/workspaces/${w(id)}/repos`),
    linkRepo: (id: string, localPath: string) =>
      request<LinkedRepo>('POST', `/workspaces/${w(id)}/repos`, { localPath }),

    getGithubCredential: (id: string) =>
      request<WorkspaceCredentialStatus>('GET', `/workspaces/${w(id)}/github-credential`),
    setGithubCredential: (id: string, body: SetCredentialBody) =>
      request<WorkspaceCredentialStatus>('PUT', `/workspaces/${w(id)}/github-credential`, body),
    removeGithubCredential: (id: string) =>
      request<WorkspaceCredentialStatus>('DELETE', `/workspaces/${w(id)}/github-credential`),
    checkGithubCredential: (id: string) =>
      request<WorkspaceCredentialStatus>('POST', `/workspaces/${w(id)}/github-credential/check`),

    listSources: (id: string) => request<TicketSource[]>('GET', `/workspaces/${w(id)}/sources`),
    connectSource: (id: string, body: ConnectSourceBody) =>
      request<TicketSource>('POST', `/workspaces/${w(id)}/sources`, body),
    updateSource: (id: string, sourceId: string, body: UpdateSourceBody) =>
      request<TicketSource>('PATCH', `/workspaces/${w(id)}/sources/${w(sourceId)}`, body),
    disconnectSource: (id: string, sourceId: string) =>
      request<TicketSource>('DELETE', `/workspaces/${w(id)}/sources/${w(sourceId)}`),
    checkSourceCredential: (id: string, sourceId: string) =>
      request<TicketSource>('POST', `/workspaces/${w(id)}/sources/${w(sourceId)}/credential-check`),

    listTickets: (id: string, params: TicketListParams = {}) => {
      const query = new URLSearchParams();
      if (params.sourceId) query.set('sourceId', params.sourceId);
      if (params.search) query.set('search', params.search);
      if (params.category) query.set('category', params.category);
      if (params.mine !== undefined) query.set('mine', String(params.mine));
      if (params.cursor) query.set('cursor', params.cursor);
      const suffix = query.size > 0 ? `?${query}` : '';
      return request<MergedTicketPage>('GET', `/workspaces/${w(id)}/tickets${suffix}`);
    },
    getTicket: (id: string, sourceId: string, key: string) =>
      request<Ticket>('GET', ticketPath(id, sourceId, key)),

    createBuiltInTicket: (id: string, body: CreateBuiltInTicketBody) =>
      request<Ticket>('POST', `/workspaces/${w(id)}/built-in-tickets`, body),
    updateBuiltInTicket: (id: string, key: string, body: UpdateBuiltInTicketBody) =>
      request<Ticket>('PATCH', `/workspaces/${w(id)}/built-in-tickets/${w(key)}`, body),
    listComments: (id: string, key: string) =>
      request<BuiltInTicketComment[]>(
        'GET',
        `/workspaces/${w(id)}/built-in-tickets/${w(key)}/comments`,
      ),
    addComment: (id: string, key: string, body: string) =>
      request<BuiltInTicketComment>(
        'POST',
        `/workspaces/${w(id)}/built-in-tickets/${w(key)}/comments`,
        { body },
      ),

    listPhaseSetups: (id: string) =>
      request<PhaseSetup[]>('GET', `/workspaces/${w(id)}/phase-setups`),
    updatePhaseSetup: (id: string, phase: LaunchablePhase, body: UpdatePhaseSetupBody) =>
      request<PhaseSetup>('PATCH', `/workspaces/${w(id)}/phase-setups/${w(phase)}`, body),

    listTicketSessions: (id: string, sourceId: string, key: string) =>
      request<Session[]>('GET', `${ticketPath(id, sourceId, key)}/sessions`),
    startSession: (id: string, sourceId: string, key: string, body: StartSessionBody) =>
      request<Session>('POST', `${ticketPath(id, sourceId, key)}/sessions`, body),
    launchPreview: (
      id: string,
      sourceId: string,
      key: string,
      params: LaunchPreviewParams = {},
    ) => {
      const query = new URLSearchParams();
      if (params.phase) query.set('phase', params.phase);
      if (params.linkedRepoId) query.set('linkedRepoId', params.linkedRepoId);
      const suffix = query.size > 0 ? `?${query}` : '';
      return request<LaunchPreview>(
        'GET',
        `${ticketPath(id, sourceId, key)}/launch-preview${suffix}`,
      );
    },

    sendMessage: (id: string, sessionId: string, message: string) =>
      request<Session>('POST', `/workspaces/${w(id)}/sessions/${w(sessionId)}/messages`, {
        message,
      }),
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
    getSessionDiff: (id: string, sessionId: string) =>
      request<SessionDiff>('GET', `/workspaces/${w(id)}/sessions/${w(sessionId)}/diff`),

    /** With no statuses, the server lists the ones waiting on the developer. */
    listDraftedActions: (id: string, statuses: DraftedActionStatus[] = []) => {
      const query = new URLSearchParams();
      for (const status of statuses) query.append('status', status);
      const suffix = query.size > 0 ? `?${query}` : '';
      return request<DraftedAction[]>('GET', `/workspaces/${w(id)}/drafted-actions${suffix}`);
    },
    listSessionActions: (id: string, sessionId: string) =>
      request<DraftedAction[]>(
        'GET',
        `/workspaces/${w(id)}/sessions/${w(sessionId)}/drafted-actions`,
      ),
    getDraftedAction: (id: string, actionId: string) =>
      request<DraftedActionDetail>('GET', `/workspaces/${w(id)}/drafted-actions/${w(actionId)}`),
    updateDraftedAction: (id: string, actionId: string, body: UpdateDraftedActionBody) =>
      request<DraftedAction>('PATCH', `/workspaces/${w(id)}/drafted-actions/${w(actionId)}`, body),
    approveAction: (id: string, actionId: string, body: ApproveActionBody = {}) =>
      request<DraftedAction>(
        'POST',
        `/workspaces/${w(id)}/drafted-actions/${w(actionId)}/approve`,
        body,
      ),
    rejectAction: (id: string, actionId: string) =>
      request<DraftedAction>('POST', `/workspaces/${w(id)}/drafted-actions/${w(actionId)}/reject`),
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

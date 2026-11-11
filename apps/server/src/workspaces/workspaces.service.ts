import { Injectable } from '@nestjs/common';
import type { LinkedRepo, Workspace } from '@slop-control/shared';
import { ApiException, notFound, validationFailed } from '../common/api-exception';
import { isUuid } from '../common/uuid';
import { Database, isUniqueViolation } from '../db/database';
import { PhaseSetupsService } from '../phase-setups/phase-setups.service';
import { TicketSourceStore } from '../tickets/ticket-source-store';
import { CloneInspector } from './clone-inspector';

interface WorkspaceRow {
  id: string;
  name: string;
  has_linked_repo: boolean;
  created_at: Date;
}

interface LinkedRepoRow {
  id: string;
  workspace_id: string;
  local_path: string;
  github_owner: string;
  github_repo: string;
  default_branch: string;
  created_at: Date;
}

const SELECT_WORKSPACE = `
  select w.id, w.name, w.created_at,
         exists (select 1 from linked_repo r where r.workspace_id = w.id) as has_linked_repo
  from workspace w`;

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly db: Database,
    private readonly inspector: CloneInspector,
    private readonly phaseSetups: PhaseSetupsService,
    private readonly ticketSources: TicketSourceStore,
  ) {}

  async list(): Promise<Workspace[]> {
    const { rows } = await this.db.query<WorkspaceRow>(`${SELECT_WORKSPACE} order by w.name`);
    return rows.map(toWorkspace);
  }

  async create(name: unknown): Promise<Workspace> {
    if (typeof name !== 'string' || name.trim().length === 0) {
      throw validationFailed('A workspace needs a name.');
    }
    const trimmed = name.trim();
    try {
      // A workspace is never without its built-in tracker and phase setups (FR-6e, FR-14).
      const id = await this.db.transaction(async (tx) => {
        const { rows } = await tx.query<{ id: string }>(
          'insert into workspace (name) values ($1) returning id',
          [trimmed],
        );
        const workspaceId = rows[0]!.id;
        await this.ticketSources.createBuiltIn(workspaceId, tx);
        await this.phaseSetups.createDefaults(workspaceId, tx);
        return workspaceId;
      });
      return await this.get(id);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ApiException(
          409,
          'WORKSPACE_NAME_TAKEN',
          `A workspace named "${trimmed}" already exists.`,
        );
      }
      throw error;
    }
  }

  async get(workspaceId: string): Promise<Workspace> {
    if (!isUuid(workspaceId)) throw notFound('Workspace not found.');
    const { rows } = await this.db.query<WorkspaceRow>(`${SELECT_WORKSPACE} where w.id = $1`, [
      workspaceId,
    ]);
    if (!rows[0]) throw notFound('Workspace not found.');
    return toWorkspace(rows[0]);
  }

  async listRepos(workspaceId: string): Promise<LinkedRepo[]> {
    await this.get(workspaceId);
    const { rows } = await this.db.query<LinkedRepoRow>(
      'select * from linked_repo where workspace_id = $1 order by created_at',
      [workspaceId],
    );
    return rows.map(toLinkedRepo);
  }

  async getRepo(workspaceId: string, linkedRepoId: string): Promise<LinkedRepo> {
    if (!isUuid(linkedRepoId)) throw notFound('Linked repo not found.');
    const { rows } = await this.db.query<LinkedRepoRow>(
      'select * from linked_repo where workspace_id = $1 and id = $2',
      [workspaceId, linkedRepoId],
    );
    if (!rows[0]) throw notFound('Linked repo not found.');
    return toLinkedRepo(rows[0]);
  }

  async linkRepo(workspaceId: string, localPath: unknown): Promise<LinkedRepo> {
    await this.get(workspaceId);
    const clone = await this.inspector.inspect(localPath);
    try {
      const { rows } = await this.db.query<LinkedRepoRow>(
        `insert into linked_repo (workspace_id, local_path, github_owner, github_repo, default_branch)
         values ($1, $2, $3, $4, $5) returning *`,
        [workspaceId, clone.localPath, clone.githubOwner, clone.githubRepo, clone.defaultBranch],
      );
      return toLinkedRepo(rows[0]!);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ApiException(
          409,
          'REPO_ALREADY_LINKED',
          `${clone.localPath} is already linked to this workspace.`,
        );
      }
      throw error;
    }
  }
}

function toWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    name: row.name,
    hasLinkedRepo: row.has_linked_repo,
    createdAt: row.created_at.toISOString(),
  };
}

function toLinkedRepo(row: LinkedRepoRow): LinkedRepo {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    localPath: row.local_path,
    githubOwner: row.github_owner,
    githubRepo: row.github_repo,
    defaultBranch: row.default_branch,
    createdAt: row.created_at.toISOString(),
  };
}

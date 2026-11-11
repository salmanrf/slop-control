import { Injectable } from '@nestjs/common';
import type {
  LaunchablePhase,
  PhaseSetup,
  SessionSetup,
  UpdatePhaseSetupBody,
} from '@slop-control/shared';
import { notFound, validationFailed } from '../common/api-exception';
import { isUuid } from '../common/uuid';
import { Database, type Queryable } from '../db/database';
import { DEFAULT_PHASE_SETUPS, LAUNCHABLE_PHASES, isLaunchablePhase } from './phase-defaults';

interface PhaseSetupRow {
  workspace_id: string;
  phase: LaunchablePhase;
  instruction: string;
  may_change_code: boolean;
  required_artifact_path: string;
  user_level_source: boolean;
  updated_at: Date;
}

const EDITABLE_FIELDS = ['instruction', 'userLevelSource'];

/** Each workspace's phase setups. Every workspace has all four, so a missing one means no workspace. */
@Injectable()
export class PhaseSetupsService {
  constructor(private readonly db: Database) {}

  /**
   * @params workspaceId: the workspace
   * @return its phase setups, one per launchable phase, in the default order
   * Lists a workspace's phase setups.
   */
  async list(workspaceId: string): Promise<PhaseSetup[]> {
    if (!isUuid(workspaceId)) throw notFound('Workspace not found.');
    const { rows } = await this.db.query<PhaseSetupRow>(
      'select * from phase_setup where workspace_id = $1',
      [workspaceId],
    );
    if (rows.length === 0) throw notFound('Workspace not found.');
    const setups = rows.map(toPhaseSetup);
    return LAUNCHABLE_PHASES.flatMap((phase) => setups.filter((setup) => setup.phase === phase));
  }

  /**
   * @params workspaceId: the workspace; phase: a launchable phase
   * @return that phase's setup, or throws NOT_FOUND
   * Reads one phase setup, for a launch or a preview.
   */
  async get(workspaceId: string, phase: LaunchablePhase): Promise<PhaseSetup> {
    const setup = (await this.list(workspaceId)).find((item) => item.phase === phase);
    if (!setup) throw notFound('Phase setup not found.');
    return setup;
  }

  /**
   * @params workspaceId: the workspace; phase: a launchable phase; body: the instruction and the user-level source switch
   * @return the updated setup, or throws an ApiException listed under the update endpoint
   * Changes the editable fields. Scope and stop condition can't be changed in v0.
   */
  async update(workspaceId: string, phase: unknown, body: unknown): Promise<PhaseSetup> {
    if (!isLaunchablePhase(phase)) throw notFound('Phase setup not found.');
    const current = await this.get(workspaceId, phase);
    const changes = parseUpdate(body);
    if (changes.instruction === undefined && changes.userLevelSource === undefined) return current;

    const { rows } = await this.db.query<PhaseSetupRow>(
      `update phase_setup
       set instruction = coalesce($3, instruction),
           user_level_source = coalesce($4, user_level_source),
           updated_at = now()
       where workspace_id = $1 and phase = $2 returning *`,
      [workspaceId, phase, changes.instruction ?? null, changes.userLevelSource ?? null],
    );
    return toPhaseSetup(rows[0]!);
  }

  /**
   * @params workspaceId: a workspace that was just created; db: the transaction creating it
   * @return nothing
   * Creates the four default phase setups.
   */
  async createDefaults(workspaceId: string, db: Queryable = this.db): Promise<void> {
    for (const phase of LAUNCHABLE_PHASES) {
      const setup = DEFAULT_PHASE_SETUPS[phase];
      await db.query(
        `insert into phase_setup
           (workspace_id, phase, instruction, may_change_code, required_artifact_path, user_level_source)
         values ($1, $2, $3, $4, $5, $6)`,
        [
          workspaceId,
          phase,
          setup.instruction,
          setup.scope.mayChangeCode,
          setup.stopCondition.requiredArtifactPath,
          setup.userLevelSource,
        ],
      );
    }
  }
}

/** The part of a phase setup a session keeps. */
export function toSessionSetup(setup: PhaseSetup): SessionSetup {
  return {
    instruction: setup.instruction,
    scope: setup.scope,
    stopCondition: setup.stopCondition,
    userLevelSource: setup.userLevelSource,
  };
}

function parseUpdate(body: unknown): UpdatePhaseSetupBody {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw validationFailed('Send the fields to change.');
  }
  const unknownField = Object.keys(body).find((name) => !EDITABLE_FIELDS.includes(name));
  if (unknownField) {
    throw validationFailed(
      `Only the instruction and the user-level source switch can be changed, not ${unknownField}.`,
    );
  }
  const { instruction, userLevelSource } = body as Record<string, unknown>;
  const changes: UpdatePhaseSetupBody = {};
  if (instruction !== undefined) {
    if (typeof instruction !== 'string' || instruction.trim().length === 0) {
      throw validationFailed('A phase needs an instruction.');
    }
    changes.instruction = instruction.trim();
  }
  if (userLevelSource !== undefined) {
    if (typeof userLevelSource !== 'boolean') {
      throw validationFailed('The user-level source switch must be true or false.');
    }
    changes.userLevelSource = userLevelSource;
  }
  return changes;
}

function toPhaseSetup(row: PhaseSetupRow): PhaseSetup {
  return {
    workspaceId: row.workspace_id,
    phase: row.phase,
    instruction: row.instruction,
    scope: { mayChangeCode: row.may_change_code },
    stopCondition: { requiredArtifactPath: row.required_artifact_path },
    userLevelSource: row.user_level_source,
    updatedAt: row.updated_at.toISOString(),
  };
}

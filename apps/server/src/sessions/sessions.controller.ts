import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import type { Session, SessionArtifact } from '@slop-control/shared';
import type { Response } from 'express';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { SessionUpdates } from './session-updates';
import { SessionsService } from './sessions.service';

@Controller('workspaces/:workspaceId')
export class SessionsController {
  constructor(
    private readonly sessions: SessionsService,
    private readonly updates: SessionUpdates,
    private readonly workspaces: WorkspacesService,
  ) {}

  @Get('tickets/:ticketKey/sessions')
  listForTicket(
    @Param('workspaceId') workspaceId: string,
    @Param('ticketKey') ticketKey: string,
  ): Promise<Session[]> {
    return this.sessions.listForTicket(workspaceId, ticketKey);
  }

  @Post('tickets/:ticketKey/sessions')
  start(
    @Param('workspaceId') workspaceId: string,
    @Param('ticketKey') ticketKey: string,
    @Body() body: { phase?: unknown } | undefined,
  ): Promise<Session> {
    return this.sessions.start(workspaceId, ticketKey, body?.phase);
  }

  /** A plain route rather than `@Sse`, which can't send the heartbeat comments the contract asks for. */
  @Get('session-updates')
  async streamUpdates(@Param('workspaceId') workspaceId: string, @Res() response: Response): Promise<void> {
    await this.workspaces.get(workspaceId);
    this.updates.attach(workspaceId, response);
  }

  @Get('sessions/:sessionId')
  get(@Param('workspaceId') workspaceId: string, @Param('sessionId') sessionId: string): Promise<Session> {
    return this.sessions.get(workspaceId, sessionId);
  }

  @Get('sessions/:sessionId/artifact')
  artifact(
    @Param('workspaceId') workspaceId: string,
    @Param('sessionId') sessionId: string,
  ): Promise<SessionArtifact> {
    return this.sessions.artifact(workspaceId, sessionId);
  }

  @Post('sessions/:sessionId/stop')
  @HttpCode(200)
  stop(@Param('workspaceId') workspaceId: string, @Param('sessionId') sessionId: string): Promise<Session> {
    return this.sessions.stop(workspaceId, sessionId);
  }

  @Delete('sessions/:sessionId/worktree')
  removeWorktree(
    @Param('workspaceId') workspaceId: string,
    @Param('sessionId') sessionId: string,
    @Query('force') force: string | undefined,
  ): Promise<Session> {
    return this.sessions.removeWorktree(workspaceId, sessionId, force === 'true');
  }
}

import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import type { LaunchPreview, Session, SessionArtifact } from '@slop-control/shared';
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

  @Get('sources/:sourceId/tickets/:ticketKey/sessions')
  listForTicket(
    @Param('workspaceId') workspaceId: string,
    @Param('sourceId') sourceId: string,
    @Param('ticketKey') ticketKey: string,
  ): Promise<Session[]> {
    return this.sessions.listForTicket(workspaceId, sourceId, ticketKey);
  }

  @Post('sources/:sourceId/tickets/:ticketKey/sessions')
  start(
    @Param('workspaceId') workspaceId: string,
    @Param('sourceId') sourceId: string,
    @Param('ticketKey') ticketKey: string,
    @Body() body: unknown,
  ): Promise<Session> {
    return this.sessions.start(workspaceId, sourceId, ticketKey, body);
  }

  @Get('sources/:sourceId/tickets/:ticketKey/launch-preview')
  launchPreview(
    @Param('workspaceId') workspaceId: string,
    @Param('sourceId') sourceId: string,
    @Param('ticketKey') ticketKey: string,
    @Query('phase') phase: string | undefined,
    @Query('linkedRepoId') linkedRepoId: string | undefined,
  ): Promise<LaunchPreview> {
    return this.sessions.launchPreview(
      workspaceId,
      sourceId,
      ticketKey,
      phase === undefined || phase === '' ? undefined : phase,
      typeof linkedRepoId === 'string' && linkedRepoId ? linkedRepoId : undefined,
    );
  }

  /** A plain route rather than `@Sse`, which can't send the heartbeat comments the contract asks for. */
  @Get('session-updates')
  async streamUpdates(
    @Param('workspaceId') workspaceId: string,
    @Res() response: Response,
  ): Promise<void> {
    await this.workspaces.get(workspaceId);
    this.updates.attach(workspaceId, response);
  }

  @Get('sessions/:sessionId')
  get(
    @Param('workspaceId') workspaceId: string,
    @Param('sessionId') sessionId: string,
  ): Promise<Session> {
    return this.sessions.get(workspaceId, sessionId);
  }

  @Get('sessions/:sessionId/artifact')
  artifact(
    @Param('workspaceId') workspaceId: string,
    @Param('sessionId') sessionId: string,
  ): Promise<SessionArtifact> {
    return this.sessions.artifact(workspaceId, sessionId);
  }

  @Post('sessions/:sessionId/messages')
  @HttpCode(202)
  sendMessage(
    @Param('workspaceId') workspaceId: string,
    @Param('sessionId') sessionId: string,
    @Body() body: unknown,
  ): Promise<Session> {
    return this.sessions.sendMessage(workspaceId, sessionId, body);
  }

  @Post('sessions/:sessionId/stop')
  @HttpCode(200)
  stop(
    @Param('workspaceId') workspaceId: string,
    @Param('sessionId') sessionId: string,
  ): Promise<Session> {
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

import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import type { DraftedAction, DraftedActionDetail } from '@slop-control/shared';
import { DraftedActionsService } from './drafted-actions.service';

@Controller('workspaces/:workspaceId')
export class DraftedActionsController {
  constructor(private readonly actions: DraftedActionsService) {}

  @Get('drafted-actions')
  list(
    @Param('workspaceId') workspaceId: string,
    @Query('status') status: unknown,
  ): Promise<DraftedAction[]> {
    return this.actions.list(workspaceId, status);
  }

  @Get('sessions/:sessionId/drafted-actions')
  listForSession(
    @Param('workspaceId') workspaceId: string,
    @Param('sessionId') sessionId: string,
  ): Promise<DraftedAction[]> {
    return this.actions.listForSession(workspaceId, sessionId);
  }

  @Get('drafted-actions/:actionId')
  get(
    @Param('workspaceId') workspaceId: string,
    @Param('actionId') actionId: string,
  ): Promise<DraftedActionDetail> {
    return this.actions.get(workspaceId, actionId);
  }

  @Patch('drafted-actions/:actionId')
  update(
    @Param('workspaceId') workspaceId: string,
    @Param('actionId') actionId: string,
    @Body() body: unknown,
  ): Promise<DraftedAction> {
    return this.actions.update(workspaceId, actionId, body);
  }

  @Post('drafted-actions/:actionId/approve')
  @HttpCode(200)
  approve(
    @Param('workspaceId') workspaceId: string,
    @Param('actionId') actionId: string,
    @Body() body: unknown,
  ): Promise<DraftedAction> {
    return this.actions.approve(workspaceId, actionId, body);
  }

  @Post('drafted-actions/:actionId/reject')
  @HttpCode(200)
  reject(
    @Param('workspaceId') workspaceId: string,
    @Param('actionId') actionId: string,
  ): Promise<DraftedAction> {
    return this.actions.reject(workspaceId, actionId);
  }
}

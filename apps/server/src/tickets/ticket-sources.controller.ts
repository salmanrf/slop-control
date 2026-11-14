import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import type { TicketSource } from '@slop-control/shared';
import { TicketSourcesService } from './ticket-sources.service';

@Controller('workspaces/:workspaceId/sources')
export class TicketSourcesController {
  constructor(private readonly sources: TicketSourcesService) {}

  @Get()
  list(@Param('workspaceId') workspaceId: string): Promise<TicketSource[]> {
    return this.sources.list(workspaceId);
  }

  @Post()
  connect(@Param('workspaceId') workspaceId: string, @Body() body: unknown): Promise<TicketSource> {
    return this.sources.connect(workspaceId, body);
  }

  @Patch(':sourceId')
  update(
    @Param('workspaceId') workspaceId: string,
    @Param('sourceId') sourceId: string,
    @Body() body: unknown,
  ): Promise<TicketSource> {
    return this.sources.update(workspaceId, sourceId, body);
  }

  @Post(':sourceId/credential-check')
  @HttpCode(200)
  checkCredential(
    @Param('workspaceId') workspaceId: string,
    @Param('sourceId') sourceId: string,
  ): Promise<TicketSource> {
    return this.sources.checkCredential(workspaceId, sourceId);
  }

  @Delete(':sourceId')
  disconnect(
    @Param('workspaceId') workspaceId: string,
    @Param('sourceId') sourceId: string,
  ): Promise<TicketSource> {
    return this.sources.disconnect(workspaceId, sourceId);
  }
}

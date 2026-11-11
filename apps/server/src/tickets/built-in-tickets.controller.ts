import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import type { BuiltInTicketComment, Ticket } from '@slop-control/shared';
import { BuiltInTracker } from './built-in-tracker';

/** For the dashboard only: sessions get no route to these (FR-6f). */
@Controller('workspaces/:workspaceId/built-in-tickets')
export class BuiltInTicketsController {
  constructor(private readonly builtIn: BuiltInTracker) {}

  @Post()
  create(@Param('workspaceId') workspaceId: string, @Body() body: unknown): Promise<Ticket> {
    return this.builtIn.create(workspaceId, body);
  }

  @Patch(':ticketKey')
  update(
    @Param('workspaceId') workspaceId: string,
    @Param('ticketKey') ticketKey: string,
    @Body() body: unknown,
  ): Promise<Ticket> {
    return this.builtIn.update(workspaceId, ticketKey, body);
  }

  @Get(':ticketKey/comments')
  listComments(
    @Param('workspaceId') workspaceId: string,
    @Param('ticketKey') ticketKey: string,
  ): Promise<BuiltInTicketComment[]> {
    return this.builtIn.listComments(workspaceId, ticketKey);
  }

  @Post(':ticketKey/comments')
  addComment(
    @Param('workspaceId') workspaceId: string,
    @Param('ticketKey') ticketKey: string,
    @Body() body: unknown,
  ): Promise<BuiltInTicketComment> {
    return this.builtIn.addComment(workspaceId, ticketKey, body);
  }
}

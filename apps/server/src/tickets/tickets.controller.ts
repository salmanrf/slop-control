import { Controller, Get, Param, Query } from '@nestjs/common';
import type { MergedTicketPage, Ticket, TicketQuery } from '@slop-control/shared';
import { TicketsService } from './tickets.service';

const CATEGORIES: readonly unknown[] = [
  'open',
  'in_progress',
  'done',
  'not_done',
  'all',
] satisfies TicketQuery['category'][];

@Controller('workspaces/:workspaceId')
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Get('tickets')
  list(
    @Param('workspaceId') workspaceId: string,
    @Query('sourceId') sourceId: string | undefined,
    @Query('search') search: string | undefined,
    @Query('category') category: string | undefined,
    @Query('mine') mine: string | undefined,
    @Query('cursor') cursor: string | undefined,
  ): Promise<MergedTicketPage> {
    const query: TicketQuery = { mine: mine !== 'false' };
    if (typeof search === 'string' && search) query.search = search;
    if (CATEGORIES.includes(category)) query.category = category as TicketQuery['category'];
    if (typeof cursor === 'string' && cursor) query.cursor = cursor;
    return this.tickets.list(
      workspaceId,
      typeof sourceId === 'string' && sourceId ? sourceId : undefined,
      query,
    );
  }

  @Get('sources/:sourceId/tickets/:ticketKey')
  get(
    @Param('workspaceId') workspaceId: string,
    @Param('sourceId') sourceId: string,
    @Param('ticketKey') ticketKey: string,
  ): Promise<Ticket> {
    return this.tickets.get(workspaceId, sourceId, ticketKey);
  }
}

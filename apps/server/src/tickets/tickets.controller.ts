import { Controller, Get, Param, Query } from '@nestjs/common';
import type { Ticket, TicketPage, TicketQuery } from '@slop-control/shared';
import { TicketsService } from './tickets.service';

const STATES: readonly unknown[] = ['open', 'closed', 'all'] satisfies TicketQuery['state'][];

@Controller('workspaces/:workspaceId/tickets')
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Get()
  list(
    @Param('workspaceId') workspaceId: string,
    @Query('linkedRepoId') linkedRepoId: string | undefined,
    @Query('search') search: string | undefined,
    @Query('state') state: string | undefined,
    @Query('cursor') cursor: string | undefined,
  ): Promise<TicketPage> {
    const query: TicketQuery = {};
    if (typeof search === 'string' && search) query.search = search;
    if (STATES.includes(state)) query.state = state as TicketQuery['state'];
    if (typeof cursor === 'string' && cursor) query.cursor = cursor;
    return this.tickets.list(
      workspaceId,
      typeof linkedRepoId === 'string' ? linkedRepoId : undefined,
      query,
    );
  }

  @Get(':ticketKey')
  get(
    @Param('workspaceId') workspaceId: string,
    @Param('ticketKey') ticketKey: string,
  ): Promise<Ticket> {
    return this.tickets.get(workspaceId, ticketKey);
  }
}

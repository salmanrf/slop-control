import { Module } from '@nestjs/common';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { BuiltInTicketsController } from './built-in-tickets.controller';
import { BuiltInTracker } from './built-in-tracker';
import { GitHubTrackerFactory } from './github-issues.adapter';
import { TicketSourceStoreModule } from './ticket-source-store';
import { TicketSourcesController } from './ticket-sources.controller';
import { TicketSourcesService } from './ticket-sources.service';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';
import { TrackerAdapterFactory } from './tracker';

@Module({
  imports: [WorkspacesModule, TicketSourceStoreModule],
  controllers: [TicketsController, TicketSourcesController, BuiltInTicketsController],
  providers: [
    TicketsService,
    TicketSourcesService,
    BuiltInTracker,
    { provide: TrackerAdapterFactory, useClass: GitHubTrackerFactory },
  ],
  exports: [TicketsService, TicketSourcesService],
})
export class TicketsModule {}

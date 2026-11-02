import { Module } from '@nestjs/common';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { GitHubTrackerFactory } from './github-issues.adapter';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';
import { TrackerAdapterFactory } from './tracker';

@Module({
  imports: [WorkspacesModule],
  controllers: [TicketsController],
  providers: [TicketsService, { provide: TrackerAdapterFactory, useClass: GitHubTrackerFactory }],
  exports: [TicketsService],
})
export class TicketsModule {}

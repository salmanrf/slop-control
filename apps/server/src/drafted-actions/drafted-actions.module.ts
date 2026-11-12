import { Module } from '@nestjs/common';
import { CredentialsModule } from '../credentials/credentials.module';
import { RepoHostModule } from '../repo-host/repo-host.module';
import { SessionStateModule } from '../sessions/session-state.module';
import { TicketsModule } from '../tickets/tickets.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { WorktreesModule } from '../worktrees/worktrees.module';
import { DraftedActionStore } from './drafted-action-store';
import { DraftedActionsController } from './drafted-actions.controller';
import { DraftedActionsService } from './drafted-actions.service';

@Module({
  imports: [
    SessionStateModule,
    WorktreesModule,
    WorkspacesModule,
    TicketsModule,
    CredentialsModule,
    RepoHostModule,
  ],
  controllers: [DraftedActionsController],
  providers: [DraftedActionsService, DraftedActionStore],
  exports: [DraftedActionsService],
})
export class DraftedActionsModule {}

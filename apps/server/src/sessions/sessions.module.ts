import { Module } from '@nestjs/common';
import { DraftedActionsModule } from '../drafted-actions/drafted-actions.module';
import { PhaseSetupsModule } from '../phase-setups/phase-setups.module';
import { TicketsModule } from '../tickets/tickets.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { WorktreesModule } from '../worktrees/worktrees.module';
import { ClaudeCodeRuntime } from './claude-code.runtime';
import { SessionRuntime } from './runtime';
import { SessionStateModule } from './session-state.module';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';

@Module({
  imports: [
    TicketsModule,
    WorkspacesModule,
    WorktreesModule,
    PhaseSetupsModule,
    SessionStateModule,
    DraftedActionsModule,
  ],
  controllers: [SessionsController],
  providers: [SessionsService, { provide: SessionRuntime, useClass: ClaudeCodeRuntime }],
})
export class SessionsModule {}

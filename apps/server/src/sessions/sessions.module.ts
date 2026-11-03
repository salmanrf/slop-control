import { Module } from '@nestjs/common';
import { TicketsModule } from '../tickets/tickets.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { WorktreesModule } from '../worktrees/worktrees.module';
import { ClaudeCodeRuntime } from './claude-code.runtime';
import { SessionRuntime } from './runtime';
import { SessionStore } from './session-store';
import { SessionUpdates } from './session-updates';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';

@Module({
  imports: [TicketsModule, WorkspacesModule, WorktreesModule],
  controllers: [SessionsController],
  providers: [
    SessionsService,
    SessionStore,
    SessionUpdates,
    { provide: SessionRuntime, useClass: ClaudeCodeRuntime },
  ],
})
export class SessionsModule {}

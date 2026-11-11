import { Module } from '@nestjs/common';
import { CoreModule } from './core.module';
import { PhaseSetupsModule } from './phase-setups/phase-setups.module';
import { SessionsModule } from './sessions/sessions.module';
import { TicketsModule } from './tickets/tickets.module';
import { WorkspacesModule } from './workspaces/workspaces.module';

@Module({
  imports: [CoreModule, WorkspacesModule, PhaseSetupsModule, TicketsModule, SessionsModule],
})
export class AppModule {}

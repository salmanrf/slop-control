import { Module } from '@nestjs/common';
import { PhaseSetupsModule } from '../phase-setups/phase-setups.module';
import { TicketSourceStoreModule } from '../tickets/ticket-source-store';
import { CloneInspector } from './clone-inspector';
import { WorkspacesController } from './workspaces.controller';
import { WorkspacesService } from './workspaces.service';

@Module({
  imports: [PhaseSetupsModule, TicketSourceStoreModule],
  controllers: [WorkspacesController],
  providers: [WorkspacesService, CloneInspector],
  exports: [WorkspacesService],
})
export class WorkspacesModule {}

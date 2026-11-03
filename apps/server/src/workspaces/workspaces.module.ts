import { Module } from '@nestjs/common';
import { CloneInspector } from './clone-inspector';
import { WorkspacesController } from './workspaces.controller';
import { WorkspacesService } from './workspaces.service';

@Module({
  controllers: [WorkspacesController],
  providers: [WorkspacesService, CloneInspector],
  exports: [WorkspacesService],
})
export class WorkspacesModule {}

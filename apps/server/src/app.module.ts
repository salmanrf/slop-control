import { Module } from '@nestjs/common';
import { CoreModule } from './core.module';
import { WorkspacesModule } from './workspaces/workspaces.module';

@Module({
  imports: [CoreModule, WorkspacesModule],
})
export class AppModule {}

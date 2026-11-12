import { Module } from '@nestjs/common';
import { RepoHostModule } from '../repo-host/repo-host.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { CredentialsController } from './credentials.controller';
import { CredentialsService } from './credentials.service';

@Module({
  imports: [WorkspacesModule, RepoHostModule],
  controllers: [CredentialsController],
  providers: [CredentialsService],
  exports: [CredentialsService],
})
export class CredentialsModule {}

import { Module } from '@nestjs/common';
import { GitHubRepoHost } from './github-repo-host';
import { RepoHost } from './repo-host';

@Module({
  providers: [{ provide: RepoHost, useClass: GitHubRepoHost }],
  exports: [RepoHost],
})
export class RepoHostModule {}

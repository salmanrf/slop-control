import { Module } from '@nestjs/common';
import { GitWorktreeManager, WorktreeManager } from './worktree-manager';

@Module({
  providers: [{ provide: WorktreeManager, useClass: GitWorktreeManager }],
  exports: [WorktreeManager],
})
export class WorktreesModule {}

import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import type { LinkedRepo, Workspace } from '@slop-control/shared';
import { WorkspacesService } from './workspaces.service';

@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Get()
  list(): Promise<Workspace[]> {
    return this.workspaces.list();
  }

  @Post()
  create(@Body() body: { name?: unknown } | undefined): Promise<Workspace> {
    return this.workspaces.create(body?.name);
  }

  @Get(':workspaceId')
  get(@Param('workspaceId') workspaceId: string): Promise<Workspace> {
    return this.workspaces.get(workspaceId);
  }

  @Get(':workspaceId/repos')
  listRepos(@Param('workspaceId') workspaceId: string): Promise<LinkedRepo[]> {
    return this.workspaces.listRepos(workspaceId);
  }

  @Post(':workspaceId/repos')
  linkRepo(
    @Param('workspaceId') workspaceId: string,
    @Body() body: { localPath?: unknown } | undefined,
  ): Promise<LinkedRepo> {
    return this.workspaces.linkRepo(workspaceId, body?.localPath);
  }
}

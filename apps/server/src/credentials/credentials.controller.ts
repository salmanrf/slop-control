import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import type { WorkspaceCredentialStatus } from '@slop-control/shared';
import { CredentialsService } from './credentials.service';

@Controller('workspaces/:workspaceId/github-credential')
export class CredentialsController {
  constructor(private readonly credentials: CredentialsService) {}

  @Get()
  status(@Param('workspaceId') workspaceId: string): Promise<WorkspaceCredentialStatus> {
    return this.credentials.status(workspaceId);
  }

  @Put()
  set(
    @Param('workspaceId') workspaceId: string,
    @Body() body: unknown,
  ): Promise<WorkspaceCredentialStatus> {
    return this.credentials.set(workspaceId, body);
  }

  @Delete()
  remove(@Param('workspaceId') workspaceId: string): Promise<WorkspaceCredentialStatus> {
    return this.credentials.remove(workspaceId);
  }

  @Post('check')
  @HttpCode(200)
  check(@Param('workspaceId') workspaceId: string): Promise<WorkspaceCredentialStatus> {
    return this.credentials.check(workspaceId);
  }
}

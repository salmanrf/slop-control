import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import type { PhaseSetup } from '@slop-control/shared';
import { PhaseSetupsService } from './phase-setups.service';

@Controller('workspaces/:workspaceId/phase-setups')
export class PhaseSetupsController {
  constructor(private readonly phaseSetups: PhaseSetupsService) {}

  @Get()
  list(@Param('workspaceId') workspaceId: string): Promise<PhaseSetup[]> {
    return this.phaseSetups.list(workspaceId);
  }

  @Patch(':phase')
  update(
    @Param('workspaceId') workspaceId: string,
    @Param('phase') phase: string,
    @Body() body: unknown,
  ): Promise<PhaseSetup> {
    return this.phaseSetups.update(workspaceId, phase, body);
  }
}

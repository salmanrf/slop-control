import { Module } from '@nestjs/common';
import { PhaseSetupsController } from './phase-setups.controller';
import { PhaseSetupsService } from './phase-setups.service';

/** Depends on nothing but the database, so the workspaces module can create defaults through it. */
@Module({
  controllers: [PhaseSetupsController],
  providers: [PhaseSetupsService],
  exports: [PhaseSetupsService],
})
export class PhaseSetupsModule {}

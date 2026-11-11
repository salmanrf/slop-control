import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { AppConfig } from '../../src/config';
import { SessionRuntime } from '../../src/sessions/runtime';
import { ScriptedRuntime } from '../support/scripted-runtime';

/**
 * The server as the browser run starts it: everything real except Claude Code, which the
 * scripted runtime replaces. This file is outside `src`, so the production build leaves it out
 * and no setting can select it. Settings come from the environment, as in `main.ts`.
 */
async function bootstrap(): Promise<void> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SessionRuntime)
    .useValue(new ScriptedRuntime())
    .compile();
  const app = moduleRef.createNestApplication();
  app.enableShutdownHooks();
  const config = app.get(AppConfig);
  await app.listen(config.port, config.host);
}

void bootstrap();

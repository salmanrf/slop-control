import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { existsSync } from 'node:fs';
import { AppModule } from './app.module';
import { AppConfig } from './config';

/** Settings are optional, because the local defaults work without any. */
function loadOptionalEnvFile(): void {
  if (existsSync('.env')) process.loadEnvFile('.env');
}

async function bootstrap(): Promise<void> {
  loadOptionalEnvFile();
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  const config = app.get(AppConfig);
  await app.listen(config.port, config.host);
}

void bootstrap();

import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth/auth.guard';
import { ApiExceptionFilter } from './common/api-exception.filter';
import { Redactor } from './common/redactor';
import { AppConfig, loadConfig } from './config';
import { Database } from './db/database';

/** Config, database, redaction, auth, and error handling, available everywhere. */
@Global()
@Module({
  providers: [
    { provide: AppConfig, useFactory: () => loadConfig() },
    Database,
    Redactor,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
  ],
  exports: [AppConfig, Database, Redactor],
})
export class CoreModule {}

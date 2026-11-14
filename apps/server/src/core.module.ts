import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth/auth.guard';
import { ApiExceptionFilter } from './common/api-exception.filter';
import { Redactor } from './common/redactor';
import { PgSecretStore, SecretStore } from './common/secret-store';
import { AppConfig, loadConfig } from './config';
import { Database } from './db/database';

/** Config, database, redaction, secrets, auth, and error handling, available everywhere. */
@Global()
@Module({
  providers: [
    { provide: AppConfig, useFactory: () => loadConfig() },
    Database,
    Redactor,
    { provide: SecretStore, useClass: PgSecretStore },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
  ],
  exports: [AppConfig, Database, Redactor, SecretStore],
})
export class CoreModule {}

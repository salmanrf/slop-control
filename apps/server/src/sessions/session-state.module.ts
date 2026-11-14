import { Module } from '@nestjs/common';
import { SessionStore } from './session-store';
import { SessionUpdates } from './session-updates';

/** Session records and the status stream, apart from the service that runs sessions, so drafted actions can use both. */
@Module({
  providers: [SessionStore, SessionUpdates],
  exports: [SessionStore, SessionUpdates],
})
export class SessionStateModule {}

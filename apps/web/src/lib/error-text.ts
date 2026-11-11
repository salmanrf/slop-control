import type { ApiErrorCode } from '@slop-control/shared';
import { ApiRequestError } from './api';

/** Codes whose meaning is clearer said one way everywhere than in the server's own words. */
const CODE_MESSAGES: Partial<Record<ApiErrorCode, string>> = {
  SESSION_NOT_RESUMABLE:
    "This session can't be resumed, because Claude Code never started it. Start a new session instead.",
  SESSION_ACTIVE: 'This session is still running. Wait for it to end, or stop it first.',
  SOURCE_DISCONNECTED:
    "This ticket's source is disconnected. Reconnect it under Ticket sources to read the ticket or start a session.",
  REPO_CHOICE_REQUIRED: 'Choose the repo this session should run in.',
  SOURCE_ALREADY_CONNECTED: 'This source is already connected to the workspace.',
  BUILT_IN_SOURCE_FIXED: "The built-in tracker can't be changed or disconnected.",
  BUILT_IN_CREATION_OFF:
    'New built-in tickets are off while a ticket source is connected. Create the ticket in that tracker.',
  NO_LINKED_REPO: 'Link a repo to this workspace before starting a session.',
};

export function errorText(error: unknown): string {
  if (error instanceof ApiRequestError && error.code !== 'UNKNOWN') {
    return CODE_MESSAGES[error.code] ?? error.message;
  }
  return error instanceof Error ? error.message : 'Something went wrong.';
}

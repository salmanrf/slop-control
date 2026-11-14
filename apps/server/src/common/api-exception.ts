import { HttpException } from '@nestjs/common';
import type { ApiErrorCode } from '@slop-control/shared';

/** An error the API reports to its caller; the body is always an `ApiError`. */
export class ApiException extends HttpException {
  constructor(status: number, code: ApiErrorCode, message: string) {
    super({ code, message }, status);
  }
}

export const notFound = (message = 'Not found.') => new ApiException(404, 'NOT_FOUND', message);

export const validationFailed = (message: string) =>
  new ApiException(422, 'VALIDATION_FAILED', message);

export const secretsNotConfigured = (
  message = "The server has no secret key, so it can't store credentials. Set SLOP_SECRET_KEY in apps/server/.env (for example with `openssl rand -base64 32`) and restart.",
) => new ApiException(503, 'SECRETS_NOT_CONFIGURED', message);

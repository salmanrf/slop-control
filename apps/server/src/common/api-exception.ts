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

import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { ApiError } from '@slop-control/shared';
import type { Response } from 'express';
import { ApiException } from './api-exception';
import { Redactor } from './redactor';

/** Makes every error body an `ApiError`, and keeps unexpected details out of responses. */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Api');

  constructor(private readonly redactor: Redactor) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (response.headersSent) {
      response.end();
      return;
    }

    if (exception instanceof ApiException) {
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }
    if (exception instanceof HttpException && exception.getStatus() === 404) {
      const body: ApiError = { code: 'NOT_FOUND', message: 'Not found.' };
      response.status(404).json(body);
      return;
    }
    if (exception instanceof HttpException && exception.getStatus() < 500) {
      const body: ApiError = { code: 'VALIDATION_FAILED', message: exception.message };
      response.status(422).json(body);
      return;
    }

    const detail =
      exception instanceof Error ? (exception.stack ?? exception.message) : `${exception}`;
    this.logger.error(this.redactor.redact(detail));
    const body: ApiError = {
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong on the server.',
    };
    response.status(500).json(body);
  }
}

import { Injectable } from '@nestjs/common';
import { AppConfig } from '../config';

/**
 * Replaces known secret values in text bound for storage or logs (NFR-4).
 * This is a second line of defense: secrets are already kept out of the session's environment.
 */
@Injectable()
export class Redactor {
  private readonly secrets: string[];

  constructor(config: AppConfig) {
    this.secrets = [config.githubToken, config.jwt.kind === 'secret' ? config.jwt.secret : ''].filter(
      (secret) => secret.length > 0,
    );
  }

  redact(text: string): string {
    return this.secrets.reduce((result, secret) => result.split(secret).join('[REDACTED]'), text);
  }
}

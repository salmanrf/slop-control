import { Inject, Injectable } from '@nestjs/common';
import { AppConfig } from '../config';

/**
 * Replaces known secret values in text bound for storage or logs (NFR-4).
 * This is a second line of defense: secrets are already kept out of the session's environment.
 */
@Injectable()
export class Redactor {
  private readonly secrets = new Set<string>();

  constructor(@Inject(AppConfig) config: Pick<AppConfig, 'jwt' | 'secretKey'>) {
    if (config.jwt.kind === 'secret') this.add(config.jwt.secret);
    if (config.secretKey) this.add(config.secretKey);
  }

  /**
   * @params secret: a value to hide from now on
   * @return nothing
   * Adds a secret to the set that `redact` replaces. A blank value is ignored.
   */
  add(secret: string): void {
    if (secret.trim().length > 0) this.secrets.add(secret);
  }

  /**
   * @params text: text bound for storage or logs
   * @return the text with known secrets replaced
   * Replaces known secret values, as a second line of defense (NFR-4).
   */
  redact(text: string): string {
    let result = text;
    for (const secret of this.secrets) result = result.split(secret).join('[REDACTED]');
    return result;
  }

  /** Whether a value, such as an environment variable's, contains a known secret. */
  holdsSecret(value: string): boolean {
    for (const secret of this.secrets) if (value.includes(secret)) return true;
    return false;
  }
}

import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { ApiException } from '../common/api-exception';
import { AppConfig } from '../config';

/** Applied globally: every route, including the status stream, needs a valid Supabase JWT. */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly key: Uint8Array | JWTVerifyGetKey;

  constructor(private readonly config: AppConfig) {
    this.key =
      config.jwt.kind === 'secret'
        ? new TextEncoder().encode(config.jwt.secret)
        : createRemoteJWKSet(new URL(config.jwt.url));
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const header = context.switchToHttp().getRequest<Request>().headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
    if (!token) throw this.unauthenticated();

    try {
      const options = { audience: this.config.jwtAudience };
      // The two overloads differ only in the key's type.
      if (typeof this.key === 'function') await jwtVerify(token, this.key, options);
      else await jwtVerify(token, this.key, options);
      return true;
    } catch {
      throw this.unauthenticated();
    }
  }

  private unauthenticated(): ApiException {
    return new ApiException(401, 'UNAUTHENTICATED', 'Sign in again to continue.');
  }
}

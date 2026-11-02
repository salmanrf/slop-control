import { Injectable, OnModuleDestroy } from '@nestjs/common';
import type { Session } from '@slop-control/shared';
import type { Response } from 'express';
import { ApiException } from '../common/api-exception';
import { AppConfig } from '../config';

/**
 * Pushes session changes to connected browsers. In-process, since one Nest process owns all
 * sessions (ADR-0001). Status is current state rather than a log, so nothing is replayed: a client
 * subscribes first and then refetches, so a change made in between can't be missed.
 */
@Injectable()
export class SessionUpdates implements OnModuleDestroy {
  private readonly clients = new Map<Response, string>();
  private readonly closers = new Set<() => void>();
  private closing = false;

  constructor(private readonly config: AppConfig) {}

  /** Call only after the change is saved, so anything a client sees is durable. */
  publish(session: Session): void {
    const frame = `event: session_updated\ndata: ${JSON.stringify(session)}\n\n`;
    for (const [response, workspaceId] of this.clients) {
      if (workspaceId === session.workspaceId) response.write(frame);
    }
  }

  /** Holds a response open as this workspace's stream until the client or the server closes it. */
  attach(workspaceId: string, response: Response): void {
    // A stream opened now would never be closed, and would keep the process from exiting.
    if (this.closing) {
      throw new ApiException(503, 'INTERNAL_ERROR', 'The server is shutting down.');
    }
    this.clients.set(response, workspaceId);
    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    response.write(': connected\n\n');

    const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), this.config.heartbeatMs);
    const close = () => {
      clearInterval(heartbeat);
      this.clients.delete(response);
      this.closers.delete(close);
      response.end();
    };
    this.closers.add(close);
    response.on('close', close);
  }

  onModuleDestroy(): void {
    this.closing = true;
    for (const close of [...this.closers]) close();
  }
}

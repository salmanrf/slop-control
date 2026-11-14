import { Injectable, OnModuleDestroy } from '@nestjs/common';
import type { DraftedAction, Session } from '@slop-control/shared';
import type { Response } from 'express';
import { ApiException } from '../common/api-exception';
import { AppConfig } from '../config';

/**
 * Pushes session and drafted action changes to connected browsers. In-process, since one Nest process owns all
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
    this.send(session.workspaceId, 'session_updated', session);
  }

  /** Sent after every saved change to a drafted action, carrying the full action. */
  publishAction(action: DraftedAction): void {
    this.send(action.workspaceId, 'drafted_action_updated', action);
  }

  private send(workspaceId: string, event: string, data: unknown): void {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const [response, clientWorkspaceId] of this.clients) {
      if (clientWorkspaceId === workspaceId) response.write(frame);
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
    this.close();
  }

  /** Ends every stream and refuses new ones. Safe to call more than once. */
  close(): void {
    this.closing = true;
    for (const close of [...this.closers]) close();
  }
}

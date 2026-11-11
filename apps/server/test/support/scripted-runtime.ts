import type {
  RuntimeEvent,
  RuntimeHandle,
  RuntimeReadiness,
  RuntimeResumeInput,
  RuntimeSetup,
  RuntimeStartInput,
} from '@slop-control/shared';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { SessionRuntime } from '../../src/sessions/runtime';

/**
 * Markers the browser run puts in a ticket's body, or in a follow-up message, to reach every
 * session state without Claude Code. A start reads them from the brief, which holds the ticket's
 * body; a resume reads them from the message only.
 */
export const MARKERS = {
  /** The round ends with an error. */
  fail: '[e2e:fail]',
  /** The round ends normally without writing the required artifact. */
  noArtifact: '[e2e:no-artifact]',
  /** The round writes a file outside `.slop/` and leaves it uncommitted. */
  changeCode: '[e2e:change-code]',
  /** The round reports its start and then runs until it is stopped. */
  keepRunning: '[e2e:keep-running]',
} as const;

const ARTIFACT_IN_BRIEF = /`(\.slop\/(?!context\/)[A-Za-z0-9._-]+\.md)`/;
const FALLBACK_ARTIFACT = '.slop/result.md';

/**
 * Stands in for Claude Code in the browser run: reports a start, writes the phase's required
 * artifact, and ends. It makes no request to Anthropic and uses no quota. Only the test-only
 * entry point wires it in, so the production build can't select it.
 */
export class ScriptedRuntime extends SessionRuntime {
  /** A resume gets no brief, so the artifact path is remembered from the start. */
  private readonly artifactPaths = new Map<string, string>();
  private readonly rounds = new Map<string, number>();

  constructor(private readonly stepMs = Number(process.env.E2E_STEP_MS ?? 400)) {
    super();
  }

  async checkReady(): Promise<RuntimeReadiness> {
    return { ready: true };
  }

  start(input: RuntimeStartInput): RuntimeHandle {
    const runtimeSessionId = randomUUID();
    this.artifactPaths.set(
      runtimeSessionId,
      ARTIFACT_IN_BRIEF.exec(input.brief)?.[1] ?? FALLBACK_ARTIFACT,
    );
    return this.round(runtimeSessionId, input.cwd, input.setup, input.brief);
  }

  resume(input: RuntimeResumeInput): RuntimeHandle {
    return this.round(input.runtimeSessionId, input.cwd, input.setup, input.message);
  }

  async terminateLeftovers(): Promise<void> {
    // Nothing runs outside this process.
  }

  private round(
    runtimeSessionId: string,
    cwd: string,
    setup: RuntimeSetup,
    script: string,
  ): RuntimeHandle {
    const round = (this.rounds.get(runtimeSessionId) ?? 0) + 1;
    this.rounds.set(runtimeSessionId, round);
    const artifactPath = this.artifactPaths.get(runtimeSessionId) ?? FALLBACK_ARTIFACT;

    let stop: () => void = () => undefined;
    const stopped = new Promise<'stopped'>((resolve) => (stop = () => resolve('stopped')));
    const pause = () =>
      Promise.race([new Promise<'done'>((r) => setTimeout(() => r('done'), this.stepMs)), stopped]);

    async function* events(): AsyncGenerator<RuntimeEvent> {
      const ended = (outcome: 'success' | 'error' | 'stopped', message: string | null = null) =>
        ({ type: 'session_ended', outcome, message }) satisfies RuntimeEvent;

      if ((await pause()) === 'stopped') return yield ended('stopped');
      yield { type: 'session_started', runtimeSessionId, transcriptPath: null };

      if (script.includes(MARKERS.keepRunning)) {
        await stopped;
        return yield ended('stopped');
      }
      if ((await pause()) === 'stopped') return yield ended('stopped');
      if (script.includes(MARKERS.fail)) return yield ended('error', 'The scripted run failed.');

      if (script.includes(MARKERS.changeCode)) write(cwd, 'e2e-change.txt', `round ${round}\n`);
      if (setup.scope.mayChangeCode) {
        write(cwd, 'e2e-work.txt', `work from round ${round}\n`);
        commitAll(cwd, `Scripted work, round ${round}`);
      }
      if (!script.includes(MARKERS.noArtifact)) {
        write(
          cwd,
          artifactPath,
          `# Scripted result\n\nRound ${round} wrote \`${artifactPath}\`.\n`,
        );
      }
      yield ended('success');
    }

    return { events: events(), stop: async () => stop() };
  }
}

function write(cwd: string, relativePath: string, content: string): void {
  const target = join(cwd, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function commitAll(cwd: string, message: string): void {
  const identity = ['-c', 'user.name=slop-e2e', '-c', 'user.email=slop-e2e@example.invalid'];
  execFileSync('git', ['add', '-A'], { cwd });
  execFileSync('git', [...identity, 'commit', '-qm', message], { cwd });
}

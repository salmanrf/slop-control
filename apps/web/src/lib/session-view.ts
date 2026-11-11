import type { LaunchablePhase, Phase, ScopeFlag, Session } from '@slop-control/shared';

export const PHASES: Phase[] = [
  'investigation',
  'planning',
  'implementation',
  'automated_testing',
  'e2e_testing',
  'code_review',
];

export const LAUNCHABLE_PHASES: LaunchablePhase[] = [
  'investigation',
  'planning',
  'implementation',
  'code_review',
];

const PHASE_LABELS: Record<Phase, string> = {
  investigation: 'Investigation',
  planning: 'Planning',
  implementation: 'Implementation',
  automated_testing: 'Automated testing',
  e2e_testing: 'E2E testing',
  code_review: 'Code review',
};

export const phaseLabel = (phase: Phase) => PHASE_LABELS[phase];

/** The default paths, for a phase with no session to read its setup from. Display only. */
const DEFAULT_ARTIFACTS: Record<LaunchablePhase, string> = {
  investigation: '.slop/investigation.md',
  planning: '.slop/plan.md',
  implementation: '.slop/implementation-report.md',
  code_review: '.slop/review-report.md',
};

export function requiredArtifact(phase: Phase): string | null {
  return (DEFAULT_ARTIFACTS as Partial<Record<Phase, string>>)[phase] ?? null;
}

/** The path this session was told to write, from the setup it started with. */
export function sessionArtifactPath(session: Session): string | null {
  return session.setup?.stopCondition.requiredArtifactPath ?? requiredArtifact(session.phase);
}

function requiredArtifactName(session: Session): string {
  return sessionArtifactPath(session)?.replace('.slop/', '') ?? 'artifact';
}

/** Round 1 is the session itself, so only later rounds are named. */
export function roundLabel(session: Pick<Session, 'round'>): string | null {
  return session.round > 1 ? `Round ${session.round}` : null;
}

const SCOPE_FLAG_LABELS: Record<ScopeFlag, string> = {
  code_changed: 'Changed code in a read-only phase',
};

/** Null when the session stayed within its scope. */
export function scopeFlagLabel(flags: ScopeFlag[] | undefined): string | null {
  const labels = (flags ?? []).map((flag) => SCOPE_FLAG_LABELS[flag]).filter(Boolean);
  return labels.length > 0 ? labels.join(' · ') : null;
}

export interface ResultWording {
  label: string;
  tone: Tone;
  /** True when an earlier round's stored copy is still there to read. */
  earlierResult: boolean;
  detail: string | null;
}

/**
 * How the latest round's result reads. A later round that didn't change the artifact is
 * incomplete, and the copy an earlier round stored is still offered.
 * @params storedRound: the round of the latest stored artifact, or null with none stored
 */
export function resultWording(session: Session, storedRound: number | null): ResultWording | null {
  if (session.artifactStatus === null) return null;
  if (session.artifactStatus === 'complete') {
    const round = roundLabel(session);
    return {
      label: round ? `Result complete · ${round.toLowerCase()}` : 'Result complete',
      tone: 'ok',
      earlierResult: false,
      detail: null,
    };
  }
  const name = requiredArtifactName(session);
  if (session.round > 1 && storedRound !== null) {
    return {
      label: `Result incomplete · round ${session.round} wrote nothing new`,
      tone: 'warn',
      earlierResult: true,
      detail: `Round ${session.round} didn't change ${name}. The copy from round ${storedRound} is shown below.`,
    };
  }
  return {
    label: 'Result incomplete',
    tone: 'warn',
    earlierResult: false,
    detail: `This session didn't produce ${name}.`,
  };
}

export type FollowUpAction = 'follow_up' | 'continue' | 'none' | 'not_resumable';

/**
 * What the dashboard offers for continuing a session: nothing while a round runs, a follow-up
 * once it has ended, Continue when it also missed its artifact, and a note when Claude Code
 * never started it, since there is then nothing to resume.
 */
export function followUpAction(session: Session): FollowUpAction {
  if (isActive(session)) return 'none';
  if (!session.runtimeSessionId) return 'not_resumable';
  return session.artifactStatus === 'incomplete' ? 'continue' : 'follow_up';
}

/** The message Continue starts from; the developer can change it before sending. */
export function continueMessage(session: Session): string {
  const path = sessionArtifactPath(session);
  return path
    ? `You ended without writing the required artifact. Finish the work for this phase and write it as markdown to \`${path}\`.`
    : 'You ended before finishing. Continue the work for this phase.';
}

export const isActive = (session: Session) =>
  session.status === 'starting' || session.status === 'running';

const STATUS_ORDER: Record<Session['status'], number> = {
  starting: 0,
  running: 1,
  ended: 2,
  failed: 2,
  stopped: 2,
};

/**
 * @params incoming: a state of a session just received; cached: the state of the same session already held
 * @return true when `incoming` is from an earlier round, or from the same round at an earlier status
 * Orders two states of one session. `ended`, `failed`, and `stopped` count as the same position.
 */
export function isOlderSession(
  incoming: Pick<Session, 'round' | 'status'>,
  cached: Pick<Session, 'round' | 'status'>,
): boolean {
  if (incoming.round !== cached.round) return incoming.round < cached.round;
  return STATUS_ORDER[incoming.status] < STATUS_ORDER[cached.status];
}

export type PhaseState = 'done' | 'running' | 'incomplete' | 'idle';

/** What a ticket's sessions add up to for one phase; a produced artifact outranks a later miss. */
export function phaseState(sessions: Session[], phase: Phase): PhaseState {
  const inPhase = sessions.filter((session) => session.phase === phase);
  if (inPhase.some(isActive)) return 'running';
  if (inPhase.some((session) => session.artifactStatus === 'complete')) return 'done';
  return inPhase.length > 0 ? 'incomplete' : 'idle';
}

export type Tone = 'ok' | 'warn' | 'danger' | 'neutral';

export interface SessionOutcome {
  label: string;
  tone: Tone;
}

/** One line for a session. Status and artifact are separate facts, so both inform the wording. */
export function sessionOutcome(session: Session): SessionOutcome {
  switch (session.status) {
    case 'starting':
      return { label: 'Starting', tone: 'ok' };
    case 'running':
      return { label: 'Running', tone: 'ok' };
    case 'failed':
      return { label: 'Failed', tone: 'danger' };
    case 'stopped':
      return { label: 'Stopped', tone: 'neutral' };
    case 'ended':
      return session.artifactStatus === 'complete'
        ? { label: `Complete · ${requiredArtifactName(session)}`, tone: 'ok' }
        : session.round > 1
          ? { label: `Incomplete · round ${session.round} wrote nothing new`, tone: 'warn' }
          : { label: `Incomplete · no ${requiredArtifactName(session)}`, tone: 'warn' };
  }
}

const STATUS_LABELS: Record<Session['status'], string> = {
  starting: 'Starting',
  running: 'Running',
  ended: 'Ended',
  failed: 'Failed',
  stopped: 'Stopped',
};

export const statusLabel = (session: Session) => STATUS_LABELS[session.status];

export type TimelineState = 'done' | 'current' | 'pending' | 'warn' | 'danger';

export interface TimelineStep {
  title: string;
  /** Null for a step the session has no recorded time for. */
  at: string | null;
  detail: string;
  state: TimelineState;
}

/** The session's lifecycle as far as its record shows. Only start and end times are stored. */
export function sessionTimeline(session: Session, now: number = Date.now()): TimelineStep[] {
  const started = session.runtimeSessionId !== null;
  const steps: TimelineStep[] = [
    {
      title: 'Starting',
      at: session.startedAt,
      detail: `Session created · worktree ${baseName(session.worktreePath)}`,
      state: session.status === 'starting' ? 'current' : 'done',
    },
  ];
  if (started) {
    steps.push({
      title: 'Running',
      at: null,
      detail: `Runtime reported session id ${shortId(session.runtimeSessionId ?? '')}`,
      state: 'done',
    });
  }

  if (isActive(session)) {
    if (session.status === 'running') {
      steps.push({
        title: `Still running · ${formatDuration(session.startedAt, null, now)}`,
        at: null,
        detail:
          'The agent works unattended. Its messages and tool calls are not forwarded here; the transcript on disk is the full record.',
        state: 'current',
      });
    }
    steps.push({
      title: 'Ended · Failed · Stopped',
      at: null,
      detail:
        'Then the required artifact is checked and the session is marked complete or incomplete.',
      state: 'pending',
    });
    return steps;
  }

  const endDetails: Record<'ended' | 'failed' | 'stopped', string> = {
    ended: 'Runtime finished normally',
    failed: session.statusReason ?? 'The runtime stopped unexpectedly',
    stopped: 'Stopped by you',
  };
  steps.push({
    title: statusLabel(session),
    at: session.endedAt,
    detail: endDetails[session.status as keyof typeof endDetails],
    state: session.status === 'failed' ? 'danger' : 'done',
  });
  steps.push(
    session.artifactStatus === 'complete'
      ? {
          title: 'Result complete',
          at: null,
          detail: `${requiredArtifactName(session)} found and stored`,
          state: 'done',
        }
      : {
          title: 'Result incomplete',
          at: null,
          detail: `${requiredArtifactName(session)} was not produced`,
          state: 'warn',
        },
  );
  return steps;
}

export const shortId = (id: string) => id.slice(0, 8);

function baseName(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path;
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters =
    words.length > 1
      ? `${words[0]?.[0] ?? ''}${words[1]?.[0] ?? ''}`
      : (words[0]?.slice(0, 2) ?? '');
  return letters.toUpperCase();
}

export function formatDuration(
  start: string,
  end: string | null,
  now: number = Date.now(),
): string {
  const endMs = end ? new Date(end).getTime() : now;
  const minutes = Math.floor(Math.max(0, endMs - new Date(start).getTime()) / 60_000);
  if (minutes < 1) return 'under 1 min';
  if (minutes < 60) return `${minutes} min`;
  const remainder = minutes % 60;
  return remainder === 0
    ? `${Math.floor(minutes / 60)} h`
    : `${Math.floor(minutes / 60)} h ${remainder} m`;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** "Today 11:02", "Yesterday 18:20", "Mon 14:10", or a date once it's over a week old. */
export function formatMoment(value: string, now: number = Date.now()): string {
  const date = new Date(value);
  const time = date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - day.getTime()) / (24 * 60 * 60 * 1000));

  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Yesterday ${time}`;
  if (days > 1 && today.getTime() - day.getTime() < WEEK_MS) {
    return `${date.toLocaleDateString(undefined, { weekday: 'short' })} ${time}`;
  }
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatClock(value: string): string {
  return new Date(value).toLocaleTimeString(undefined, { hour12: false });
}

/** Finds a command written as `code` in a server message, so it can be shown ready to copy. */
export function commandInMessage(message: string): string | null {
  return /`([^`]+)`/.exec(message)?.[1] ?? null;
}

import type { LaunchablePhase, Phase, Ticket } from '@slop-control/shared';

interface PhaseDefinition {
  /** Required artifact, relative to the worktree root (A-7). */
  artifactPath: string;
  instruction: string;
}

const PHASES: Record<LaunchablePhase, PhaseDefinition> = {
  investigation: {
    artifactPath: '.slop/investigation.md',
    instruction:
      'Investigate this ticket without changing code, and write your findings as markdown to `.slop/investigation.md`.',
  },
  planning: {
    artifactPath: '.slop/plan.md',
    instruction:
      'Plan the work for this ticket without changing code, and write the plan as markdown to `.slop/plan.md`.',
  },
  implementation: {
    artifactPath: '.slop/implementation-report.md',
    instruction:
      'Implement this ticket, commit your work, and write a report as markdown to `.slop/implementation-report.md`.',
  },
  code_review: {
    artifactPath: '.slop/review-report.md',
    instruction:
      'Review the code for this ticket without changing it, and write your review as markdown to `.slop/review-report.md`.',
  },
};

export function isLaunchablePhase(phase: unknown): phase is LaunchablePhase {
  return typeof phase === 'string' && Object.hasOwn(PHASES, phase);
}

/** The path comes from the phase, never from the client. Null for phases with no artifact yet. */
export function requiredArtifactPath(phase: Phase): string | null {
  return isLaunchablePhase(phase) ? PHASES[phase].artifactPath : null;
}

export function buildBrief(ticket: Ticket, phase: LaunchablePhase): string {
  return `${ticket.title}\n\n${ticket.body}\n\n${PHASES[phase].instruction}`;
}

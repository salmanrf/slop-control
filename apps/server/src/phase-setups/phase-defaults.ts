import type { LaunchablePhase, SessionSetup } from '@slop-control/shared';

/** The default order (FR-15), without the testing phases, which can't be launched yet. */
export const LAUNCHABLE_PHASES: readonly LaunchablePhase[] = [
  'investigation',
  'planning',
  'implementation',
  'code_review',
];

export const PHASE_LABELS: Record<LaunchablePhase, string> = {
  investigation: 'Investigation',
  planning: 'Planning',
  implementation: 'Implementation',
  code_review: 'Code review',
};

/**
 * What a new workspace's phase setups start as. The phase setups migration holds the same values
 * for workspaces that already existed.
 */
export const DEFAULT_PHASE_SETUPS: Record<LaunchablePhase, SessionSetup> = {
  investigation: {
    instruction:
      'Investigate this ticket without changing code, and write your findings as markdown to `.slop/investigation.md`.',
    scope: { mayChangeCode: false },
    stopCondition: { requiredArtifactPath: '.slop/investigation.md' },
    userLevelSource: false,
  },
  planning: {
    instruction:
      'Plan the work for this ticket without changing code, and write the plan as markdown to `.slop/plan.md`.',
    scope: { mayChangeCode: false },
    stopCondition: { requiredArtifactPath: '.slop/plan.md' },
    userLevelSource: false,
  },
  implementation: {
    instruction:
      'Implement this ticket, commit your work, and write a report as markdown to `.slop/implementation-report.md`.',
    scope: { mayChangeCode: true },
    stopCondition: { requiredArtifactPath: '.slop/implementation-report.md' },
    userLevelSource: false,
  },
  code_review: {
    instruction:
      'Review the code for this ticket without changing it, and write your review as markdown to `.slop/review-report.md`.',
    scope: { mayChangeCode: false },
    stopCondition: { requiredArtifactPath: '.slop/review-report.md' },
    userLevelSource: false,
  },
};

export function isLaunchablePhase(phase: unknown): phase is LaunchablePhase {
  return typeof phase === 'string' && (LAUNCHABLE_PHASES as readonly string[]).includes(phase);
}

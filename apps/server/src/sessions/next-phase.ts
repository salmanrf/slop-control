import type { LaunchablePhase, NextPhaseSuggestion, Session } from '@slop-control/shared';
import { LAUNCHABLE_PHASES, PHASE_LABELS } from '../phase-setups/phase-defaults';

/**
 * @params sessions: all of one ticket's sessions
 * @return the phase to suggest and why, with a null phase once code review is done
 * Applies the default order, skipping phases that can't be launched. Pure: reads nothing else.
 */
export function suggestNextPhase(
  sessions: Pick<Session, 'phase' | 'artifactStatus'>[],
): NextPhaseSuggestion {
  const isDone = (phase: LaunchablePhase) =>
    sessions.some((session) => session.phase === phase && session.artifactStatus === 'complete');
  // The furthest done phase decides, so a skipped phase or a later rerun doesn't move the ticket back.
  const furthest = LAUNCHABLE_PHASES.findLastIndex(isDone);

  if (furthest === -1) {
    return {
      phase: 'investigation',
      reason: 'No phase is complete yet, so start with investigation.',
    };
  }
  const done = PHASE_LABELS[LAUNCHABLE_PHASES[furthest]!];
  const next = LAUNCHABLE_PHASES[furthest + 1];
  if (!next) return { phase: null, reason: `${done} is complete, so no phase is suggested.` };
  return { phase: next, reason: `${done} is complete.` };
}

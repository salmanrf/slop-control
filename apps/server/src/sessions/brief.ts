import type { InputArtifact, SessionSetup } from '@slop-control/shared';
import { PHASE_LABELS } from '../phase-setups/phase-defaults';

/** The same in every phase, so the agent doesn't waste turns on what the baseline scope blocks. */
export const BASELINE_SCOPE_SENTENCE =
  "This session can't push, use `gh`, open SSH connections, or reach GitHub in any other way. Don't try to: anything that needs to happen outside this repo belongs in your report.";

export interface BriefInput {
  ticket: { title: string; body: string };
  setup: SessionSetup;
  inputArtifacts: InputArtifact[];
  /** The branch a code review starts from, and the ref to compare it against; null otherwise. */
  review: { branch: string; compareRef: string } | null;
}

/** Earlier artifacts are named by path and not included, so the stored brief stays short. */
export function buildBrief({ ticket, setup, inputArtifacts, review }: BriefInput): string {
  const parts = [ticket.title, ticket.body, setup.instruction, BASELINE_SCOPE_SENTENCE];
  if (inputArtifacts.length > 0) {
    const files = inputArtifacts.map(
      (artifact) => `- \`${artifact.path}\` (${PHASE_LABELS[artifact.phase].toLowerCase()})`,
    );
    parts.push(
      `Earlier results for this ticket are in these files. Read them when you need them:\n${files.join('\n')}`,
    );
  }
  if (review) {
    parts.push(
      `This worktree starts from the implementation branch \`${review.branch}\`. Compare it against \`${review.compareRef}\` to review only this ticket's changes.`,
    );
  }
  return parts.join('\n\n');
}

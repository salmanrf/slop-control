import type { SourceListStatus, TicketSource, TicketSummary } from '@slop-control/shared';

/**
 * Joins pages of the merged list. A ticket that changed between two pages can come back again,
 * so repeats are dropped by source and key, keeping the first one seen.
 */
export function mergeTicketPages(pages: TicketSummary[][]): TicketSummary[] {
  const seen = new Set<string>();
  const merged: TicketSummary[] = [];
  for (const ticket of pages.flat()) {
    const id = `${ticket.sourceId}\u0000${ticket.key}`;
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push(ticket);
  }
  return merged;
}

export interface SourceProblem {
  sourceId: string;
  label: string;
  kind: 'auth_failed' | 'unavailable';
  message: string;
}

/** One entry per failing source, so a bad token on one tracker doesn't hide the others. */
export function sourceProblems(
  statuses: SourceListStatus[],
  sources: TicketSource[],
): SourceProblem[] {
  const problems = new Map<string, SourceProblem>();
  for (const status of statuses) {
    if (status.state === 'ok') continue;
    const label = sources.find((source) => source.id === status.sourceId)?.label ?? 'A source';
    const fallback =
      status.state === 'auth_failed'
        ? 'The tracker rejected the credential.'
        : "The tracker couldn't be reached.";
    problems.set(status.sourceId, {
      sourceId: status.sourceId,
      label,
      kind: status.state,
      message:
        status.state === 'auth_failed'
          ? `${label}: sign-in failed. ${status.message ?? fallback}`
          : `${label}: unavailable. ${status.message ?? fallback}`,
    });
  }
  return [...problems.values()];
}

/** Labels of the sources that listed everyone's tickets although "assigned to me" was asked for. */
export function sourcesNotLimitedToMe(
  statuses: SourceListStatus[],
  sources: TicketSource[],
): string[] {
  const ids = new Set(
    statuses
      .filter((status) => status.state === 'ok' && !status.mineApplied)
      .map((s) => s.sourceId),
  );
  return sources.filter((source) => ids.has(source.id)).map((source) => source.label);
}

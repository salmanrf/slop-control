import type {
  DraftedActionType,
  LinkedRepo,
  OpenPrPayload,
  Session,
  TicketCommentPayload,
  TicketSource,
} from '@slop-control/shared';
import { validationFailed } from '../common/api-exception';

/** The status a ticket moves to once its PR is open, where its tracker has one by this name. */
export const IN_REVIEW = 'in review';

const EDITABLE: Record<DraftedActionType, string[]> = {
  open_pr: ['title', 'body'],
  ticket_comment: ['body'],
  ticket_transition: ['toStatus'],
};

/**
 * @params session: an implementation session; report: its implementation report; source: the ticket's source; repo: the session's linked repo
 * @return the pull request as the workspace drafts it
 * A template, with no model call (FR-28a): the ticket's title, the report, and a line that leads back to the ticket.
 */
export function draftOpenPr(
  session: Session,
  report: string,
  source: TicketSource,
  repo: LinkedRepo,
): OpenPrPayload {
  return {
    title: session.ticketTitle,
    body: `${report.trimEnd()}\n\n${ticketReference(source, session.ticketKey, repo)}\n`,
    baseBranch: repo.defaultBranch,
    headBranch: session.branch,
  };
}

export function draftTicketComment(report: string): TicketCommentPayload {
  return { body: report.trimEnd() };
}

/**
 * `Refs`, not `Closes`: closing an issue on merge is an outward-facing effect nobody approved.
 * An issue in the PR's own repo is `#12`; one elsewhere is `owner/repo#12`, which GitHub links too.
 * A built-in ticket has no page, so its key is all there is.
 */
function ticketReference(source: TicketSource, ticketKey: string, repo: LinkedRepo): string {
  if (source.type !== 'github_issues') return `Ticket: ${ticketKey}`;
  const [repoName, number] = ticketKey.split('#');
  const sameRepo =
    repoName?.toLowerCase() === `${repo.githubOwner}/${repo.githubRepo}`.toLowerCase();
  return sameRepo && number ? `Refs #${number}` : `Refs ${ticketKey}`;
}

/**
 * @params type: the action's type; payload: its stored payload; body: the fields the developer sent
 * @return the payload with those fields changed, or throws VALIDATION_FAILED for a blank value or a field the type doesn't let the developer change
 * Applies an edit. The base and head of a pull request are never among the editable fields.
 */
export function applyEdit<T extends object>(type: DraftedActionType, payload: T, body: unknown): T {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw validationFailed('Send the fields to change.');
  }
  const editable = EDITABLE[type];
  const changes = Object.entries(body);
  if (changes.length === 0) throw validationFailed('Send the fields to change.');
  const edited: Record<string, unknown> = { ...(payload as Record<string, unknown>) };
  for (const [field, value] of changes) {
    if (!editable.includes(field)) {
      throw validationFailed(
        `"${field}" can't be changed on this action. It takes: ${editable.join(', ')}.`,
      );
    }
    if (typeof value !== 'string' || value.trim().length === 0 || value.includes('\u0000')) {
      throw validationFailed(`"${field}" can't be blank.`);
    }
    edited[field] = field === 'body' ? value : value.trim();
  }
  return edited as T;
}

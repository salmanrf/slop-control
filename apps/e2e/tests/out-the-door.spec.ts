import { expect, test, type Locator, type Page } from '@playwright/test';
import { gitOutput, makeClone, makeRemote } from '../support/clone';
import { GITHUB_STUB_URL, PR_REPO, STUB_LOGIN } from '../support/env';
import { readRunUser } from '../support/user';

/**
 * The demo script's steps 2 to 7 for Sprint 3 (S3-11), in order, in one signed-in page: a
 * credential, a drafted pull request, its diff, approving and rejecting, and a rejected token.
 * It runs after `demo.spec.ts`, in a workspace of its own with no connected source, so its
 * tickets are built-in ones. Pushes go to a local bare repo, and the pull requests to the stub.
 *
 * The markers are the scripted runtime's (`apps/server/test/support/scripted-runtime.ts`).
 */
const MARKERS = {
  commit: '[e2e:commit]',
  noCommit: '[e2e:no-commit]',
  uncommitted: '[e2e:uncommitted]',
};

const REPO_LABEL = `${PR_REPO.owner}/${PR_REPO.repo}`;
/** Not real tokens. The stub takes any, and the pages must never show either again. */
const WORKSPACE_TOKEN = 'e2e-workspace-token-4f1c9a27d3';
const SOURCE_TOKEN = 'e2e-source-token-8b02e6c5a1';

const PR_TICKET = 'Export the list as CSV';
const FAILING_TICKET = 'Export the list as JSON';
const EDITED_TITLE = 'CSV export, as reviewed';
const EDITED_BODY = 'Adds the CSV export.\n\nReworded before approval.\n\nTicket: T-1';
/** What two rounds leave on the branch, the second with the commit marker: the README rewritten, and one new file. */
const DIFF_SUMMARY = '2 files changed · +2 −1 · 2 commits';

interface StubPull {
  number: number;
  repo: string;
  title: string;
  body: string;
  head: string;
  base: string;
  html_url: string;
}

interface StubState {
  pulls: StubPull[];
  comments: { repo: string; issue: number; body: string }[];
  writes: { method: string; path: string; body: unknown }[];
  rejectTokens: boolean;
}

test.describe.configure({ mode: 'serial' });

let page: Page;
let workspaceUrl: string;
/** The linked clone, and the bare repo its pushes go to. */
let clone: string;
let remote: string;
let prTicketUrl: string;
let prSessionUrl: string;
let prActionId: string;
/** The first eight characters of the head commit the open PR action showed before approval. */
let shownHead: string;
let failingActionId: string;
/** Full page loads, to show a view changed without one. */
let loads = 0;
let loadsBeforeDraft = 0;
/** Every URL the browser asked for, to show the run never left this machine (BR-35). */
const requested: string[] = [];

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  page.on('request', (request) => requested.push(request.url()));
  page.on('load', () => (loads += 1));
});

test.afterAll(async () => {
  // Left on by a failed case, it would fail whatever uses the stub next.
  await rejectTokens(false);
  await page.close();
});

async function stubState(): Promise<StubState> {
  return (await (await fetch(`${GITHUB_STUB_URL}/__stub/state`)).json()) as StubState;
}

/** Tells the stub to answer every request that carries a token with a 401, or to stop. */
async function rejectTokens(reject: boolean): Promise<void> {
  await fetch(`${GITHUB_STUB_URL}/__stub/reject-token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reject }),
  });
}

/** The branches the bare repo holds. */
function remoteBranches(): string[] {
  return gitOutput(remote, 'for-each-ref', '--format=%(refname:short)', 'refs/heads')
    .split('\n')
    .filter(Boolean)
    .sort();
}

const mainNav = () => page.getByRole('navigation', { name: 'Main' });
const approvalsCount = () => mainNav().getByTestId('approvals-count');
const inbox = () => page.getByRole('list', { name: 'Actions waiting for approval' });
const nextSession = () => page.getByRole('region', { name: 'Next session' });
const beforeLaunch = () => page.getByRole('region', { name: 'Before launch' });
const sessionCards = () => page.getByRole('region', { name: 'Sessions' }).getByRole('article');
/** A drafted action's card on its session page, by its type's label. */
const actionCard = (type: 'Open PR' | 'Ticket comment' | 'Status change') =>
  page.getByRole('article', { name: `${type} action` });
const credentialPanel = () => page.getByRole('region', { name: 'GitHub credential' });
const credentialState = () => credentialPanel().getByTestId('github-credential-state');

async function openTickets(): Promise<void> {
  await page.goto(workspaceUrl);
  await expect(page.getByRole('heading', { name: 'Tickets', level: 1 })).toBeVisible();
}

/** Opens the inbox from the navigation, without a page load. */
async function openInbox(): Promise<void> {
  await mainNav()
    .getByRole('link', { name: /Approvals/ })
    .click();
  await expect(page.getByRole('heading', { name: 'Approvals', level: 1 })).toBeVisible();
}

/** Opens the workspace's GitHub credential, which the Tickets page keeps closed. */
async function openCredential(): Promise<void> {
  await page.getByRole('button', { name: 'GitHub credential', exact: true }).click();
  await expect(credentialPanel()).toBeVisible();
}

/** Creates a workspace from the selector and lands on its Tickets page. */
async function createWorkspace(name: string): Promise<string> {
  await expect(page.getByRole('heading', { name: 'Choose a workspace' })).toBeVisible();
  // The form is already open when there is no workspace yet, and then this changes nothing.
  await page.getByRole('button', { name: /New workspace/ }).click();
  const form = page.getByRole('region', { name: 'New workspace' });
  await form.getByLabel('Workspace name').fill(name);
  await form.getByRole('button', { name: 'Create and link a repo' }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+\/?$/);
  return page.url();
}

/** Creates a built-in ticket and lands on its page. */
async function createTicket(title: string, body: string): Promise<string> {
  await openTickets();
  await page.getByRole('button', { name: 'New ticket' }).click();
  const form = page.getByRole('region', { name: 'New ticket' });
  await form.getByLabel('Title').fill(title);
  await form.getByLabel('Description (markdown)').fill(body);
  await form.getByRole('button', { name: 'Create ticket' }).click();
  await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
  return page.url();
}

async function choosePhase(name: string): Promise<void> {
  await nextSession()
    .getByRole('radio', { name: new RegExp(`^${name}`) })
    .check({ force: true });
}

/** Starts the session the launch controls show, opens its page, and waits for its result. */
async function runSession(): Promise<void> {
  const before = await sessionCards().count();
  await nextSession()
    .getByRole('button', { name: /Start (session|again)/ })
    .click();
  await expect(sessionCards()).toHaveCount(before + 1);
  await sessionCards()
    .first()
    .getByRole('link', { name: /^(Watch|Result)$/ })
    .click();
  await expect(page).toHaveURL(/\/sessions\//);
  await expect(page.getByText('Result complete').first()).toBeVisible();
}

/** Starts an implementation session on a new built-in ticket and waits for it on its page. */
async function implement(title: string, body: string): Promise<string> {
  const ticketUrl = await createTicket(title, body);
  // A new ticket suggests an investigation, and any phase can be picked instead.
  await choosePhase('Implementation');
  await expect(beforeLaunch()).toContainText('May change code');
  await runSession();
  return ticketUrl;
}

async function actionId(card: Locator): Promise<string> {
  return ((await card.getAttribute('id')) ?? '').replace(/^action-/, '');
}

/** An open PR is approved for the commit it shows, so the button waits for the branch to be read. */
async function approve(card: Locator): Promise<void> {
  const button = card.getByRole('button', { name: 'Approve' });
  await expect(button).toBeEnabled();
  await button.click();
}

test('signs in and links a clone whose pushes go to a local bare repo', async () => {
  const user = readRunUser();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill(user.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  workspaceUrl = await createWorkspace(`E2E PRs ${Date.now()}`);

  clone = makeClone(PR_REPO.owner, PR_REPO.repo);
  remote = makeRemote(PR_REPO.owner, PR_REPO.repo, clone);
  const linkForm = page.getByRole('region', { name: 'Link a repo' });
  if (!(await linkForm.isVisible())) {
    await page.getByRole('button', { name: 'Link a repo', exact: true }).click();
  }
  await linkForm.getByLabel('Path to a local clone').fill(clone);
  await linkForm.getByRole('button', { name: 'Link repo' }).click();
  // No source is connected in this workspace, so its tickets stay built-in ones.
  await page
    .getByRole('region', { name: "Connect this repo's Issues" })
    .getByRole('button', { name: 'Not now' })
    .click();
});

test('BR-19 a saved workspace credential shows as set and working, never its value', async () => {
  await openTickets();
  await openCredential();
  await expect(credentialState()).toHaveText('No credential set');

  await credentialPanel().getByLabel('GitHub token', { exact: true }).fill(WORKSPACE_TOKEN);
  await credentialPanel().getByRole('button', { name: 'Save credential' }).click();
  await expect(credentialState()).toHaveText(`Working · acts as ${STUB_LOGIN}`);
  const access = credentialPanel().getByRole('list', { name: 'Push access' });
  await expect(access.getByRole('listitem')).toHaveCount(1);
  await expect(access).toContainText(REPO_LABEL);
  await expect(access).toContainText('Can push');

  await expect(credentialPanel().getByLabel('Replace the GitHub token')).toHaveValue('');
  expect(await page.content()).not.toContain(WORKSPACE_TOKEN);
});

test('BR-20 an implementation session that committed gets an open PR action, without a reload', async () => {
  prTicketUrl = await implement(PR_TICKET, 'Let people download the list.');
  // Nothing from here to the end of BR-21 loads a page.
  loadsBeforeDraft = loads;
  prSessionUrl = page.url();
  const action = actionCard('Open PR');
  await expect(action).toBeVisible();

  // The markers go in a follow-up, not the ticket, so the review in BR-26 isn't given them in
  // its brief. The round they end redrafts the action, which nobody has edited yet.
  const followUp = page.getByRole('region', { name: 'Follow-up' });
  await followUp
    .getByLabel('Follow-up message')
    .fill(`Rewrite the README too. ${MARKERS.commit} ${MARKERS.uncommitted}`);
  await followUp.getByRole('button', { name: 'Send follow-up' }).click();
  await expect(page.getByText(/Result complete · round 2/).first()).toBeVisible();
  await expect(action).toContainText('round 2');
  await expect(action).toHaveAttribute('data-action-status', 'pending');
  await expect(action.getByTestId('action-status')).toHaveText('Waiting for approval');
  await expect(action).toContainText(PR_TICKET);
  await expect(action).toContainText(/slop\/T-1\/[0-9a-f]{8}/);
  prActionId = await actionId(action);
  expect(prActionId).not.toBe('');
});

test('BR-21 the navigation counts the action and the inbox lists it, without a reload', async () => {
  await expect(approvalsCount()).toHaveText(/^1\b/);
  await openInbox();
  await expect(inbox().getByRole('listitem')).toHaveCount(1);

  const row = inbox().getByTestId(`inbox-action-${prActionId}`);
  await expect(row).toHaveAttribute('data-action-type', 'open_pr');
  await expect(row).toHaveAttribute('data-action-status', 'pending');
  await expect(row).toContainText('T-1');
  await expect(row).toContainText('Implementation');
  await expect(row).toContainText('Waiting for approval');
  const link = row.getByRole('link', { name: `Open PR · ${PR_TICKET}` });
  await expect(link).toHaveAttribute(
    'href',
    new RegExp(`/sessions/[0-9a-f-]+#action-${prActionId}$`),
  );
  expect(loads).toBe(loadsBeforeDraft);

  await link.click();
  await expect(page).toHaveURL(`${prSessionUrl}#action-${prActionId}`);
  await expect(actionCard('Open PR')).toBeVisible();
});

test("BR-22 the diff shows the session's change, and the uncommitted file apart", async () => {
  const changes = page.getByRole('region', { name: 'Changes', exact: true });
  await expect(changes.getByTestId('diff-summary')).toHaveText(DIFF_SUMMARY);
  const files = changes.getByRole('list', { name: 'Changed files' });
  await expect(files.getByRole('listitem')).toHaveCount(2);

  const readme = files.getByRole('listitem', { name: 'README.md' });
  await expect(readme).toContainText('Modified');
  await expect(readme).toContainText('+1 −1');
  await expect(readme.locator('[data-line="removed"]')).toHaveText(`-# ${PR_REPO.repo}`);
  await expect(readme.locator('[data-line="added"]')).toHaveText('+# Scripted change, round 2');
  const work = files.getByRole('listitem', { name: 'e2e-work.txt' });
  await expect(work).toContainText('Added');
  await expect(work).toContainText('+1 −0');
  await expect(work.locator('[data-line="added"]')).toHaveText('+work from round 2');

  // Listed apart, with no diff of its own.
  const uncommitted = changes.getByRole('list', { name: 'Uncommitted files', exact: true });
  await expect(uncommitted.getByRole('listitem')).toHaveCount(1);
  await expect(uncommitted).toContainText('e2e-uncommitted.txt');
  await expect(uncommitted).toContainText('New, untracked');
  await expect(files).not.toContainText('e2e-uncommitted.txt');
  // The view is read-only.
  await expect(changes.getByRole('textbox')).toHaveCount(0);
  await expect(changes.getByRole('button')).toHaveCount(0);

  // The same diff is beside the open PR action.
  const action = actionCard('Open PR');
  await expect(action.getByTestId('action-commit-count')).toHaveText('2 commits');
  await expect(
    action.getByRole('list', { name: 'Uncommitted files, not in this PR' }),
  ).toContainText('e2e-uncommitted.txt');
  await action.getByText('Changes to push').click();
  await expect(action.getByTestId('diff-summary')).toHaveText(DIFF_SUMMARY);
  await expect(
    action.getByRole('list', { name: 'Changed files' }).getByRole('listitem'),
  ).toHaveCount(2);
  shownHead = (await action.getByTestId('action-head-commit').innerText()).trim();
  expect(shownHead).toMatch(/^[0-9a-f]{8}$/);
});

test('BR-23 before anything is approved, nothing was written or pushed', async () => {
  const stub = await stubState();
  expect(stub.writes).toEqual([]);
  expect(stub.pulls).toEqual([]);
  expect(remoteBranches()).toEqual(['main']);
});

test('BR-24 an edited open PR is approved: the stub gets the edited text, the bare repo the branch', async () => {
  const action = actionCard('Open PR');
  await action.getByRole('button', { name: 'Edit' }).click();
  await action.getByLabel('PR title').fill(EDITED_TITLE);
  await action.getByLabel('PR body (markdown)').fill(EDITED_BODY);
  await action.getByRole('button', { name: 'Save changes' }).click();
  await expect(action.getByLabel('PR title')).toHaveCount(0);
  await expect(action).toContainText(EDITED_TITLE);
  await expect(action.getByText('edited', { exact: true })).toBeVisible();

  await approve(action);
  await expect(action).toHaveAttribute('data-action-status', 'succeeded');
  await expect(action.getByTestId('action-status')).toHaveText('Sent');
  await expect(action.getByRole('button', { name: 'Approve' })).toHaveCount(0);

  const { pulls, comments } = await stubState();
  expect(pulls).toHaveLength(1);
  const pull = pulls[0]!;
  expect(pull).toMatchObject({
    repo: PR_REPO.repo,
    title: EDITED_TITLE,
    body: EDITED_BODY,
    base: 'main',
  });
  expect(pull.head).toMatch(/^slop\/T-1\/[0-9a-f]{8}$/);
  expect(comments).toEqual([]);
  await expect(
    action.getByTestId('action-result').getByRole('link', { name: `Pull request #${pull.number}` }),
  ).toHaveAttribute('href', pull.html_url);

  // A real push, to the bare repo: the branch is there at the commit the action showed.
  expect(remoteBranches()).toEqual(['main', pull.head]);
  const pushed = gitOutput(remote, 'rev-parse', `refs/heads/${pull.head}`);
  expect(pushed).toBe(gitOutput(clone, 'rev-parse', `refs/heads/${pull.head}`));
  expect(pushed.startsWith(shownHead)).toBe(true);
  const pushedFiles = gitOutput(remote, 'ls-tree', '-r', '--name-only', pull.head).split('\n');
  expect(pushedFiles).toContain('e2e-work.txt');
  expect(pushedFiles).not.toContain('e2e-uncommitted.txt');
});

test('BR-25 the opened PR leaves the inbox, without a reload', async () => {
  const before = loads;
  await openInbox();
  await expect(inbox().getByTestId(`inbox-action-${prActionId}`)).toHaveCount(0);
  // Opening the PR drafted the ticket's move to In review, which waits in its place (BR-27).
  await expect(inbox().getByRole('listitem')).toHaveCount(1);
  await expect(inbox().getByRole('listitem')).toHaveAttribute(
    'data-action-type',
    'ticket_transition',
  );
  await expect(approvalsCount()).toHaveText(/^1\b/);
  expect(loads).toBe(before);
});

test("BR-26 a review session's comment is rejected, and nothing is sent", async () => {
  await page.goto(prTicketUrl);
  await choosePhase('Code review');
  // The review starts from the implementation branch, once the pre-launch view has caught up.
  await expect(beforeLaunch()).toContainText(/slop\/T-1\/[0-9a-f]{8}/);
  await runSession();

  const comment = actionCard('Ticket comment');
  await expect(comment).toHaveAttribute('data-action-status', 'pending');
  await expect(comment).toContainText('Comment on T-1');
  await expect(approvalsCount()).toHaveText(/^2\b/);

  await comment.getByRole('button', { name: 'Reject' }).click();
  await expect(comment).toHaveAttribute('data-action-status', 'rejected');
  await expect(comment.getByTestId('action-status')).toHaveText('Rejected');
  await expect(comment.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  await expect(comment.getByRole('button', { name: 'Edit' })).toHaveCount(0);
  await expect(approvalsCount()).toHaveText(/^1\b/);

  const stub = await stubState();
  expect(stub.comments).toEqual([]);
  // The pull request is still the only write.
  expect(stub.writes).toHaveLength(1);
});

test('BR-27 the move to In review was drafted after the PR opened, and approving it moves the ticket', async () => {
  await page.goto(prSessionUrl);
  const move = actionCard('Status change');
  await expect(move).toHaveAttribute('data-action-status', 'pending');
  await expect(move).toContainText('In review');

  // The target can be any status the ticket can move to.
  await move.getByRole('button', { name: 'Edit' }).click();
  const target = move.getByLabel('Move ticket to');
  await expect(target).toHaveValue('In review');
  for (const status of ['In progress', 'In review', 'Done', 'Cancelled']) {
    await expect(target.locator('option', { hasText: new RegExp(`^${status}$`) })).toHaveCount(1);
  }
  await move.getByRole('button', { name: 'Cancel' }).click();

  await approve(move);
  await expect(move).toHaveAttribute('data-action-status', 'succeeded');
  await expect(move.getByTestId('action-result')).toHaveText('Ticket moved to In review');
  // Nothing is waiting any more, so the navigation shows no count.
  await expect(approvalsCount()).toHaveCount(0);

  await page.goto(prTicketUrl);
  await expect(page.getByRole('combobox', { name: 'Ticket status' })).toHaveValue('in_review');
  // A built-in ticket's status is the workspace's own, so GitHub heard nothing of it.
  expect((await stubState()).writes).toHaveLength(1);
});

test('BR-28 a rejected token fails the approval, and the action and the credential say so', async () => {
  await implement(FAILING_TICKET, `Let people download the list as JSON. ${MARKERS.commit}`);
  const action = actionCard('Open PR');
  await expect(action).toHaveAttribute('data-action-status', 'pending');
  failingActionId = await actionId(action);

  await rejectTokens(true);
  await approve(action);
  await expect(action).toHaveAttribute('data-action-status', 'failed');
  await expect(action.getByTestId('action-status')).toHaveText('Failed');
  const error = action.getByTestId('action-error');
  await expect(error).toContainText('The last attempt failed.');
  await expect(error).toContainText('GitHub rejected the credential');
  await expect(error).not.toContainText(WORKSPACE_TOKEN);
  expect((await stubState()).pulls).toHaveLength(1);

  // A failed action still waits on the developer.
  await expect(approvalsCount()).toHaveText(/^1\b/);
  await openInbox();
  const row = inbox().getByTestId(`inbox-action-${failingActionId}`);
  await expect(row).toHaveAttribute('data-action-status', 'failed');
  await expect(row).toContainText('Failed');

  await mainNav().getByRole('link', { name: 'Tickets', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tickets', level: 1 })).toBeVisible();
  await expect(page.getByText("GitHub rejected this workspace's credential")).toBeVisible();
  await openCredential();
  await expect(credentialState()).toHaveText('Rejected by GitHub');
});

test('BR-29 once the token is accepted again, approving the failed action succeeds', async () => {
  await rejectTokens(false);
  await openInbox();
  await inbox()
    .getByTestId(`inbox-action-${failingActionId}`)
    .getByRole('link', { name: `Open PR · ${FAILING_TICKET}` })
    .click();
  const action = actionCard('Open PR');
  await expect(action).toHaveAttribute('data-action-status', 'failed');

  await approve(action);
  await expect(action).toHaveAttribute('data-action-status', 'succeeded');
  await expect(action.getByTestId('action-error')).toHaveCount(0);

  const { pulls } = await stubState();
  expect(pulls).toHaveLength(2);
  const pull = pulls[1]!;
  expect(pull.head).toMatch(/^slop\/T-2\/[0-9a-f]{8}$/);
  // One pull request for the branch, though it was approved twice.
  expect(pulls.filter((item) => item.head === pull.head)).toHaveLength(1);
  await expect(
    action.getByTestId('action-result').getByRole('link', { name: `Pull request #${pull.number}` }),
  ).toBeVisible();
  expect(remoteBranches()).toContain(pull.head);

  // Using the credential successfully clears its failure.
  await openTickets();
  await openCredential();
  await expect(credentialState()).toHaveText(`Working · acts as ${STUB_LOGIN}`);
});

test('BR-30 an implementation session that committed nothing has nothing to push', async () => {
  await implement(
    'Leaves its work uncommitted',
    `Change something. ${MARKERS.noCommit} ${MARKERS.uncommitted}`,
  );
  const notice = page.getByText('Nothing to push.').locator('..');
  await expect(notice).toContainText('no pull request was drafted');
  await expect(notice).toContainText('e2e-uncommitted.txt');
  await expect(actionCard('Open PR')).toHaveCount(0);
  await expect(
    page.getByRole('region', { name: 'Changes', exact: true }).getByTestId('diff-summary'),
  ).toHaveText('No commits and no changed files.');
});

test("BR-31 a session whose base couldn't be fetched says so", async () => {
  // The run's server can't reach any origin, so every session from the default branch has this.
  await page.goto(prSessionUrl);
  await expect(page.getByText("The base couldn't be fetched")).toBeVisible();
  await expect(page.getByRole('region', { name: 'Setup', exact: true })).toContainText(
    'origin/main',
  );
});

test('BR-32 a GitHub Issues source connected with a token shows its credential, never the value', async () => {
  await page.goto(workspaceUrl);
  await page.getByRole('link', { name: 'Ticket sources' }).click();
  const connect = page.getByRole('region', { name: 'Connect a source' });
  await connect.getByLabel('Owner').fill(PR_REPO.owner);
  await connect.getByLabel('Repository').fill(PR_REPO.repo);
  await connect.getByLabel('Token (optional)').fill(SOURCE_TOKEN);
  await connect.getByRole('button', { name: 'Connect source' }).click();

  const source = page.getByRole('article', { name: `Source ${REPO_LABEL}` });
  await expect(source).toContainText('Connected');
  const state = source.getByTestId('source-credential-state');
  await expect(state).toHaveText('Working');
  await expect(connect.getByLabel('Token (optional)')).toHaveValue('');
  expect(await page.content()).not.toContain(SOURCE_TOKEN);

  await source.getByRole('button', { name: 'Remove credential' }).click();
  await expect(state).toHaveText('No credential set');
});

test("BR-34 a second workspace's inbox is empty and its count hidden", async () => {
  // The first workspace still has the second ticket's move to In review waiting.
  await openTickets();
  await expect(approvalsCount()).toHaveText(/^1\b/);

  await page.goto('/');
  await createWorkspace(`E2E empty ${Date.now()}`);
  await openInbox();
  await expect(page.getByText('Nothing is waiting for approval.')).toBeVisible();
  await expect(inbox()).toHaveCount(0);
  await expect(approvalsCount()).toHaveCount(0);
});

test('BR-35 the run made no request to GitHub or Anthropic', async () => {
  const outside = requested.filter((url) => /github\.com|anthropic\.com|claude\.ai/.test(url));
  expect(outside).toEqual([]);

  const seen = (await (await fetch(`${GITHUB_STUB_URL}/__requests`)).json()) as {
    method: string;
    path: string;
    authorized: boolean;
  }[];
  // The server's GitHub calls came to the stub, and its writes carried the stored token.
  const written = seen.filter((request) => request.method !== 'GET');
  expect(written.length).toBeGreaterThan(0);
  expect(written.every((request) => request.authorized)).toBe(true);
  expect(written.every((request) => request.path === `/repos/${REPO_LABEL}/pulls`)).toBe(true);
  // Both pushes went to the local bare repo: `main`, and one branch per opened pull request.
  expect(remoteBranches()).toHaveLength(3);
});

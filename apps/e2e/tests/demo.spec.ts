import { expect, test, type Locator, type Page } from '@playwright/test';
import { makeClone } from '../support/clone';
import { GITHUB_STUB_URL, STUB_REPO } from '../support/env';
import { readRunUser } from '../support/user';

/**
 * The demo script's steps 1 to 4 and 6, in order, in one signed-in page. Step 5, the block on
 * `gh` and `git push`, belongs to the smoke test, because only a real session can prove it.
 *
 * The markers are the scripted runtime's (`apps/server/test/support/scripted-runtime.ts`).
 */
const MARKERS = {
  fail: '[e2e:fail]',
  noArtifact: '[e2e:no-artifact]',
  changeCode: '[e2e:change-code]',
  keepRunning: '[e2e:keep-running]',
};

const REPO_LABEL = `${STUB_REPO.owner}/${STUB_REPO.repo}`;
const SECOND_REPO_LABEL = `${STUB_REPO.owner}/second-repo`;
const MAIN_TICKET = 'Add a CSV export';

test.describe.configure({ mode: 'serial' });

let page: Page;
let workspaceUrl: string;
let mainTicketUrl: string;
/** Every URL the browser asked for, to show the run never left this machine (BR-16). */
const requested: string[] = [];

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  page.on('request', (request) => requested.push(request.url()));
});

test.afterAll(async () => {
  await page.close();
});

const nextSession = () => page.getByRole('region', { name: 'Next session' });
const beforeLaunch = () => page.getByRole('region', { name: 'Before launch' });
const suggestion = () => page.getByRole('status', { name: 'Suggested phase' });
const sessionCards = () => page.getByRole('region', { name: 'Sessions' }).getByRole('article');
/** The session page's record of the setup the session started with. */
const setupUsed = () => page.getByRole('region', { name: 'Setup', exact: true });

async function openTickets(): Promise<void> {
  await page.goto(workspaceUrl);
  await expect(page.getByRole('heading', { name: 'Tickets', level: 1 })).toBeVisible();
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

/** Picks the repo the next session runs in, for when the workspace can't preselect one. */
async function chooseRepo(label: string): Promise<void> {
  await nextSession().getByLabel('Repo').selectOption({ label });
}

async function choosePhase(name: string): Promise<void> {
  await nextSession()
    .getByRole('radio', { name: new RegExp(`^${name}`) })
    .check({ force: true });
}

/** Starts the session the launch controls show and returns its card, the newest on the ticket. */
async function startSession(): Promise<Locator> {
  const before = await sessionCards().count();
  await nextSession()
    .getByRole('button', { name: /Start (session|again)/ })
    .click();
  await expect(sessionCards()).toHaveCount(before + 1);
  return sessionCards().first();
}

async function openSession(card: Locator): Promise<void> {
  await card.getByRole('link', { name: /^(Watch|Result)$/ }).click();
  await expect(page).toHaveURL(/\/sessions\//);
}

async function sendFollowUp(message?: string): Promise<void> {
  const form = page.getByRole('region', { name: 'Follow-up' });
  if (message !== undefined) await form.getByLabel('Follow-up message').fill(message);
  await form.getByRole('button', { name: 'Send follow-up' }).click();
}

test('BR-01 signs in on the real sign-in page', async () => {
  const user = readRunUser();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill(user.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Choose a workspace' })).toBeVisible();
});

test('BR-02 creates a workspace, links a clone, and creates a built-in ticket', async () => {
  const newWorkspace = page.getByRole('region', { name: 'New workspace' });
  if (!(await newWorkspace.isVisible())) {
    await page.getByRole('button', { name: /New workspace/ }).click();
  }
  await newWorkspace.getByLabel('Workspace name').fill(`E2E ${Date.now()}`);
  await newWorkspace.getByRole('button', { name: 'Create and link a repo' }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+\/?$/);
  workspaceUrl = page.url();

  const linkForm = page.getByRole('region', { name: 'Link a repo' });
  if (!(await linkForm.isVisible())) {
    await page.getByRole('button', { name: 'Link a repo', exact: true }).click();
  }
  await linkForm
    .getByLabel('Path to a local clone')
    .fill(makeClone(STUB_REPO.owner, STUB_REPO.repo));
  await linkForm.getByRole('button', { name: 'Link repo' }).click();

  // Linking offers to connect the repo's Issues, and never does it on its own.
  const offer = page.getByRole('region', { name: "Connect this repo's Issues" });
  await expect(offer).toBeVisible();
  await offer.getByRole('button', { name: 'Not now' }).click();

  mainTicketUrl = await createTicket(MAIN_TICKET, 'Let people download the list as CSV.');
  await expect(page).toHaveURL(/\/tickets\/T-1$/);
});

test('BR-03 the pre-launch view matches the session it starts', async () => {
  await expect(suggestion()).toContainText('Suggested: Investigation');
  await expect(nextSession().getByRole('radio', { name: /^Investigation/ })).toBeChecked();

  const view = beforeLaunch();
  await expect(view).toContainText(REPO_LABEL);
  await expect(view).toContainText('.slop/investigation.md');
  await expect(view).toContainText('Read-only');
  await expect(view).toContainText('User-level source off');
  await expect(view).toContainText('origin/main');
  await expect(view).toContainText('No earlier artifacts');

  const card = await startSession();
  await openSession(card);
  const setup = setupUsed();
  await expect(setup).toContainText(REPO_LABEL);
  await expect(setup).toContainText('.slop/investigation.md');
  await expect(setup).toContainText('Read-only');
  await expect(setup).toContainText('User-level source off');
  await expect(setup).toContainText('origin/main');
  await expect(page.getByText('Result complete').first()).toBeVisible();
});

test('BR-04 only the phase and the repo can be changed before launch', async () => {
  await page.goto(mainTicketUrl);
  await expect(beforeLaunch()).toBeVisible();
  for (const role of ['textbox', 'checkbox', 'switch', 'button'] as const) {
    await expect(beforeLaunch().getByRole(role)).toHaveCount(0);
  }
  await expect(nextSession().getByRole('radio')).toHaveCount(4);
  await expect(nextSession().getByLabel('Repo')).toBeEnabled();
});

test('BR-05 suggests the next phase when a session ends, without a reload', async () => {
  // A fresh ticket, so the suggestion is seen changing while the page stays open.
  await createTicket('Watch the suggestion move', 'Any small task.');
  await expect(suggestion()).toContainText('Suggested: Investigation');
  await startSession();
  await expect(suggestion()).toContainText('Suggested: Planning');
  await expect(suggestion()).toContainText('Investigation is complete.');
  await expect(nextSession().getByRole('radio', { name: /^Planning/ })).toBeChecked();
});

test('BR-06 a planning session is given the investigation', async () => {
  await page.goto(mainTicketUrl);
  await expect(suggestion()).toContainText('Suggested: Planning');
  const given = beforeLaunch().getByRole('list', { name: 'Earlier artifacts' });
  await expect(given).toContainText('.slop/context/investigation.md');

  const card = await startSession();
  await openSession(card);
  await expect(setupUsed()).toContainText('.slop/context/investigation.md');
  await expect(page.getByText('Result complete').first()).toBeVisible();
});

test('BR-07 another phase and a second linked repo can be picked', async () => {
  await openTickets();
  await page.getByRole('button', { name: 'Link another repo' }).click();
  const linkForm = page.getByRole('region', { name: 'Link a repo' });
  await linkForm
    .getByLabel('Path to a local clone')
    .fill(makeClone(STUB_REPO.owner, 'second-repo'));
  await linkForm.getByRole('button', { name: 'Link repo' }).click();
  await page
    .getByRole('region', { name: "Connect this repo's Issues" })
    .getByRole('button', { name: 'Not now' })
    .click();

  await page.goto(mainTicketUrl);
  await expect(suggestion()).toContainText('Suggested: Implementation');
  await choosePhase('Investigation');
  await chooseRepo(SECOND_REPO_LABEL);
  await expect(beforeLaunch()).toContainText(SECOND_REPO_LABEL);
  await expect(beforeLaunch()).toContainText('.slop/investigation.md');
  // The suggestion itself doesn't move when another phase is picked.
  await expect(suggestion()).toContainText('Suggested: Implementation');
});

test('BR-08 a follow-up from the session page runs as round 2, live', async () => {
  await page.goto(mainTicketUrl);
  await expect(nextSession().getByRole('radio', { name: /^Implementation/ })).toBeChecked();
  await expect(beforeLaunch()).toContainText('May change code');
  const card = await startSession();
  await openSession(card);
  await expect(page.getByText('Result complete').first()).toBeVisible();

  await sendFollowUp('Also mention the delimiter in the report.');
  await expect(page.getByText('Round 2').first()).toBeVisible();
  await expect(page.getByText(/Result complete · round 2/).first()).toBeVisible();
});

test('BR-09 a running round keeps the previous result, hides the form, and can be stopped', async () => {
  await sendFollowUp(`Keep going. ${MARKERS.keepRunning}`);
  await expect(page.getByText('Round 3').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop session' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Previous result' })).toContainText(
    'Scripted result',
  );
  await expect(page.getByLabel('Follow-up message')).toHaveCount(0);

  const answered = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().endsWith('/stop'),
  );
  await page.getByRole('button', { name: 'Stop session' }).click();
  await expect(page.getByRole('button', { name: 'Stop session' })).toHaveCount(0);
  await answered;

  // A stopped round wrote nothing new, so the session reads as incomplete and offers Continue.
  const resume = page.getByRole('button', { name: 'Continue', exact: true });
  await expect(page.getByText(/^Stopped ·/).first()).toBeVisible();
  await expect(resume).toBeVisible();
  // Checked again once the stop request has been answered: the page must not go back to running.
  await expect(page.getByRole('button', { name: 'Stop session' })).toHaveCount(0);

  // The review in the next step is only given the report of a complete session.
  await resume.click();
  await expect(page.getByLabel('Follow-up message')).not.toHaveValue('');
  await sendFollowUp();
  await expect(page.getByText(/Result complete · round 4/).first()).toBeVisible();
});

test('BR-10 a code review starts from the implementation branch, then nothing is suggested', async () => {
  await page.goto(mainTicketUrl);
  await choosePhase('Code review');
  const view = beforeLaunch();
  await expect(view).toContainText('Starts from');
  await expect(view).toContainText(/slop\/T-1\/[0-9a-f]{8}/);
  await expect(view).toContainText('Compares to');
  await expect(view).toContainText('origin/main');
  await expect(view.getByRole('list', { name: 'Earlier artifacts' })).toContainText(
    '.slop/context/implementation.md',
  );

  await startSession();
  await expect(suggestion()).toContainText('No phase suggested');
});

test('BR-11 an incomplete session offers Continue, which completes it', async () => {
  await createTicket('Ends without its artifact', `Investigate. ${MARKERS.noArtifact}`);
  // With two linked repos and no history on this ticket, the dashboard asks for the repo.
  // The pre-launch view only shows once the preview has loaded, so the checks below are its answer.
  await expect(beforeLaunch()).toBeVisible();
  await expect(nextSession().getByLabel('Repo')).toHaveValue('');
  await expect(nextSession().getByRole('button', { name: /Start (session|again)/ })).toBeDisabled();
  await chooseRepo(REPO_LABEL);
  const card = await startSession();
  await openSession(card);
  await expect(page.getByText('Result incomplete').first()).toBeVisible();

  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByLabel('Follow-up message')).not.toHaveValue('');
  await sendFollowUp();
  await expect(page.getByText(/Result complete · round 2/).first()).toBeVisible();
});

test('BR-12 a read-only session that changed code is flagged beside its result', async () => {
  const ticketUrl = await createTicket('Changes code while investigating', MARKERS.changeCode);
  await chooseRepo(REPO_LABEL);
  const card = await startSession();
  await openSession(card);
  await expect(page.getByText('Result complete').first()).toBeVisible();
  await expect(page.getByText(/Scope flag: Changed code in a read-only phase/)).toBeVisible();

  await page.goto(ticketUrl);
  await expect(sessionCards().first()).toContainText('Scope flag');
  await expect(sessionCards().first()).toContainText('Changed code in a read-only phase');
});

test('BR-13 a failed session shows its reason', async () => {
  await createTicket('Fails', MARKERS.fail);
  await chooseRepo(REPO_LABEL);
  const card = await startSession();
  await openSession(card);
  await expect(page.getByText('Failed', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('The scripted run failed.').first()).toBeVisible();
});

test('BR-14 an edited phase setup shows in the next pre-launch view', async () => {
  await page.goto(workspaceUrl);
  await page.getByRole('link', { name: 'Phase setups' }).click();
  await expect(page.getByRole('heading', { name: 'Phase setups', level: 1 })).toBeVisible();

  const planning = page.getByRole('region', { name: 'Planning setup' });
  await expect(planning).toContainText('.slop/plan.md');
  const instruction = planning.getByLabel('Planning instruction');
  await instruction.fill(`${await instruction.inputValue()} Keep the plan under one page.`);
  await planning.getByText('Load my ~/.claude in planning sessions').click();
  await planning.getByRole('button', { name: 'Save planning setup' }).click();
  await expect(planning.getByRole('button', { name: 'Save planning setup' })).toBeDisabled();

  await page.goto(mainTicketUrl);
  await choosePhase('Planning');
  await expect(beforeLaunch()).toContainText('Keep the plan under one page.');
  await expect(beforeLaunch()).toContainText('User-level source on');
});

test('BR-15 a GitHub Issues source lists beside the built-in tickets', async () => {
  await page.goto(workspaceUrl);
  await page.getByRole('link', { name: 'Ticket sources' }).click();
  const connect = page.getByRole('region', { name: 'Connect a source' });
  await connect.getByLabel('Owner').fill(STUB_REPO.owner);
  await connect.getByLabel('Repository').fill(STUB_REPO.repo);
  await connect.getByRole('button', { name: 'Connect source' }).click();
  await expect(page.getByRole('article', { name: `Source ${REPO_LABEL}` })).toContainText(
    'Connected',
  );

  await openTickets();
  const table = page.getByRole('table');
  await expect(table).toContainText('Stub issue: add a dark theme');
  await expect(table).toContainText(MAIN_TICKET);
  // New work now comes from the connected source, so built-in creation is off.
  await expect(page.getByRole('button', { name: 'New ticket' })).toHaveCount(0);
});

test('BR-16 the run made no request to GitHub or Anthropic', async () => {
  const outside = requested.filter((url) => /github\.com|anthropic\.com|claude\.ai/.test(url));
  expect(outside).toEqual([]);

  const seen = (await (await fetch(`${GITHUB_STUB_URL}/__requests`)).json()) as {
    path: string;
    authorized: boolean;
  }[];
  // The server did read issues, and it read them from the stub, with no token.
  expect(seen.some((request) => request.path.endsWith('/issues'))).toBe(true);
  expect(seen.every((request) => !request.authorized)).toBe(true);
});

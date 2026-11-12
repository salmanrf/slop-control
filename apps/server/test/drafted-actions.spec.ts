import type { LoggerService } from '@nestjs/common';
import type { DraftedAction, Session, Ticket } from '@slop-control/shared';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  RepoHostAuthError,
  RepoHostRejectedError,
  RepoHostUnavailableError,
} from '../src/repo-host/repo-host';
import { TrackerAuthError } from '../src/tickets/tracker';
import {
  WORKSPACE_TOKEN,
  actionPath,
  approveOpenPr,
  detail,
  implement,
  saveCredential,
  seedBuiltIn,
  sessionActions,
  settledActions,
  waitForAction,
} from './support/actions';
import { ticket } from './support/fake-tracker';
import { git } from './support/git';
import {
  completeSession,
  createHarness,
  KEY,
  reportStarted,
  seedWorkspace,
  sendMessage,
  startSession,
  ticketPath,
  waitForSession,
  type Harness,
  type Seeded,
} from './support/session-harness';
import { resetDatabase, signToken } from './support/test-app';

const UNKNOWN = '00000000-0000-4000-8000-000000000000';
const SOURCE_TOKEN = 'ghp_source_token_for_ticket_writes';

describe('drafted actions', () => {
  let h: Harness;
  let seeded: Seeded;
  let baseUrl: string;
  const lines: string[] = [];
  const logger: LoggerService = {
    log: (message) => void lines.push(String(message)),
    error: (message) => void lines.push(String(message)),
    warn: (message) => void lines.push(String(message)),
  };

  const approve = (action: DraftedAction, body: object = {}) =>
    h.api.post(`${actionPath(action)}/approve`).send(body);
  const reject = (action: DraftedAction) => h.api.post(`${actionPath(action)}/reject`);
  const edit = (action: DraftedAction, body: unknown) =>
    h.api.patch(actionPath(action)).send(body as object);
  const read = async (action: DraftedAction) => (await detail(h, action)).action;
  const inbox = async (workspaceId = seeded.workspaceId, query = '') =>
    h.api.get(`/workspaces/${workspaceId}/drafted-actions${query}`);
  const review = (ref = seeded, report = '# Review\n\nLooks right.') =>
    completeSession(h, ref, 'code_review', { content: report });
  const giveSourceCredential = async () => {
    const res = await h.api
      .patch(`/workspaces/${seeded.workspaceId}/sources/${seeded.sourceId}`)
      .send({ token: SOURCE_TOKEN });
    expect(res.status).toBe(200);
  };
  /** Runs a follow-up round that writes a new report and, unless told not to, a new commit. */
  const followUp = async (session: Session, report: string, commit = true) => {
    await sendMessage(h, session);
    const run = h.runtime.lastRun;
    run.writeFile(session.setup.stopCondition.requiredArtifactPath, report);
    if (commit) {
      run.writeFile(`round-${h.runtime.runs.length}.txt`, 'more\n');
      run.commit('More work');
    }
    run.ended('success');
    return waitForSession(h, session, (s) => s.status === 'ended' && s.round > session.round);
  };

  beforeAll(async () => {
    h = await createHarness();
    h.app.useLogger(logger);
    await h.app.listen(0, '127.0.0.1');
    baseUrl = await h.app.getUrl();
  });
  beforeEach(async () => {
    await resetDatabase();
    h.tracker.reset();
    h.host.pushes.length = 0;
    h.host.pullRequests.length = 0;
    h.host.verifications.length = 0;
    h.host.branches.clear();
    h.host.created = 0;
    h.host.failNext = {};
    h.host.rejectingToken = false;
    h.host.pushGate = null;
    lines.length = 0;
    seeded = await seedWorkspace(h);
  });
  afterAll(() => h.close());

  describe('drafting', () => {
    it('drafts one open PR when an implementation round ends complete with a commit', async () => {
      const session = await implement(h, seeded, { report: '# Report\n\nDid the work.\n\n' });
      const action = await waitForAction(h, session, 'open_pr');
      expect(action).toMatchObject({
        workspaceId: seeded.workspaceId,
        sessionId: session.id,
        ticketSourceId: seeded.sourceId,
        ticketKey: KEY,
        ticketTitle: session.ticketTitle,
        phase: 'implementation',
        round: 1,
        status: 'pending',
        edited: false,
        result: null,
        error: null,
        decidedAt: null,
        dispatchedAt: null,
        payload: {
          title: session.ticketTitle,
          // `Refs`, not `Closes`: merging must not close the issue on its own.
          body: '# Report\n\nDid the work.\n\nRefs #1\n',
          baseBranch: 'main',
          headBranch: session.branch,
        },
      });
      expect(await sessionActions(h, session)).toHaveLength(1);
    });

    it('references an issue in another repo, and a built-in ticket, by key', async () => {
      h.tracker.source('acme/gadgets').add(ticket('acme/gadgets#7'));
      const gadgets = await h.api
        .post(`/workspaces/${seeded.workspaceId}/sources`)
        .send({ type: 'github_issues', githubOwner: 'acme', githubRepo: 'gadgets' });
      const other = await implement(
        h,
        { workspaceId: seeded.workspaceId, sourceId: gadgets.body.id },
        { key: 'acme/gadgets#7' },
      );
      expect((await waitForAction(h, other, 'open_pr')).payload.body).toMatch(
        /\n\nRefs acme\/gadgets#7\n$/,
      );

      const builtIn = await seedBuiltIn(h);
      const session = await implement(h, builtIn, { key: 'T-1' });
      const action = await waitForAction(h, session, 'open_pr');
      expect(action.payload.title).toBe('Built-in work');
      expect(action.payload.body).toMatch(/\n\nTicket: T-1\n$/);
    });

    it('drafts no open PR when the session committed nothing', async () => {
      const session = await implement(h, seeded, { commit: false });
      expect(await settledActions(h, session)).toEqual([]);
    });

    it('drafts nothing for an incomplete, failed, or stopped round', async () => {
      const incomplete = await startSession(h, seeded, 'implementation');
      reportStarted(h.runtime.lastRun);
      h.runtime.lastRun.writeFile('feature.txt', 'x');
      h.runtime.lastRun.commit();
      h.runtime.lastRun.ended('success');
      await waitForSession(h, incomplete, (s) => s.artifactStatus === 'incomplete');

      const failed = await startSession(h, seeded, 'implementation');
      reportStarted(h.runtime.lastRun);
      h.runtime.lastRun.writeFile(failed.setup.stopCondition.requiredArtifactPath, '# Report');
      h.runtime.lastRun.writeFile('feature.txt', 'x');
      h.runtime.lastRun.commit();
      h.runtime.lastRun.ended('error', 'boom');
      await waitForSession(h, failed, (s) => s.status === 'failed');

      const stopped = await startSession(h, seeded, 'code_review');
      reportStarted(h.runtime.lastRun);
      h.runtime.lastRun.writeFile(stopped.setup.stopCondition.requiredArtifactPath, '# Review');
      await h.api.post(`/workspaces/${seeded.workspaceId}/sessions/${stopped.id}/stop`);
      await waitForSession(h, stopped, (s) => s.status === 'stopped');

      for (const session of [incomplete, failed, stopped]) {
        expect(await settledActions(h, session)).toEqual([]);
      }
    });

    it('drafts nothing for an investigation or a plan', async () => {
      const session = await completeSession(h, seeded, 'investigation');
      expect(await settledActions(h, session)).toEqual([]);
    });

    it("drafts a ticket comment holding a code review's report", async () => {
      const session = await review(seeded, '# Review\n\nTwo things to fix.\n');
      const action = await waitForAction(h, session, 'ticket_comment');
      expect(action).toMatchObject({
        phase: 'code_review',
        status: 'pending',
        payload: { body: '# Review\n\nTwo things to fix.' },
      });
      expect(await sessionActions(h, session)).toHaveLength(1);
    });

    it('redrafts an action the developer never edited when a later round ends', async () => {
      const session = await implement(h, seeded);
      const first = await waitForAction(h, session, 'open_pr');
      await followUp(session, '# Report, second round');
      const second = await waitForAction(h, session, 'open_pr', (a) => a.round === 2);
      expect(second.id).toBe(first.id);
      expect(second.payload.body).toBe('# Report, second round\n\nRefs #1\n');
      expect(second).toMatchObject({ status: 'pending', edited: false });
      expect(await sessionActions(h, session)).toHaveLength(1);
    });

    it('leaves an edited action as it is when a later round ends', async () => {
      const session = await implement(h, seeded);
      const action = await waitForAction(h, session, 'open_pr');
      await edit(action, { title: 'My own title' });
      await followUp(session, '# Report, second round');
      const [after, ...rest] = await settledActions(h, session);
      expect(rest).toEqual([]);
      expect(after).toMatchObject({
        id: action.id,
        round: 1,
        edited: true,
        payload: { title: 'My own title', body: action.payload.body },
      });
    });

    it('never redrafts a failed action, whose payload is the record of what was sent', async () => {
      await saveCredential(h, seeded.workspaceId);
      const session = await implement(h, seeded);
      const action = await waitForAction(h, session, 'open_pr');
      h.host.failNext.push = new RepoHostUnavailableError('down');
      expect((await approveOpenPr(h, action)).body.status).toBe('failed');

      await followUp(session, '# Report, second round');
      const [after, ...rest] = await settledActions(h, session);
      expect(rest).toEqual([]);
      expect(after).toMatchObject({
        id: action.id,
        status: 'failed',
        round: 1,
        payload: action.payload,
      });
    });

    it('drafts a new action in a later round after a rejection, and none in between', async () => {
      const session = await implement(h, seeded);
      const rejected = await waitForAction(h, session, 'open_pr');
      await reject(rejected);
      expect(await settledActions(h, session)).toHaveLength(1);

      await followUp(session, '# Report, second round');
      const fresh = await waitForAction(h, session, 'open_pr', (a) => a.status === 'pending');
      expect(fresh.id).not.toBe(rejected.id);
      expect(fresh.round).toBe(2);
      expect((await read(rejected)).status).toBe('rejected');
    });

    it('drafts no new open PR once the session has opened one', async () => {
      await saveCredential(h, seeded.workspaceId);
      const session = await implement(h, seeded);
      const action = await waitForAction(h, session, 'open_pr');
      expect((await approveOpenPr(h, action)).body.status).toBe('succeeded');
      await followUp(session, '# Report, second round');
      const actions = await settledActions(h, session);
      expect(actions.filter((item) => item.type === 'open_pr')).toHaveLength(1);
    });

    it("never fails the session when a draft can't be made", async () => {
      const session = await startSession(h, seeded, 'implementation');
      const run = h.runtime.lastRun;
      reportStarted(run);
      run.writeFile(session.setup.stopCondition.requiredArtifactPath, '# Report');
      run.writeFile('feature.txt', 'x');
      run.commit();
      // The branch is gone from the clone, so its commits can't be counted.
      git(session.worktreePath, 'checkout', '-q', '--detach');
      git(seeded.clone, 'branch', '-D', session.branch);
      run.ended('success');
      const ended = await waitForSession(h, session, (s) => s.endedAt !== null);
      expect(ended).toMatchObject({ status: 'ended', artifactStatus: 'complete' });
      expect(await settledActions(h, session)).toEqual([]);
      expect(lines.join('\n')).toContain("Couldn't draft");
    });
  });

  describe('editing', () => {
    it("changes an open PR's title and body, and marks it edited", async () => {
      const action = await waitForAction(h, await implement(h, seeded), 'open_pr');
      const res = await edit(action, { title: '  A better title ', body: 'A better body\n' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: action.id,
        edited: true,
        status: 'pending',
        payload: {
          title: 'A better title',
          body: 'A better body\n',
          baseBranch: 'main',
          headBranch: action.payload.headBranch,
        },
      });
      expect((await read(action)).payload).toEqual(res.body.payload);
    });

    it.each([
      ['the base branch', { baseBranch: 'production' }],
      ['the head branch', { headBranch: 'main' }],
      ['a field of another type', { toStatus: 'Done' }],
      ['a blank title', { title: '   ' }],
      ['a blank body', { body: '' }],
      ['a title that is not text', { title: 7 }],
      ['nothing', {}],
      ['a body that is not an object', ['title']],
    ])('refuses to change %s on an open PR', async (_name, body) => {
      const action = await waitForAction(h, await implement(h, seeded), 'open_pr');
      const res = await edit(action, body);
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(await read(action)).toMatchObject({ edited: false, payload: action.payload });
    });

    it('lets a comment change only its body', async () => {
      const action = await waitForAction(h, await review(), 'ticket_comment');
      expect((await edit(action, { title: 'x' })).status).toBe(422);
      const res = await edit(action, { body: 'Shorter.' });
      expect(res.body).toMatchObject({ edited: true, payload: { body: 'Shorter.' } });
    });

    it("can't edit an action that was decided", async () => {
      const action = await waitForAction(h, await review(), 'ticket_comment');
      await reject(action);
      const res = await edit(action, { body: 'Too late.' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('ACTION_ALREADY_DECIDED');
      expect((await read(action)).payload).toEqual(action.payload);
    });

    it("returns 404 for an unknown action, and for another workspace's", async () => {
      const action = await waitForAction(h, await review(), 'ticket_comment');
      const other = (await h.api.post('/workspaces').send({ name: 'other' })).body.id as string;
      const theirs = { ...action, workspaceId: other };
      for (const target of [theirs, { ...action, id: UNKNOWN }, { ...action, id: 'nope' }]) {
        expect((await h.api.get(actionPath(target))).status).toBe(404);
        expect((await edit(target, { body: 'x' })).status).toBe(404);
        expect((await approve(target)).status).toBe(404);
        expect((await reject(target)).status).toBe(404);
      }
      expect((await read(action)).status).toBe('pending');
    });
  });

  describe('approving an open PR', () => {
    let session: Session;
    let action: DraftedAction & { type: 'open_pr' };

    beforeEach(async () => {
      await saveCredential(h, seeded.workspaceId);
      session = await implement(h, seeded);
      action = await waitForAction(h, session, 'open_pr');
    });

    it('shows the head commit, the commit count, and the uncommitted files before approval', async () => {
      h.runtime.lastRun.writeFile('scratch.txt', 'left behind\n');
      const shown = await detail(h, action);
      expect(shown.action.id).toBe(action.id);
      expect(shown.transitions).toBeNull();
      expect(shown.branch).toEqual({
        headCommit: git(session.worktreePath, 'rev-parse', 'HEAD'),
        commitCount: 1,
        uncommitted: [{ path: 'scratch.txt', state: 'untracked' }],
      });
    });

    it('pushes the reviewed commit once, opens one PR with the stored text, and records the result', async () => {
      await edit(action, { title: 'Edited title', body: 'Edited body' });
      h.runtime.lastRun.writeFile('scratch.txt', 'never pushed\n');
      const head = git(session.worktreePath, 'rev-parse', 'HEAD');

      const res = await approveOpenPr(h, action);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: action.id,
        status: 'succeeded',
        error: null,
        result: { number: 1, url: 'https://github.com/acme/widgets/pull/1', commit: head },
        // What was sent stays on the record.
        payload: { title: 'Edited title', body: 'Edited body' },
      });
      expect(res.body.decidedAt).toEqual(expect.any(String));
      expect(res.body.dispatchedAt).toEqual(expect.any(String));

      expect(h.host.pushes).toEqual([
        {
          // The linked clone, not the worktree, and GitHub's own address for the repo.
          repoPath: seeded.clone,
          target: { owner: 'acme', repo: 'widgets' },
          branch: session.branch,
          commit: head,
          token: WORKSPACE_TOKEN,
        },
      ]);
      expect(h.host.pullRequests).toHaveLength(1);
      expect(h.host.pullRequests[0]).toMatchObject({
        target: { owner: 'acme', repo: 'widgets' },
        headBranch: session.branch,
        baseBranch: 'main',
        title: 'Edited title',
        body: 'Edited body',
      });
      // Nothing was committed for the session: its stray file is still uncommitted.
      expect(git(session.worktreePath, 'rev-parse', 'HEAD')).toBe(head);
      expect(git(session.worktreePath, 'status', '--porcelain')).toContain('scratch.txt');
    });

    it('works after the worktree was removed', async () => {
      await h.api.delete(
        `/workspaces/${seeded.workspaceId}/sessions/${session.id}/worktree?force=true`,
      );
      const shown = await detail(h, action);
      expect(shown.branch).toMatchObject({ commitCount: 1, uncommitted: null });
      const res = await approveOpenPr(h, action);
      expect(res.body.status).toBe('succeeded');
      expect(h.host.pushes[0]!.commit).toBe(shown.branch!.headCommit);
    });

    it('refuses without a head commit, and leaves the action as it was', async () => {
      for (const body of [{}, { expectedHeadCommit: '' }, { expectedHeadCommit: 5 }]) {
        const res = await approve(action, body);
        expect(res.status).toBe(422);
        expect(res.body.code).toBe('VALIDATION_FAILED');
      }
      expect(await read(action)).toMatchObject({ status: 'pending', decidedAt: null });
      expect(h.host.pushes).toHaveLength(0);
    });

    it('refuses a head commit the branch is not at', async () => {
      const res = await approve(action, { expectedHeadCommit: session.baseCommit });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('ACTION_STALE');
      expect((await read(action)).status).toBe('pending');
      expect(h.host.pushes).toHaveLength(0);
    });

    it('refuses when the branch moved between the read and the approval', async () => {
      const shown = (await detail(h, action)).branch!;
      h.runtime.lastRun.writeFile('late.txt', 'not reviewed\n');
      h.runtime.lastRun.commit('Late work');

      const res = await approve(action, { expectedHeadCommit: shown.headCommit });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('ACTION_STALE');
      expect(h.host.pushes).toHaveLength(0);
      expect((await read(action)).status).toBe('pending');

      // Read again, and the approval goes through with what is there now.
      const again = await approveOpenPr(h, action);
      expect(again.body.status).toBe('succeeded');
      expect(h.host.pushes[0]!.commit).toBe(git(session.worktreePath, 'rev-parse', 'HEAD'));
    });

    it('refuses while the session is running', async () => {
      const head = (await detail(h, action)).branch!.headCommit;
      await sendMessage(h, session);
      const res = await approve(action, { expectedHeadCommit: head });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('SESSION_ACTIVE');
      expect(h.host.pushes).toHaveLength(0);
      expect((await read(action)).status).toBe('pending');
      h.runtime.lastRun.ended('success');
      await waitForSession(h, session, (s) => s.status === 'ended');
    });

    it('refuses when the workspace has no GitHub credential', async () => {
      await h.api.delete(`/workspaces/${seeded.workspaceId}/github-credential`);
      const res = await approveOpenPr(h, action);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('CREDENTIAL_NOT_SET');
      expect((await read(action)).status).toBe('pending');
      expect(h.host.pushes).toHaveLength(0);
    });

    it('stays possible when the ticket source is disconnected', async () => {
      await h.api.delete(`/workspaces/${seeded.workspaceId}/sources/${seeded.sourceId}`);
      const res = await approveOpenPr(h, action);
      expect(res.body.status).toBe('succeeded');
      expect(h.tracker.source().calls.get).toBe(1);
    });

    it('dispatches once when approved twice at the same time', async () => {
      const head = (await detail(h, action)).branch!.headCommit;
      const both = await Promise.all([
        approve(action, { expectedHeadCommit: head }),
        approve(action, { expectedHeadCommit: head }),
      ]);
      expect(both.map((res) => res.status).sort()).toEqual([200, 409]);
      expect(both.find((res) => res.status === 409)!.body.code).toBe('ACTION_ALREADY_DECIDED');
      expect(both.find((res) => res.status === 200)!.body.status).toBe('succeeded');
      expect(h.host.pushes).toHaveLength(1);
      expect(h.host.created).toBe(1);
    });

    it("can't approve, reject, or edit an action that succeeded", async () => {
      await approveOpenPr(h, action);
      for (const res of [
        await approveOpenPr(h, action),
        await reject(action),
        await edit(action, { title: 'x' }),
      ]) {
        expect(res.status).toBe(409);
        expect(res.body.code).toBe('ACTION_ALREADY_DECIDED');
      }
      expect(h.host.pushes).toHaveLength(1);
    });
  });

  describe('a failed dispatch', () => {
    let session: Session;
    let action: DraftedAction & { type: 'open_pr' };

    beforeEach(async () => {
      await saveCredential(h, seeded.workspaceId);
      session = await implement(h, seeded);
      action = await waitForAction(h, session, 'open_pr');
    });

    it('is a 200 with the action failed and its redacted error, and can be approved again', async () => {
      h.host.failNext.push = new RepoHostRejectedError(
        `GitHub refused the push made with ${WORKSPACE_TOKEN}.`,
      );
      const failed = await approveOpenPr(h, action);
      expect(failed.status).toBe(200);
      expect(failed.body).toMatchObject({ status: 'failed', result: null });
      expect(failed.body.error).toBe('GitHub refused the push made with [REDACTED].');
      expect(failed.body.dispatchedAt).toEqual(expect.any(String));
      expect(h.host.pullRequests).toHaveLength(0);
      expect(lines.join('\n')).not.toContain(WORKSPACE_TOKEN);

      // A failed action can still be edited before it's approved again.
      expect((await edit(action, { title: 'Second try' })).status).toBe(200);
      const retried = await approveOpenPr(h, action);
      expect(retried.body).toMatchObject({ status: 'succeeded', error: null });
      expect(h.host.pullRequests[0]!.title).toBe('Second try');
    });

    it('marks the workspace credential as failing when GitHub rejects it, and working again after', async () => {
      const credential = async () =>
        (await h.api.get(`/workspaces/${seeded.workspaceId}/github-credential`)).body;
      h.host.rejectingToken = true;
      const failed = await approveOpenPr(h, action);
      expect(failed.body).toMatchObject({
        status: 'failed',
        error: 'GitHub rejected the credential.',
      });
      expect(await credential()).toMatchObject({
        isSet: true,
        state: 'auth_failed',
        message: 'GitHub rejected the credential.',
      });

      h.host.rejectingToken = false;
      expect((await approveOpenPr(h, action)).body.status).toBe('succeeded');
      expect(await credential()).toMatchObject({ state: 'ok', message: null });
    });

    it('leaves the credential alone for a failure that is not about it', async () => {
      h.host.failNext.push = new RepoHostUnavailableError("GitHub can't be reached for the push.");
      expect((await approveOpenPr(h, action)).body.status).toBe('failed');
      const credential = await h.api.get(`/workspaces/${seeded.workspaceId}/github-credential`);
      expect(credential.body.state).toBe('ok');
    });

    it('finishes the job when the push worked and the PR did not: one PR, no orphan', async () => {
      h.host.failNext.pullRequest = new RepoHostUnavailableError('GitHub returned an error (502).');
      const failed = await approveOpenPr(h, action);
      expect(failed.body.status).toBe('failed');
      expect(failed.body.error).toContain(`The branch ${session.branch} was pushed`);
      expect(failed.body.error).toContain('GitHub returned an error (502).');
      expect(h.host.pullRequests).toHaveLength(0);

      const retried = await approveOpenPr(h, action);
      expect(retried.body.status).toBe('succeeded');
      expect(h.host.created).toBe(1);
      expect(h.host.pushes.map((push) => push.commit)).toEqual([
        retried.body.result.commit,
        retried.body.result.commit,
      ]);
    });

    it('adopts a PR that is already open for the branch', async () => {
      const head = (await detail(h, action)).branch!.headCommit;
      const existing = await h.host.openPullRequest({
        target: { owner: 'acme', repo: 'widgets' },
        headBranch: session.branch,
        baseBranch: 'main',
        title: 'Opened before the restart',
        body: '',
        token: WORKSPACE_TOKEN,
      });
      const res = await approve(action, { expectedHeadCommit: head });
      expect(res.body).toMatchObject({
        status: 'succeeded',
        result: { ...existing, commit: head },
      });
      expect(h.host.created).toBe(1);
    });

    it('can be rejected, and is then never dispatched', async () => {
      h.host.failNext.push = new RepoHostUnavailableError('down');
      await approveOpenPr(h, action);
      const rejected = await reject(action);
      expect(rejected.status).toBe(200);
      expect(rejected.body.status).toBe('rejected');
      const again = await approveOpenPr(h, action);
      expect(again.status).toBe(409);
      expect(h.host.pushes).toHaveLength(1);
    });

    it('shows as failed, with a note to check GitHub, when the server stopped mid-dispatch', async () => {
      let release: () => void = () => undefined;
      h.host.pushGate = new Promise((resolve) => (release = resolve));
      const pending = approveOpenPr(h, action).then((res) => res);
      const deadline = Date.now() + 5000;
      while ((await read(action)).status !== 'dispatching') {
        if (Date.now() > deadline) throw new Error('The dispatch never started.');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      // A second server on the same database stands for the one that starts after a crash.
      const restarted = await createHarness();
      try {
        const after = (await restarted.api.get(actionPath(action))).body.action as DraftedAction;
        expect(after.status).toBe('failed');
        expect(after.error).toContain('The server stopped during the dispatch');
        expect(after.error).toContain('Check GitHub');
      } finally {
        await restarted.close();
      }

      release();
      h.host.pushGate = null;
      // The interrupted dispatch can't overwrite what the restart recorded.
      expect((await pending).body.status).toBe('failed');
      expect((await approveOpenPr(h, action)).body.status).toBe('succeeded');
      expect(h.host.created).toBe(1);
    });
  });

  describe('ticket comments and status changes', () => {
    it("posts an approved comment to a connected source, with that source's credential", async () => {
      await giveSourceCredential();
      const action = await waitForAction(h, await review(), 'ticket_comment');
      await edit(action, { body: 'The review, edited.' });
      const res = await approve(action);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'succeeded', error: null });
      expect(res.body.result.url).toContain('comment-1');
      expect(h.tracker.source().comments).toEqual([{ key: KEY, body: 'The review, edited.' }]);
      expect(h.tracker.source().lastToken).toBe(SOURCE_TOKEN);
      // The workspace's own credential plays no part.
      expect(h.host.verifications).toHaveLength(0);
    });

    it('fails, with the reason, for a source that has no credential', async () => {
      const action = await waitForAction(h, await review(), 'ticket_comment');
      const res = await approve(action);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('failed');
      expect(res.body.error).toContain('acme/widgets has no credential');
      expect(h.tracker.source().comments).toEqual([]);
    });

    it('fails, with the reason, for a disconnected source, and sends nothing', async () => {
      await giveSourceCredential();
      const action = await waitForAction(h, await review(), 'ticket_comment');
      await h.api.delete(`/workspaces/${seeded.workspaceId}/sources/${seeded.sourceId}`);
      const res = await approve(action);
      expect(res.body.status).toBe('failed');
      expect(res.body.error).toContain('acme/widgets is disconnected');
      expect(h.tracker.source().comments).toEqual([]);
    });

    it("marks the source's credential as failing when the tracker rejects it", async () => {
      await giveSourceCredential();
      const action = await waitForAction(h, await review(), 'ticket_comment');
      h.tracker.source().writeFailure = new TrackerAuthError(
        "GitHub rejected this source's credential.",
      );
      const res = await approve(action);
      expect(res.body).toMatchObject({
        status: 'failed',
        error: "GitHub rejected this source's credential.",
      });
      const source = (await h.api.get(`/workspaces/${seeded.workspaceId}/sources`)).body.find(
        (item: { id: string }) => item.id === seeded.sourceId,
      );
      expect(source.credential).toMatchObject({ isSet: true, state: 'auth_failed' });

      h.tracker.source().writeFailure = null;
      expect((await approve(action)).body.status).toBe('succeeded');
    });

    describe('on a built-in ticket', () => {
      let builtIn: Seeded;
      const builtInTicket = async () =>
        (await h.api.get(`${ticketPath(builtIn, 'T-1')}`)).body as Ticket;
      const comments = async () =>
        (await h.api.get(`/workspaces/${builtIn.workspaceId}/built-in-tickets/T-1/comments`)).body;

      beforeEach(async () => {
        builtIn = await seedBuiltIn(h);
      });

      it('shows an approved comment on the ticket, with no address to link to', async () => {
        const session = await completeSession(h, builtIn, 'code_review', {
          key: 'T-1',
          content: '# Review\n\nFine.',
        });
        const action = await waitForAction(h, session, 'ticket_comment');
        expect(await comments()).toEqual([]);
        const res = await approve(action);
        expect(res.body).toMatchObject({ status: 'succeeded', result: { url: null } });
        expect(await comments()).toMatchObject([{ body: '# Review\n\nFine.' }]);
      });

      it('drafts a move to In review once the PR is open, and approving it moves the ticket', async () => {
        await saveCredential(h, builtIn.workspaceId);
        const session = await implement(h, builtIn, { key: 'T-1' });
        const pr = await waitForAction(h, session, 'open_pr');
        expect(await sessionActions(h, session)).toHaveLength(1);
        await approveOpenPr(h, pr);

        const move = await waitForAction(h, session, 'ticket_transition');
        expect(move).toMatchObject({
          sessionId: session.id,
          ticketKey: 'T-1',
          status: 'pending',
          payload: { toStatus: 'In review' },
        });
        const shown = await detail(h, move);
        expect(shown.branch).toBeNull();
        expect(shown.transitions).toEqual([
          { status: 'In progress', category: 'in_progress' },
          { status: 'In review', category: 'in_progress' },
          { status: 'Done', category: 'done' },
          { status: 'Cancelled', category: 'done' },
        ]);
        // Approving the PR did not move the ticket.
        expect((await builtInTicket()).status).toBe('To do');

        const res = await approve(move);
        expect(res.body).toMatchObject({ status: 'succeeded', result: { status: 'In review' } });
        expect((await builtInTicket()).status).toBe('In review');
      });

      it('moves the ticket to another status the developer picked', async () => {
        await saveCredential(h, builtIn.workspaceId);
        const session = await implement(h, builtIn, { key: 'T-1' });
        await approveOpenPr(h, await waitForAction(h, session, 'open_pr'));
        const move = await waitForAction(h, session, 'ticket_transition');
        expect((await edit(move, { body: 'x' })).status).toBe(422);
        expect((await edit(move, { toStatus: 'Done' })).body.payload).toEqual({ toStatus: 'Done' });
        expect((await approve(move)).body.result).toEqual({ status: 'Done' });
        expect((await builtInTicket()).status).toBe('Done');
      });

      it("fails with the tracker's reason when the ticket can no longer move there", async () => {
        await saveCredential(h, builtIn.workspaceId);
        const session = await implement(h, builtIn, { key: 'T-1' });
        await approveOpenPr(h, await waitForAction(h, session, 'open_pr'));
        const move = await waitForAction(h, session, 'ticket_transition');
        // The developer moved it by hand in the meantime.
        await h.api
          .patch(`/workspaces/${builtIn.workspaceId}/built-in-tickets/T-1`)
          .send({ status: 'in_review' });
        const res = await approve(move);
        expect(res.body.status).toBe('failed');
        expect(res.body.error).toContain(`can't move to "In review"`);
      });

      it('drafts no move when the ticket is already in review', async () => {
        await saveCredential(h, builtIn.workspaceId);
        await h.api
          .patch(`/workspaces/${builtIn.workspaceId}/built-in-tickets/T-1`)
          .send({ status: 'in_review' });
        const session = await implement(h, builtIn, { key: 'T-1' });
        await approveOpenPr(h, await waitForAction(h, session, 'open_pr'));
        const actions = await settledActions(h, session);
        expect(actions.map((item) => item.type)).toEqual(['open_pr']);
      });
    });

    it('drafts no move for a GitHub issue, which has no In review status', async () => {
      await saveCredential(h, seeded.workspaceId);
      const session = await implement(h, seeded);
      const res = await approveOpenPr(h, await waitForAction(h, session, 'open_pr'));
      expect(res.body.status).toBe('succeeded');
      expect((await settledActions(h, session)).map((item) => item.type)).toEqual(['open_pr']);
    });
  });

  it('never dispatches an action that was not approved (FR-27)', async () => {
    await saveCredential(h, seeded.workspaceId);
    await giveSourceCredential();
    h.host.verifications.length = 0;
    const builtIn = await seedBuiltIn(h);
    await saveCredential(h, builtIn.workspaceId);
    h.host.verifications.length = 0;

    const implemented = await implement(h, seeded);
    const pr = await waitForAction(h, implemented, 'open_pr');
    const comment = await waitForAction(h, await review(), 'ticket_comment');
    const builtInSession = await completeSession(h, builtIn, 'code_review', { key: 'T-1' });
    const builtInComment = await waitForAction(h, builtInSession, 'ticket_comment');

    // Drafted and read, edited, rejected, and redrafted by a later round: none of it is approval.
    await detail(h, pr);
    await edit(pr, { title: 'Edited, not approved' });
    await reject(comment);
    await edit(builtInComment, { body: 'Edited, not approved' });
    await followUp(implemented, '# Second report');
    await inbox();
    expect((await approve(comment)).status).toBe(409);
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(h.host.pushes).toEqual([]);
    expect(h.host.pullRequests).toEqual([]);
    expect(h.host.verifications).toEqual([]);
    expect(h.host.branches.size).toBe(0);
    expect(h.tracker.source().comments).toEqual([]);
    expect(h.tracker.source().moves).toEqual([]);
    const builtInComments = await h.api.get(
      `/workspaces/${builtIn.workspaceId}/built-in-tickets/T-1/comments`,
    );
    expect(builtInComments.body).toEqual([]);
    expect((await read(pr)).status).toBe('pending');
    expect((await read(comment)).status).toBe('rejected');
  });

  describe('the approvals inbox', () => {
    it('lists pending and failed actions of this workspace, newest first', async () => {
      await saveCredential(h, seeded.workspaceId);
      const first = await waitForAction(h, await implement(h, seeded), 'open_pr');
      const second = await waitForAction(h, await review(), 'ticket_comment');
      const rejected = await waitForAction(h, await review(), 'ticket_comment');
      const sent = await waitForAction(h, await implement(h, seeded), 'open_pr');
      await reject(rejected);
      await approveOpenPr(h, sent);
      // No credential on the source, so this one fails and stays in the list.
      await approve(second);

      const res = await inbox();
      expect(res.status).toBe(200);
      expect(res.body.map((item: DraftedAction) => [item.id, item.status])).toEqual([
        [second.id, 'failed'],
        [first.id, 'pending'],
      ]);
      expect(res.body[1]).toMatchObject({
        type: 'open_pr',
        ticketKey: KEY,
        ticketTitle: first.ticketTitle,
        phase: 'implementation',
        sessionId: first.sessionId,
      });
    });

    it('honors the status filter, and refuses a status it does not know', async () => {
      await saveCredential(h, seeded.workspaceId);
      const sent = await waitForAction(h, await implement(h, seeded), 'open_pr');
      const rejected = await waitForAction(h, await review(), 'ticket_comment');
      const waiting = await waitForAction(h, await review(), 'ticket_comment');
      await approveOpenPr(h, sent);
      await reject(rejected);

      const ids = async (query: string) =>
        ((await inbox(seeded.workspaceId, query)).body as DraftedAction[]).map((item) => item.id);
      expect(await ids('?status=succeeded')).toEqual([sent.id]);
      expect(await ids('?status=rejected&status=pending')).toEqual([waiting.id, rejected.id]);
      expect(await ids('?status=dispatching')).toEqual([]);

      const bad = await inbox(seeded.workspaceId, '?status=pending&status=sideways');
      expect(bad.status).toBe(422);
      expect(bad.body.code).toBe('VALIDATION_FAILED');
    });

    it("shows only its own workspace's actions", async () => {
      await waitForAction(h, await review(), 'ticket_comment');
      const builtIn = await seedBuiltIn(h);
      expect((await inbox(builtIn.workspaceId)).body).toEqual([]);
      expect((await inbox()).body).toHaveLength(1);
      expect((await inbox(UNKNOWN)).status).toBe(404);
    });

    it("lists a session's actions in every status, oldest first, and 404s for a session elsewhere", async () => {
      const session = await review();
      const first = await waitForAction(h, session, 'ticket_comment');
      await reject(first);
      await followUp(session, '# Review, again', false);
      const second = await waitForAction(h, session, 'ticket_comment', (a) => a.id !== first.id);
      expect((await sessionActions(h, session)).map((item) => [item.id, item.status])).toEqual([
        [first.id, 'rejected'],
        [second.id, 'pending'],
      ]);

      const builtIn = await seedBuiltIn(h);
      const elsewhere = `/workspaces/${builtIn.workspaceId}/sessions/${session.id}/drafted-actions`;
      expect((await h.api.get(elsewhere)).status).toBe(404);
      const unknown = `/workspaces/${seeded.workspaceId}/sessions/${UNKNOWN}/drafted-actions`;
      expect((await h.api.get(unknown)).status).toBe(404);
    });
  });

  describe('on the status stream', () => {
    /** Collects every `drafted_action_updated` frame a workspace's stream sends. */
    async function listen(workspaceId: string) {
      const controller = new AbortController();
      const response = await fetch(`${baseUrl}/workspaces/${workspaceId}/session-updates`, {
        headers: { authorization: `Bearer ${await signToken()}` },
        signal: controller.signal,
      });
      const frames: DraftedAction[] = [];
      let raw = '';
      void (async () => {
        const decoder = new TextDecoder();
        let buffer = '';
        try {
          for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
            const text = decoder.decode(chunk, { stream: true });
            raw += text;
            buffer += text;
            let end: number;
            while ((end = buffer.indexOf('\n\n')) !== -1) {
              const frame = buffer.slice(0, end).split('\n');
              buffer = buffer.slice(end + 2);
              if (!frame.includes('event: drafted_action_updated')) continue;
              const data = frame.find((line) => line.startsWith('data: '))!;
              frames.push(JSON.parse(data.slice('data: '.length)) as DraftedAction);
            }
          }
        } catch {
          // Aborted by the test.
        }
      })();
      const until = async (count: number) => {
        const deadline = Date.now() + 3000;
        while (frames.length < count) {
          if (Date.now() > deadline)
            throw new Error(`Only ${frames.length} action frames arrived.`);
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        return frames;
      };
      return { frames, until, raw: () => raw, close: () => controller.abort() };
    }

    it('sends every change to an action as its own frame, to its workspace only', async () => {
      await saveCredential(h, seeded.workspaceId);
      const builtIn = await seedBuiltIn(h);
      const mine = await listen(seeded.workspaceId);
      const theirs = await listen(builtIn.workspaceId);
      try {
        const session = await implement(h, seeded);
        const action = await waitForAction(h, session, 'open_pr');
        await edit(action, { title: 'Edited' });
        h.host.failNext.push = new RepoHostAuthError(`Rejected ${WORKSPACE_TOKEN}`);
        await approveOpenPr(h, action);
        await approveOpenPr(h, action);
        const comment = await waitForAction(h, await review(), 'ticket_comment');
        await reject(comment);

        const frames = await mine.until(8);
        expect(frames.map((frame) => [frame.type, frame.status, frame.edited])).toEqual([
          ['open_pr', 'pending', false],
          ['open_pr', 'pending', true],
          ['open_pr', 'dispatching', true],
          ['open_pr', 'failed', true],
          ['open_pr', 'dispatching', true],
          ['open_pr', 'succeeded', true],
          ['ticket_comment', 'pending', false],
          ['ticket_comment', 'rejected', false],
        ]);
        // A frame carries the full action, as the API returns it.
        expect(frames[5]).toEqual((await detail(h, action)).action);
        expect(frames[3]!.error).toBe('Rejected [REDACTED]');
        expect(mine.raw()).not.toContain(WORKSPACE_TOKEN);
        expect(mine.raw()).toContain('event: session_updated');
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(theirs.frames).toEqual([]);
      } finally {
        mine.close();
        theirs.close();
      }
    });
  });

  it('keeps a stored credential out of everything the workspace records (NFR-4)', async () => {
    const CANARY = 'ghp_NFR4_canary_saved_as_a_credential';
    await saveCredential(h, seeded.workspaceId, CANARY);
    h.tracker.add(ticket(KEY, { title: `Rotate ${CANARY}`, body: `The token ${CANARY} leaked.` }));
    const investigated = await completeSession(h, seeded, 'investigation', {
      content: `# Findings\n\nFound ${CANARY} in a config file.`,
    });
    const session = await implement(h, seeded, { report: `# Report\n\nRemoved ${CANARY}.` });
    const action = await waitForAction(h, session, 'open_pr');
    await edit(action, { body: `Edited, still mentions ${CANARY}.` });
    h.host.failNext.push = new RepoHostAuthError(`remote: invalid credentials for ${CANARY}`);
    const failed = await approveOpenPr(h, action);
    const sent = await approveOpenPr(h, action);
    expect(sent.body.status).toBe('succeeded');
    // The token itself was used, and only where it belongs.
    expect(h.host.pushes.at(-1)!.token).toBe(CANARY);

    const ws = `/workspaces/${seeded.workspaceId}`;
    const everything = JSON.stringify([
      failed.body,
      sent.body,
      await sessionActions(h, session),
      (await inbox(seeded.workspaceId, '?status=succeeded&status=failed')).body,
      (await h.api.get(`${ws}/sessions/${session.id}`)).body,
      (await h.api.get(`${ws}/sessions/${investigated.id}/artifact`)).body,
      (await h.api.get(`${ws}/sessions/${session.id}/artifact`)).body,
      (await h.api.get(`${ws}/github-credential`)).body,
      (await h.api.get(`${ws}/sources`)).body,
      (await h.api.get(`${ticketPath(seeded)}/sessions`)).body,
      h.runtime.starts,
      lines,
    ]);
    expect(everything).not.toContain(CANARY);
    expect(everything).toContain('[REDACTED]');
    // The context file a later session was given, on disk in its worktree.
    expect(
      readFileSync(join(session.worktreePath, '.slop/context/investigation.md'), 'utf8'),
    ).not.toContain(CANARY);
    expect(git(seeded.clone, 'config', '--list')).not.toContain(CANARY);
  });
});

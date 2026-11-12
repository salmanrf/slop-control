import type { BuiltInTicketComment, TicketSource } from '@slop-control/shared';
import { TrackerAuthError } from '../src/tickets/tracker';
import { BuiltInTracker } from '../src/tickets/built-in-tracker';
import { GitHubIssuesAdapter } from '../src/tickets/github-issues.adapter';
import { FakeTracker, ticket } from './support/fake-tracker';
import { GitHubStub } from './support/github-stub';
import { createTestApp, resetDatabase } from './support/test-app';
import { describeTrackerContract } from './support/tracker-contract';

const SOURCE_ID = '22222222-0000-4000-8000-000000000000';
/** Seeds are oldest first, a minute apart. */
const updatedAt = (index: number) => new Date(Date.UTC(2026, 10, 1, 10, index)).toISOString();

describeTrackerContract('GitHub Issues over stubbed HTTP', async () => {
  const stub = new GitHubStub();
  const apiUrl = await stub.start();
  return {
    sourceId: SOURCE_ID,
    hasInProgress: false,
    missingKey: 'acme/widgets#9999',
    seed: async (seeds) => {
      stub.issues = seeds.map((seed, index) => ({
        number: index + 1,
        title: seed.title,
        body: seed.body,
        state: seed.category === 'done' ? 'closed' : 'open',
        updated_at: updatedAt(index),
      }));
      return new GitHubIssuesAdapter('acme', 'widgets', {
        token: 'ghp_contract_token',
        apiUrl,
        sourceId: SOURCE_ID,
      });
    },
    comments: async (key) =>
      stub.comments
        .filter((comment) => `acme/widgets#${comment.issue}` === key)
        .map((comment) => comment.body),
    rejected: async () => {
      stub.requiredToken = 'ghp_contract_token';
      return new GitHubIssuesAdapter('acme', 'widgets', {
        token: 'ghp_a_revoked_token',
        apiUrl,
        sourceId: SOURCE_ID,
      });
    },
    close: () => stub.stop(),
  };
});

describeTrackerContract('the built-in tracker', async () => {
  await resetDatabase();
  const t = await createTestApp();
  const workspaceId = (await t.api.post('/workspaces').send({ name: 'contract' })).body.id;
  const source = (
    (await t.api.get(`/workspaces/${workspaceId}/sources`)).body as TicketSource[]
  )[0]!;
  const STATUS = { open: 'todo', in_progress: 'in_review', done: 'done' } as const;
  return {
    sourceId: source.id,
    hasInProgress: true,
    missingKey: 'T-9999',
    seed: async (seeds) => {
      // Created one after another, so a later seed is the more recently updated.
      for (const seed of seeds) {
        const created = await t.api
          .post(`/workspaces/${workspaceId}/built-in-tickets`)
          .send({ title: seed.title, body: seed.body });
        if (seed.category !== 'open') {
          await t.api
            .patch(`/workspaces/${workspaceId}/built-in-tickets/${created.body.key}`)
            .send({ status: STATUS[seed.category] });
        }
      }
      return t.app.get(BuiltInTracker).adapterFor(source);
    },
    comments: async (key) =>
      (
        (await t.api.get(`/workspaces/${workspaceId}/built-in-tickets/${key}/comments`))
          .body as BuiltInTicketComment[]
      ).map((comment) => comment.body),
    close: () => t.close(),
  };
});

let held = new FakeTracker();

describeTrackerContract('FakeTracker', async () => ({
  sourceId: SOURCE_ID,
  hasInProgress: true,
  missingKey: 'acme/widgets#9999',
  seed: async (seeds) => {
    const tracker = new FakeTracker();
    held = tracker;
    tracker.add(
      ...seeds.map((seed, index) =>
        ticket(`acme/widgets#${index + 1}`, {
          title: seed.title,
          body: seed.body,
          status: seed.category,
          statusCategory: seed.category,
          updatedAt: updatedAt(index),
        }),
      ),
    );
    return tracker.source().adapter(SOURCE_ID);
  },
  comments: async (key) =>
    held
      .source()
      .comments.filter((comment) => comment.key === key)
      .map((comment) => comment.body),
  rejected: async () => {
    const refusing = new FakeTracker();
    refusing.add(...held.tickets.values());
    refusing.source().writeFailure = new TrackerAuthError('rejected');
    return refusing.source().adapter(SOURCE_ID);
  },
}));

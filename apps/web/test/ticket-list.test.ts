import type { SourceListStatus, TicketSource, TicketSummary } from '@slop-control/shared';
import { describe, expect, it } from 'vitest';
import { mergeTicketPages, sourceProblems, sourcesNotLimitedToMe } from '../src/lib/ticket-list';

const ticket = (sourceId: string, key: string, title = key): TicketSummary => ({
  sourceId,
  key,
  title,
  status: 'open',
  statusCategory: 'open',
  url: null,
  updatedAt: '2026-11-10T10:00:00Z',
});

const source = (id: string, label: string): TicketSource =>
  ({ id, label, type: id === 'built' ? 'built_in' : 'github_issues' }) as TicketSource;

const status = (
  sourceId: string,
  state: SourceListStatus['state'] = 'ok',
  overrides: Partial<SourceListStatus> = {},
): SourceListStatus => ({ sourceId, state, message: null, mineApplied: true, ...overrides });

const SOURCES = [source('built', 'Built-in'), source('gh', 'acme/widgets')];

describe('mergeTicketPages', () => {
  it('keeps the order across pages', () => {
    const merged = mergeTicketPages([
      [ticket('gh', 'a'), ticket('built', 'T-1')],
      [ticket('gh', 'b')],
    ]);
    expect(merged.map((item) => item.key)).toEqual(['a', 'T-1', 'b']);
  });

  it('drops a ticket that comes back on a later page, keeping the first one seen', () => {
    const merged = mergeTicketPages([
      [ticket('gh', 'a', 'first'), ticket('gh', 'b')],
      [ticket('gh', 'a', 'again'), ticket('gh', 'c')],
    ]);
    expect(merged.map((item) => item.key)).toEqual(['a', 'b', 'c']);
    expect(merged[0]?.title).toBe('first');
  });

  it('keeps the same key from two sources as two tickets', () => {
    const merged = mergeTicketPages([[ticket('gh', 'T-1')], [ticket('built', 'T-1')]]);
    expect(merged.map((item) => item.sourceId)).toEqual(['gh', 'built']);
  });
});

describe('sourceProblems', () => {
  it('is empty when every source listed', () => {
    expect(sourceProblems([status('built'), status('gh')], SOURCES)).toEqual([]);
  });

  it('reports only the failing source, by its label', () => {
    const problems = sourceProblems(
      [status('built'), status('gh', 'auth_failed', { message: 'GitHub rejected the token.' })],
      SOURCES,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({
      sourceId: 'gh',
      label: 'acme/widgets',
      kind: 'auth_failed',
    });
    expect(problems[0]?.message).toContain('GitHub rejected the token.');
  });

  it('tells a rejected sign-in from an unreachable tracker', () => {
    const [auth] = sourceProblems([status('gh', 'auth_failed')], SOURCES);
    const [down] = sourceProblems([status('gh', 'unavailable')], SOURCES);
    expect(auth?.kind).toBe('auth_failed');
    expect(auth?.message).toContain('sign-in failed');
    expect(down?.kind).toBe('unavailable');
    expect(down?.message).toContain('unavailable');
  });

  it('reports a source once when it fails on several pages', () => {
    const problems = sourceProblems(
      [status('gh', 'unavailable'), status('gh', 'unavailable')],
      SOURCES,
    );
    expect(problems).toHaveLength(1);
  });
});

describe('sourcesNotLimitedToMe', () => {
  it("names the sources that listed everyone's tickets", () => {
    expect(
      sourcesNotLimitedToMe([status('built'), status('gh', 'ok', { mineApplied: false })], SOURCES),
    ).toEqual(['acme/widgets']);
  });

  it('leaves out a source that failed', () => {
    expect(
      sourcesNotLimitedToMe([status('gh', 'unavailable', { mineApplied: false })], SOURCES),
    ).toEqual([]);
  });
});

import type { ArtifactStatus, Phase } from '@slop-control/shared';
import { suggestNextPhase } from '../src/sessions/next-phase';

type Entry = [Phase, ArtifactStatus | null];

const complete = (...phases: Phase[]): Entry[] => phases.map((phase) => [phase, 'complete']);
const sessions = (entries: Entry[]) =>
  entries.map(([phase, artifactStatus]) => ({ phase, artifactStatus }));

describe('suggestNextPhase', () => {
  it.each<[string, Entry[], Phase | null]>([
    ['no sessions', [], 'investigation'],
    ['investigation complete', complete('investigation'), 'planning'],
    [
      'investigation and planning complete',
      complete('investigation', 'planning'),
      'implementation',
    ],
    [
      'everything through implementation complete, skipping the testing phases',
      complete('investigation', 'planning', 'implementation'),
      'code_review',
    ],
    [
      'code review complete',
      complete('investigation', 'planning', 'implementation', 'code_review'),
      null,
    ],
    ['only planning complete, investigation skipped', complete('planning'), 'implementation'],
    [
      'investigation sessions that are incomplete or still running, none complete',
      [
        ['investigation', 'incomplete'],
        ['investigation', 'incomplete'],
        ['investigation', null],
      ],
      'investigation',
    ],
    [
      'investigation complete, planning incomplete',
      [...complete('investigation'), ['planning', 'incomplete']],
      'planning',
    ],
    [
      'investigation complete and another session running',
      [...complete('investigation'), ['implementation', null]],
      'planning',
    ],
    [
      'code review complete, then a later implementation complete',
      [...complete('implementation'), ...complete('code_review', 'implementation')],
      null,
    ],
  ])('with %s', (_name, entries, expected) => {
    expect(suggestNextPhase(sessions(entries)).phase).toBe(expected);
  });

  it.each<[Phase, string]>([
    ['investigation', 'Investigation'],
    ['planning', 'Planning'],
    ['implementation', 'Implementation'],
  ])('gives a one-line reason naming %s as done', (phase, label) => {
    const { phase: next, reason } = suggestNextPhase(sessions(complete(phase)));
    expect(next).not.toBeNull();
    expect(reason).toContain(label);
    expect(reason.trim()).not.toBe('');
    expect(reason).not.toContain('\n');
  });

  it('still gives a reason when nothing is done, and when code review is', () => {
    expect(suggestNextPhase([]).reason.trim()).not.toBe('');
    expect(suggestNextPhase(sessions(complete('code_review'))).reason).toContain('Code review');
  });

  it("isn't moved on by a testing phase, which can't be launched", () => {
    const entries: Entry[] = [...complete('investigation'), ['e2e_testing', 'complete']];
    expect(suggestNextPhase(sessions(entries)).phase).toBe('planning');
  });
});

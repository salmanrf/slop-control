import type { DiffFile } from '@slop-control/shared';
import { describe, expect, it } from 'vitest';
import {
  diffFileCounts,
  diffFileHeader,
  diffLines,
  diffOmission,
  diffStatusLabel,
  diffSummary,
  uncommittedLabel,
} from '../src/lib/diff-view';

const file = (overrides: Partial<DiffFile>): DiffFile => ({
  path: 'src/a.ts',
  previousPath: null,
  status: 'modified',
  additions: 3,
  deletions: 1,
  binary: false,
  patch: '@@ -1 +1 @@\n-old\n+new\n',
  ...overrides,
});

describe('how a diff file is described', () => {
  it('heads a file with its path, and a renamed one with where it came from', () => {
    expect(diffFileHeader(file({}))).toBe('src/a.ts');
    expect(diffFileHeader(file({ status: 'renamed', previousPath: 'src/old.ts' }))).toBe(
      'src/old.ts → src/a.ts',
    );
  });

  it('names its status', () => {
    expect(diffStatusLabel(file({ status: 'added' }))).toBe('Added');
    expect(diffStatusLabel(file({ status: 'deleted' }))).toBe('Deleted');
  });

  it('counts added and removed lines, and none for a binary file', () => {
    expect(diffFileCounts(file({}))).toBe('+3 −1');
    expect(diffFileCounts(file({ binary: true, additions: null, deletions: null }))).toBe('Binary');
  });

  it('says why a file has no diff text', () => {
    expect(diffOmission(file({}))).toBeNull();
    expect(diffOmission(file({ binary: true, patch: null }))).toContain('Binary');
    expect(diffOmission(file({ patch: null }))).toContain('too large');
  });

  it('sums up the whole diff', () => {
    const files = [
      file({}),
      file({ path: 'logo.png', binary: true, additions: null, deletions: null }),
    ];
    expect(diffSummary({ files, commitCount: 1 })).toBe('2 files changed · +3 −1 · 1 commit');
    expect(diffSummary({ files: [file({})], commitCount: 2 })).toBe(
      '1 file changed · +3 −1 · 2 commits',
    );
    expect(diffSummary({ files: [], commitCount: 0 })).toBe('No commits and no changed files.');
  });

  it('names the state of an uncommitted file', () => {
    expect(uncommittedLabel({ state: 'untracked' })).toBe('New, untracked');
    expect(uncommittedLabel({ state: 'modified' })).toBe('Modified');
  });
});

describe('diffLines', () => {
  it('marks added, removed, and unchanged lines', () => {
    expect(diffLines('@@ -1,2 +1,2 @@\n same\n-old\n+new\n')).toEqual([
      { kind: 'hunk', text: '@@ -1,2 +1,2 @@' },
      { kind: 'context', text: ' same' },
      { kind: 'removed', text: '-old' },
      { kind: 'added', text: '+new' },
    ]);
  });

  it("leaves out git's own file header", () => {
    const patch =
      'diff --git a/src/a.ts b/src/a.ts\nindex 1..2 100644\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new\n';
    expect(diffLines(patch).map((line) => line.kind)).toEqual(['hunk', 'removed', 'added']);
  });

  it('counts a changed line that itself starts with dashes or pluses', () => {
    expect(diffLines('@@ -1 +1 @@\n--- a heading\n+++ a heading\n').map((l) => l.kind)).toEqual([
      'hunk',
      'removed',
      'added',
    ]);
  });

  it('keeps the note about a missing newline apart from the changes', () => {
    expect(
      diffLines('@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b\n').map((l) => l.kind),
    ).toEqual(['hunk', 'removed', 'note', 'added']);
  });
});

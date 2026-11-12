import type { DiffFile, SessionDiff, UncommittedFile } from '@slop-control/shared';

const STATUS_LABELS: Record<DiffFile['status'], string> = {
  added: 'Added',
  modified: 'Modified',
  deleted: 'Deleted',
  renamed: 'Renamed',
};

export const diffStatusLabel = (file: Pick<DiffFile, 'status'>) => STATUS_LABELS[file.status];

/** A renamed file names where it came from. */
export function diffFileHeader(file: Pick<DiffFile, 'path' | 'previousPath'>): string {
  return file.previousPath ? `${file.previousPath} → ${file.path}` : file.path;
}

/** "+3 −1", or "Binary" for a file git counts no lines in. */
export function diffFileCounts(file: Pick<DiffFile, 'additions' | 'deletions' | 'binary'>): string {
  if (file.binary || file.additions === null || file.deletions === null) return 'Binary';
  return `+${file.additions} −${file.deletions}`;
}

/** Why a file is listed without its lines; null when its diff text is there. */
export function diffOmission(file: Pick<DiffFile, 'binary' | 'patch'>): string | null {
  if (file.binary) return 'Binary file. Its content is not shown.';
  if (file.patch === null) return 'This diff is too large to show here.';
  return null;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** "2 files changed · +10 −4 · 3 commits"; binary files add no lines. */
export function diffSummary(diff: Pick<SessionDiff, 'files' | 'commitCount'>): string {
  if (diff.files.length === 0) {
    return diff.commitCount === 0
      ? 'No commits and no changed files.'
      : `${plural(diff.commitCount, 'commit')} · no changed files`;
  }
  const additions = diff.files.reduce((sum, file) => sum + (file.additions ?? 0), 0);
  const deletions = diff.files.reduce((sum, file) => sum + (file.deletions ?? 0), 0);
  return `${plural(diff.files.length, 'file')} changed · +${additions} −${deletions} · ${plural(diff.commitCount, 'commit')}`;
}

export type DiffLineKind = 'added' | 'removed' | 'context' | 'hunk' | 'note';

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

/**
 * Splits unified diff text into marked lines. Git's own file header is left out, since the view
 * names the file itself, and a `+` or `-` only counts as a change once a hunk has started.
 */
export function diffLines(patch: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let inHunk = false;
  for (const text of patch.replace(/\n$/, '').split('\n')) {
    if (text.startsWith('@@')) {
      inHunk = true;
      lines.push({ kind: 'hunk', text });
    } else if (!inHunk) {
      continue;
    } else if (text.startsWith('+')) {
      lines.push({ kind: 'added', text });
    } else if (text.startsWith('-')) {
      lines.push({ kind: 'removed', text });
    } else if (text.startsWith('\\')) {
      lines.push({ kind: 'note', text });
    } else {
      lines.push({ kind: 'context', text });
    }
  }
  return lines;
}

const UNCOMMITTED_LABELS: Record<UncommittedFile['state'], string> = {
  modified: 'Modified',
  added: 'Added',
  deleted: 'Deleted',
  renamed: 'Renamed',
  untracked: 'New, untracked',
};

export const uncommittedLabel = (file: Pick<UncommittedFile, 'state'>) =>
  UNCOMMITTED_LABELS[file.state];

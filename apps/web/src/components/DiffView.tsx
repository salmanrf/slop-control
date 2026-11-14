import type { DiffFile, SessionDiff, UncommittedFile } from '@slop-control/shared';
import { useQuery } from '@tanstack/react-query';
import { ApiRequestError } from '../lib/api';
import { api } from '../lib/app-api';
import {
  diffFileCounts,
  diffFileHeader,
  diffLines,
  diffOmission,
  diffStatusLabel,
  diffSummary,
  uncommittedLabel,
  type DiffLineKind,
} from '../lib/diff-view';
import { keys } from '../lib/session-cache';
import { ErrorMessage, Mono, Notice, cx } from './common';

/** One read of a session's diff, shared by the page's own view and the open PR action's. */
export function useSessionDiff(workspaceId: string, sessionId: string) {
  return useQuery({
    queryKey: keys.diff(workspaceId, sessionId),
    queryFn: () => api.getSessionDiff(workspaceId, sessionId),
    retry: false,
  });
}

/** A session's changes against the commit it started from. Read-only. */
export function SessionDiffView({
  workspaceId,
  sessionId,
}: {
  workspaceId: string;
  sessionId: string;
}) {
  const diff = useSessionDiff(workspaceId, sessionId);
  if (diff.data) return <DiffView diff={diff.data} />;
  if (diff.error instanceof ApiRequestError && diff.error.code === 'NOT_FOUND') {
    return (
      <p className="text-[13px] text-muted">
        This session's branch isn't in the clone, so its changes can't be shown.
      </p>
    );
  }
  if (diff.error) return <ErrorMessage error={diff.error} />;
  return <p className="text-[13px] text-muted">Reading the changes…</p>;
}

export function DiffView({ diff }: { diff: SessionDiff }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] text-ink-soft">
        <span data-testid="diff-summary">{diffSummary(diff)}</span>
        <span className="text-muted">
          {' '}
          · <Mono>{diff.baseCommit.slice(0, 8)}</Mono> to <Mono>{diff.headCommit.slice(0, 8)}</Mono>
        </span>
      </p>
      {diff.truncated && (
        <Notice tone="info">
          Some diff text was left out because it is too large. Every changed file is still listed.
        </Notice>
      )}
      {diff.files.length > 0 && (
        <ul aria-label="Changed files" className="flex flex-col gap-2.5">
          {diff.files.map((file) => (
            <DiffFileView key={file.path} file={file} />
          ))}
        </ul>
      )}
      {diff.uncommitted && diff.uncommitted.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-warn-line bg-warn-soft px-3 py-2.5 text-[13px] text-warn-text">
          <span>
            <strong className="font-semibold">Uncommitted files</strong> · left in the worktree, not
            on the branch, and never pushed
          </span>
          <UncommittedList label="Uncommitted files" files={diff.uncommitted} />
        </div>
      )}
    </div>
  );
}

export function UncommittedList({ label, files }: { label: string; files: UncommittedFile[] }) {
  return (
    <ul aria-label={label} className="flex flex-col gap-1 text-[13px] text-ink">
      {files.map((file) => (
        <li key={file.path} className="flex flex-wrap items-baseline gap-2">
          <Mono className="break-all">{file.path}</Mono>
          <span className="text-[12px] text-muted">{uncommittedLabel(file)}</span>
        </li>
      ))}
    </ul>
  );
}

const LINE_STYLES: Record<DiffLineKind, string> = {
  added: 'bg-ok-soft text-ok-text',
  removed: 'bg-danger-soft text-danger-text',
  context: 'text-ink-soft',
  hunk: 'bg-paper text-muted',
  note: 'text-muted',
};

function DiffFileView({ file }: { file: DiffFile }) {
  const header = diffFileHeader(file);
  const omission = diffOmission(file);
  const lines = file.patch === null ? [] : diffLines(file.patch);
  return (
    <li aria-label={header} className="overflow-hidden rounded-lg border border-line">
      <div className="flex flex-wrap items-baseline gap-2.5 bg-paper-soft px-3 py-2 text-[13px]">
        <Mono className="min-w-0 break-all font-medium text-ink">{header}</Mono>
        <span className="text-[12px] text-muted">{diffStatusLabel(file)}</span>
        <Mono className="ml-auto whitespace-nowrap text-ink-soft">{diffFileCounts(file)}</Mono>
      </div>
      {omission ? (
        <p className="border-t border-line px-3 py-2 text-[12px] text-muted">{omission}</p>
      ) : (
        lines.length > 0 && (
          <pre className="overflow-x-auto border-t border-line font-mono text-[12px] leading-[1.55]">
            {lines.map((line, index) => (
              <span
                key={index}
                data-line={line.kind}
                className={cx('block min-w-max px-3 whitespace-pre', LINE_STYLES[line.kind])}
              >
                {line.text || ' '}
              </span>
            ))}
          </pre>
        )
      )}
    </li>
  );
}

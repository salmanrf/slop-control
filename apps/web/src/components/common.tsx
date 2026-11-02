import type { ArtifactStatus, Phase, SessionStatus } from '@slop-control/shared';
import { useState } from 'react';

export function ErrorMessage({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : 'Something went wrong.';
  return (
    <p className="error" role="alert">
      {message}
    </p>
  );
}

export function StatusBadge({ status }: { status: SessionStatus }) {
  return <span className={`badge badge-${status}`}>{status}</span>;
}

export function ArtifactBadge({ status }: { status: ArtifactStatus | null }) {
  if (!status) return null;
  return <span className={`badge badge-artifact-${status}`}>{status}</span>;
}

const PHASE_LABELS: Record<Phase, string> = {
  investigation: 'Investigation',
  planning: 'Planning',
  implementation: 'Implementation',
  automated_testing: 'Automated testing',
  e2e_testing: 'E2E testing',
  code_review: 'Code review',
};

export const phaseLabel = (phase: Phase) => PHASE_LABELS[phase];

export function formatTime(value: string | null): string {
  return value ? new Date(value).toLocaleString() : '—';
}

export function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy-command">
      <code>{command}</code>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(command).then(() => setCopied(true));
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

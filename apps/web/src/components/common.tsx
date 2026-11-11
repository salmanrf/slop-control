import {
  Alert,
  Button,
  Clipboard,
  Field,
  Input,
  NativeSelect,
  Textarea,
  type ButtonProps,
} from '@chakra-ui/react';
import type { Phase, Session } from '@slop-control/shared';
import {
  useEffect,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { errorText } from '../lib/error-text';
import { sessionOutcome, phaseLabel, type Tone } from '../lib/session-view';

export const cx = (...names: (string | false | null | undefined)[]) =>
  names.filter(Boolean).join(' ');

const BUTTON_BASE =
  'inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg no-underline disabled:cursor-not-allowed disabled:opacity-60';
const BUTTON_SIZE = 'min-h-11 px-3.5 py-2.5';
const BUTTON_SIZE_COMPACT = 'min-h-9 px-3 py-2';

const BUTTON_TONES = {
  primary: 'bg-accent font-semibold text-white hover:bg-accent-hover hover:text-white',
  secondary: 'border border-field bg-white text-ink hover:bg-paper hover:text-ink',
  danger:
    'border border-danger-line bg-white text-danger-text hover:bg-danger-soft hover:text-danger-text',
  warn: 'border border-warn-line bg-warn-soft font-medium text-warn-text hover:bg-warn-line hover:text-warn-text',
  dark: 'border border-nav-line bg-transparent text-nav-text hover:bg-nav-active hover:text-nav-text',
};

export interface AppButtonProps extends ButtonProps {
  tone?: keyof typeof BUTTON_TONES;
  /** For a button inside a table row or a panel's header. */
  compact?: boolean;
}

/** Chakra supplies the behavior; the look is the design's, so its recipe is turned off. */
export function AppButton({ tone = 'secondary', compact, className, ...props }: AppButtonProps) {
  return (
    <Button
      unstyled
      type="button"
      className={cx(
        BUTTON_BASE,
        compact ? BUTTON_SIZE_COMPACT : BUTTON_SIZE,
        BUTTON_TONES[tone],
        className,
      )}
      {...props}
    />
  );
}

export function PlayIcon({ size = 12 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 14 14" fill="currentColor">
      <path d="M4 2.5v9l7-4.5z" />
    </svg>
  );
}

export function CheckIcon({ size = 12 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M2 6l3 3 5-6" />
    </svg>
  );
}

export function InfoIcon() {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="mt-px shrink-0"
    >
      <circle cx="8" cy="8" r="6.5" />
      <path d="M8 5v4M8 11h.01" />
    </svg>
  );
}

export function ErrorMessage({ error }: { error: unknown }) {
  if (!error) return null;
  const message = errorText(error);
  return (
    <Alert.Root
      unstyled
      role="alert"
      status="error"
      className="flex items-start gap-2.5 rounded-[10px] border border-danger-line bg-danger-soft px-3.5 py-3 text-[13px] text-danger-text"
    >
      <InfoIcon />
      <Alert.Description>{message}</Alert.Description>
    </Alert.Root>
  );
}

export function Notice({
  tone = 'warn',
  children,
}: {
  tone?: 'warn' | 'info';
  children: ReactNode;
}) {
  return (
    <div
      role="status"
      className={cx(
        'flex items-start gap-2.5 rounded-[10px] border px-3.5 py-3 text-[13px]',
        tone === 'warn'
          ? 'border-warn-line bg-warn-soft text-warn-text'
          : 'border-line bg-paper-soft text-ink-soft',
      )}
    >
      <InfoIcon />
      <span>{children}</span>
    </div>
  );
}

export function Panel({
  label,
  title,
  aside,
  children,
}: {
  label?: string;
  title?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={label}
      className="flex flex-col gap-2.5 rounded-xl border border-line bg-white px-[18px] py-4"
    >
      {(title || aside) && (
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[14px] font-semibold">{title}</h2>
          {aside && <span className="text-[12px] text-muted">{aside}</span>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Mono({ className, children }: { className?: string; children: ReactNode }) {
  return <span className={cx('font-mono text-[12px]', className)}>{children}</span>;
}

const PHASE_COLORS: Record<Phase, { pill: string; solid: string; ring: string; text: string }> = {
  investigation: {
    pill: 'bg-[#e6eefb] text-[#1a4fa3]',
    solid: 'bg-[#1a4fa3]',
    ring: 'border-[#1a4fa3]',
    text: 'text-[#1a4fa3]',
  },
  planning: {
    pill: 'bg-[#f0e8fa] text-[#6b2fa3]',
    solid: 'bg-[#6b2fa3]',
    ring: 'border-[#6b2fa3]',
    text: 'text-[#6b2fa3]',
  },
  implementation: {
    pill: 'bg-[#fbeedd] text-[#8f4700]',
    solid: 'bg-[#b85c0a]',
    ring: 'border-[#b85c0a]',
    text: 'text-[#8f4700]',
  },
  automated_testing: {
    pill: 'bg-[#fae8f1] text-[#a52a6b]',
    solid: 'bg-[#a52a6b]',
    ring: 'border-[#a52a6b]',
    text: 'text-[#a52a6b]',
  },
  e2e_testing: {
    pill: 'bg-[#eef4e0] text-[#3f6212]',
    solid: 'bg-[#3f6212]',
    ring: 'border-[#3f6212]',
    text: 'text-[#3f6212]',
  },
  code_review: {
    pill: 'bg-[#ddf3f0] text-[#0b5f59]',
    solid: 'bg-[#0f766e]',
    ring: 'border-[#0f766e]',
    text: 'text-[#0b5f59]',
  },
};

export const phaseColors = (phase: Phase) => PHASE_COLORS[phase];

export function PhasePill({ phase, className }: { phase: Phase; className?: string }) {
  return (
    <span
      className={cx(
        'rounded-full px-[9px] py-0.5 text-[12px] font-semibold whitespace-nowrap',
        PHASE_COLORS[phase].pill,
        className,
      )}
    >
      {phaseLabel(phase)}
    </span>
  );
}

const TONE_STYLES: Record<Tone, { dot: string; text: string }> = {
  ok: { dot: 'bg-ok', text: 'text-ok-text' },
  warn: { dot: 'bg-warn', text: 'text-warn-text' },
  danger: { dot: 'bg-danger', text: 'text-danger-text' },
  neutral: { dot: 'bg-nav-muted', text: 'text-ink-soft' },
};

export function StatusDot({ tone, label }: { tone: Tone; label: ReactNode }) {
  const style = TONE_STYLES[tone];
  return (
    <span className={cx('inline-flex items-center gap-1.5 font-medium', style.text)}>
      <span className={cx('size-2 shrink-0 rounded-full', style.dot)} />
      {label}
    </span>
  );
}

export function SessionOutcome({ session }: { session: Session }) {
  const outcome = sessionOutcome(session);
  return <StatusDot tone={outcome.tone} label={outcome.label} />;
}

export function CopyCommand({ command }: { command: string }) {
  return (
    <Clipboard.Root value={command} className="flex flex-col items-start gap-2.5">
      <code className="block w-full overflow-x-auto rounded-md border border-nav-active bg-code px-3 py-2.5 font-mono text-[12px] whitespace-pre text-code-text">
        {command}
      </code>
      <Clipboard.Trigger asChild aria-label="Copy command">
        <AppButton tone="dark">
          <svg
            aria-hidden="true"
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <rect x="5" y="5" width="8" height="8" rx="1.5" />
            <path d="M3 11V4a1 1 0 0 1 1-1h7" />
          </svg>
          <Clipboard.Indicator copied="Copied">Copy command</Clipboard.Indicator>
        </AppButton>
      </Clipboard.Trigger>
    </Clipboard.Root>
  );
}

type NativeInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'>;

interface LabeledInputProps extends NativeInputProps {
  label: ReactNode;
  mono?: boolean;
}

export function LabeledInput({ label, mono, className, ...props }: LabeledInputProps) {
  return (
    <Field.Root className={cx('flex flex-col items-stretch gap-1.5', className)}>
      <Field.Label className="text-[12px] font-semibold text-muted">{label}</Field.Label>
      <TextInput mono={mono} {...props} />
    </Field.Root>
  );
}

interface LabeledTextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: ReactNode;
  mono?: boolean;
}

export function LabeledTextArea({ label, mono, className, ...props }: LabeledTextAreaProps) {
  return (
    <Field.Root className={cx('flex flex-col items-stretch gap-1.5', className)}>
      <Field.Label className="text-[12px] font-semibold text-muted">{label}</Field.Label>
      <Textarea
        unstyled
        className={cx(
          'min-h-24 w-full rounded-lg border border-field bg-white px-3 py-2.5 outline-accent focus-visible:outline-2',
          mono && 'font-mono text-[13px]',
        )}
        {...props}
      />
    </Field.Root>
  );
}

interface LabeledSelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: ReactNode;
  /** For a select on the dark launch card. */
  dark?: boolean;
}

export function LabeledSelect({ label, dark, className, children, ...props }: LabeledSelectProps) {
  return (
    <Field.Root className={cx('flex flex-col items-stretch gap-1.5', className)}>
      <Field.Label
        className={cx('text-[12px]', dark ? 'text-nav-muted' : 'font-semibold text-muted')}
      >
        {label}
      </Field.Label>
      <NativeSelect.Root unstyled>
        <NativeSelect.Field
          className={cx(
            'min-h-11 w-full cursor-pointer rounded-lg border px-2.5 py-2 text-[13px]',
            dark ? 'border-nav-line bg-nav-raised text-nav-text' : 'border-field bg-white',
          )}
          {...props}
        >
          {children}
        </NativeSelect.Field>
      </NativeSelect.Root>
    </Field.Root>
  );
}

export function TextInput({ mono, className, ...props }: NativeInputProps & { mono?: boolean }) {
  return (
    <Input
      unstyled
      className={cx(
        'min-h-11 w-full rounded-lg border border-field bg-white px-3 py-2.5 outline-accent focus-visible:outline-2',
        mono && 'font-mono text-[13px]',
        className,
      )}
      {...props}
    />
  );
}

/** Ticks while a view shows a live duration. The clock stops once there's nothing live to show. */
export function useNow(live: boolean, intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!live) return;
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [live, intervalMs]);
  return now;
}

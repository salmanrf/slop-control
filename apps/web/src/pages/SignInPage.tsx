import { useState, type FormEvent } from 'react';
import { AppButton, ErrorMessage, LabeledInput, Notice } from '../components/common';
import { supabase } from '../lib/supabase';

/** Public sign-up is disabled, so this only signs in the one existing user. */
export function SignInPage({ expired }: { expired: boolean }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await supabase.auth.signInWithPassword({ email, password });
    if (result.error) setError(new Error(result.error.message));
    setBusy(false);
  };

  return (
    <div className="flex min-h-screen w-full items-center justify-center px-4 py-8">
      <main className="flex w-full max-w-[420px] flex-col gap-4">
        <div className="flex items-center gap-2.5 px-1">
          <span className="flex size-8 items-center justify-center rounded-[9px] bg-ink text-[13px] font-semibold text-white">
            SC
          </span>
          <span className="text-[16px] font-semibold">Slop Control</span>
          <span className="ml-auto text-[12px] text-muted">this machine · local</span>
        </div>
        {expired && (
          <Notice>
            Your sign-in expired. Sign in again to get back to the dashboard. Running sessions were
            not affected.
          </Notice>
        )}
        <form
          className="flex flex-col gap-4 rounded-[14px] border border-line bg-white p-6"
          onSubmit={(event) => void submit(event)}
        >
          <h1 className="text-[22px] font-semibold tracking-[-0.01em]">Sign in</h1>
          <LabeledInput
            label="Email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <LabeledInput
            label="Password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <AppButton tone="primary" type="submit" disabled={busy}>
            Sign in
          </AppButton>
          <ErrorMessage error={error} />
          <p className="text-[12px] leading-normal text-muted">
            There is no sign-up. The one account is created outside the app, because a valid sign-in
            can start sessions in auto mode on this machine. Every request and the status stream
            carry the token; when it expires you land back here.
          </p>
        </form>
      </main>
    </div>
  );
}

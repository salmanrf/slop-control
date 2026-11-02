import { useState, type FormEvent } from 'react';
import { ErrorMessage } from '../components/common';
import { supabase } from '../lib/supabase';

/** Public sign-up is disabled, so this only signs in the one existing user. */
export function SignInPage() {
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
    <main className="narrow">
      <h1>Slop Control</h1>
      <form className="stack" onSubmit={(event) => void submit(event)}>
        <label>
          Email
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <button type="submit" disabled={busy}>
          Sign in
        </button>
        <ErrorMessage error={error} />
      </form>
    </main>
  );
}

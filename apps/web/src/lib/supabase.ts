import { createClient } from '@supabase/supabase-js';

/** Used only for Auth. All data goes through the Nest API. */
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321',
  import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
);

/** Returns a current access token; the client refreshes it when it's close to expiring. */
export async function getToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

let signInExpired = false;

/** Tells the sign-in page why the developer landed there, as opposed to signing out. */
export const wasSignInExpired = () => signInExpired;

export function clearSignInExpired(): void {
  signInExpired = false;
}

/** Drops the local sign-in, which sends the app back to the sign-in page. */
export function handleExpiredSignIn(): void {
  signInExpired = true;
  void supabase.auth.signOut({ scope: 'local' });
}

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

/** Drops the local sign-in, which sends the app back to the sign-in page. */
export function handleExpiredSignIn(): void {
  void supabase.auth.signOut({ scope: 'local' });
}

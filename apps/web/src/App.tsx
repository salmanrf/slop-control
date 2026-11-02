import type { Session as AuthSession } from '@supabase/supabase-js';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  Outlet,
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { supabase } from './lib/supabase';
import { SessionPage } from './pages/SessionPage';
import { SignInPage } from './pages/SignInPage';
import { TicketPage } from './pages/TicketPage';
import { WorkspacePage } from './pages/WorkspacePage';
import { WorkspaceSelectorPage } from './pages/WorkspaceSelectorPage';

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
});

const rootRoute = createRootRoute({ component: Outlet });
const routeTree = rootRoute.addChildren([
  createRoute({ getParentRoute: () => rootRoute, path: '/', component: WorkspaceSelectorPage }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/$workspaceId',
    component: WorkspacePage,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/$workspaceId/tickets/$ticketKey',
    component: TicketPage,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/$workspaceId/sessions/$sessionId',
    component: SessionPage,
  }),
]);
const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

/** Nothing but the sign-in page renders without a sign-in, and losing it returns there. */
export function App() {
  const [auth, setAuth] = useState<AuthSession | null | undefined>(undefined);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setAuth(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuth(session);
      if (!session) queryClient.clear();
    });
    return () => data.subscription.unsubscribe();
  }, []);

  if (auth === undefined) return null;
  if (auth === null) return <SignInPage />;
  return (
    <QueryClientProvider client={queryClient}>
      <header className="app-header">
        <strong>Slop Control</strong>
        <button type="button" onClick={() => void supabase.auth.signOut()}>
          Sign out
        </button>
      </header>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

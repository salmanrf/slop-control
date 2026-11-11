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
import { WorkspaceLayout } from './components/AppShell';
import { clearSignInExpired, supabase, wasSignInExpired } from './lib/supabase';
import { PhaseSetupsPage } from './pages/PhaseSetupsPage';
import { SessionPage } from './pages/SessionPage';
import { SignInPage } from './pages/SignInPage';
import { SourcesPage } from './pages/SourcesPage';
import { TicketPage } from './pages/TicketPage';
import { WorkspacePage } from './pages/WorkspacePage';
import { WorkspaceSelectorPage } from './pages/WorkspaceSelectorPage';

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
});

const rootRoute = createRootRoute({ component: Outlet });
const workspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/w/$workspaceId',
  component: WorkspaceLayout,
});
const routeTree = rootRoute.addChildren([
  createRoute({ getParentRoute: () => rootRoute, path: '/', component: WorkspaceSelectorPage }),
  workspaceRoute.addChildren([
    createRoute({ getParentRoute: () => workspaceRoute, path: '/', component: WorkspacePage }),
    createRoute({
      getParentRoute: () => workspaceRoute,
      path: 'sources/$sourceId/tickets/$ticketKey',
      component: TicketPage,
    }),
    createRoute({
      getParentRoute: () => workspaceRoute,
      path: 'sources',
      component: SourcesPage,
    }),
    createRoute({
      getParentRoute: () => workspaceRoute,
      path: 'phase-setups',
      component: PhaseSetupsPage,
    }),
    createRoute({
      getParentRoute: () => workspaceRoute,
      path: 'sessions/$sessionId',
      component: SessionPage,
    }),
  ]),
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
      if (session) clearSignInExpired();
      else queryClient.clear();
    });
    return () => data.subscription.unsubscribe();
  }, []);

  if (auth === undefined) return null;
  if (auth === null) return <SignInPage expired={wasSignInExpired()} />;
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

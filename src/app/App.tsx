import { AppProviders } from './providers/AppProviders.tsx';
import { ErrorBoundary } from '../components/shared/ErrorBoundary.tsx';
import { useStudioRoute } from '../hooks/useStudioRoute.ts';
import { StudioRouteView } from '../pages/StudioRouteView.tsx';

function StudioApp() {
  const { routeMatch, navigate } = useStudioRoute();
  return <StudioRouteView routeMatch={routeMatch} onNavigate={navigate} />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppProviders>
        <StudioApp />
      </AppProviders>
    </ErrorBoundary>
  );
}

import { useCallback, useSyncExternalStore } from 'react';
import {
  matchStudioRoute,
  normalizeRoutePathname,
  type StudioRouteMatch,
} from '../app/routes/routeConfig.ts';

const ROUTE_CHANGE_EVENT = 'formfusion:route-change';

function getPathnameSnapshot(): string {
  if (typeof window === 'undefined') {
    return '/';
  }
  return normalizeRoutePathname(window.location.pathname);
}

function getServerSnapshot(): string {
  return '/';
}

let activeSubscribers = 0;
let restoreHistoryPatch: (() => void) | null = null;

function ensureHistoryPatched(): void {
  if (typeof window === 'undefined' || restoreHistoryPatch !== null) {
    return;
  }

  const originalPushState = window.history.pushState.bind(window.history);
  const originalReplaceState = window.history.replaceState.bind(window.history);

  window.history.pushState = function patchedPushState(
    data: unknown,
    unused: string,
    url?: string | URL | null,
  ): void {
    originalPushState(data, unused, url);
    window.dispatchEvent(new Event(ROUTE_CHANGE_EVENT));
  };

  window.history.replaceState = function patchedReplaceState(
    data: unknown,
    unused: string,
    url?: string | URL | null,
  ): void {
    originalReplaceState(data, unused, url);
    window.dispatchEvent(new Event(ROUTE_CHANGE_EVENT));
  };

  restoreHistoryPatch = () => {
    window.history.pushState = originalPushState;
    window.history.replaceState = originalReplaceState;
    restoreHistoryPatch = null;
  };
}

function subscribeToLocation(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  activeSubscribers += 1;
  ensureHistoryPatched();

  window.addEventListener('popstate', onStoreChange);
  window.addEventListener('hashchange', onStoreChange);
  window.addEventListener(ROUTE_CHANGE_EVENT, onStoreChange);

  return () => {
    window.removeEventListener('popstate', onStoreChange);
    window.removeEventListener('hashchange', onStoreChange);
    window.removeEventListener(ROUTE_CHANGE_EVENT, onStoreChange);
    activeSubscribers -= 1;
    if (activeSubscribers === 0 && restoreHistoryPatch !== null) {
      restoreHistoryPatch();
    }
  };
}

export function useStudioRoute() {
  const currentPathname = useSyncExternalStore(
    subscribeToLocation,
    getPathnameSnapshot,
    getServerSnapshot,
  );

  const routeMatch: StudioRouteMatch = matchStudioRoute(currentPathname);

  const navigate = useCallback((path: string) => {
    const normalized = normalizeRoutePathname(path);
    if (
      typeof window !== 'undefined' &&
      normalizeRoutePathname(window.location.pathname) !== normalized
    ) {
      window.history.pushState(null, '', normalized);
    } else if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(ROUTE_CHANGE_EVENT));
    }
  }, []);

  return { routeMatch, navigate };
}

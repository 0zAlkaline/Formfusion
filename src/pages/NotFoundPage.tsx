import { Compass } from 'lucide-react';
import { Button, EmptyState, PageHeader } from '../components/ui/index.ts';

interface NotFoundPageProps {
  readonly requestedPath: string;
  readonly onNavigate: (path: string) => void;
}

export function NotFoundPage({
  requestedPath,
  onNavigate,
}: NotFoundPageProps) {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Route Not Found"
        description={`No studio view is registered for "${requestedPath}".`}
        actions={
          <Button variant="primary" onClick={() => onNavigate('/')}>
            Return to Dashboard
          </Button>
        }
      />

      <EmptyState
        icon={<Compass className="h-5 w-5" aria-hidden="true" />}
        title="Unknown Studio Route"
        description={`The path "${requestedPath}" does not match any FormFusion route. Choose a workspace section from the sidebar or return to Dashboard.`}
        action={
          <Button variant="outline" size="sm" onClick={() => onNavigate('/')}>
            Go to Dashboard
          </Button>
        }
      />
    </div>
  );
}

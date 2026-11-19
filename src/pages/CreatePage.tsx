import { STUDIO_ROUTES } from '../app/routes/routeConfig.ts';
import { SourceImageUploadWorkspace } from '../components/create/SourceImageUploadWorkspace.tsx';
import { Button, PageHeader } from '../components/ui/index.ts';

interface CreatePageProps {
  readonly onNavigate: (path: string) => void;
}

export function CreatePage({ onNavigate }: CreatePageProps) {
  const route = STUDIO_ROUTES[1];

  return (
    <div className="space-y-8">
      <PageHeader
        title={route.title}
        description={route.description}
        actions={
          <div className="flex items-center gap-2.5">
            <Button variant="outline" onClick={() => onNavigate('/presets')}>
              My Presets
            </Button>
            <Button variant="outline" onClick={() => onNavigate('/styles')}>
              Browse Style Library
            </Button>
          </div>
        }
      />

      <SourceImageUploadWorkspace onNavigate={onNavigate} />
    </div>
  );
}

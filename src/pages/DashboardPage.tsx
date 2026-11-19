import { ArrowRight, Bookmark, FolderKanban, Palette, Settings, Wand2 } from 'lucide-react';
import { useStudioServices } from '../app/providers/AppProviders.tsx';
import { STUDIO_ROUTES } from '../app/routes/routeConfig.ts';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  PageHeader,
  SectionContainer,
  Typography,
} from '../components/ui/index.ts';

interface DashboardPageProps {
  readonly onNavigate: (path: string) => void;
}

const DESTINATION_CARDS = [
  {
    path: '/create',
    title: 'Create / Generator',
    description: 'Structured workflow slot from object description to approved artwork prompt.',
    icon: <Wand2 className="h-4 w-4 text-[var(--ff-color-primary)]" aria-hidden="true" />,
    actionLabel: 'Open Workspace',
  },
  {
    path: '/styles',
    title: 'Style Library',
    description: 'Curated artistic medium, lighting, and negative-directive definitions.',
    icon: <Palette className="h-4 w-4 text-[var(--ff-color-primary)]" aria-hidden="true" />,
    actionLabel: 'View Slot',
  },
  {
    path: '/projects',
    title: 'My Projects',
    description: 'Local-first project archive backed by the IndexedDB schema.',
    icon: <FolderKanban className="h-4 w-4 text-[var(--ff-color-primary)]" aria-hidden="true" />,
    actionLabel: 'View Archive',
  },
  {
    path: '/presets',
    title: 'My Presets',
    description: 'Reusable aspect ratio, resolution, and creative parameter templates.',
    icon: <Bookmark className="h-4 w-4 text-[var(--ff-color-primary)]" aria-hidden="true" />,
    actionLabel: 'View Presets',
  },
] as const;

export function DashboardPage({ onNavigate }: DashboardPageProps) {
  const dashboardRoute = STUDIO_ROUTES[0];
  const services = useStudioServices();
  const schema = services.storageGateway.schema;

  return (
    <div className="space-y-8">
      <PageHeader
        title={dashboardRoute.title}
        description={dashboardRoute.description}
        actions={
          <>
            <Button
              variant="outline"
              leftIcon={<Settings className="h-4 w-4" aria-hidden="true" />}
              onClick={() => onNavigate('/settings')}
            >
              Settings
            </Button>
            <Button
              variant="primary"
              rightIcon={<ArrowRight className="h-4 w-4" aria-hidden="true" />}
              onClick={() => onNavigate('/create')}
            >
              Open Create / Generator
            </Button>
          </>
        }
      />

      <SectionContainer
        title="Studio Route Slots"
        description="Lightweight semantic placeholders prepared across the six primary desktop routes."
      >
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
          {DESTINATION_CARDS.map((item) => (
            <Card key={item.path} className="flex flex-col justify-between">
              <CardHeader>
                <div className="flex items-center gap-2">
                  {item.icon}
                  <CardTitle>{item.title}</CardTitle>
                </div>
                <CardDescription>{item.description}</CardDescription>
              </CardHeader>
              <CardFooter className="justify-between border-t-0 pt-2">
                <Typography variant="caption" muted>
                  {item.path}
                </Typography>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onNavigate(item.path)}
                >
                  {item.actionLabel}
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      </SectionContainer>

      <SectionContainer
        title="Architecture & Storage Foundation"
        description="Preserved Phase 01.1 service contracts and IndexedDB schema registry."
      >
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Service & Provider Boundaries</CardTitle>
              <CardDescription>
                Contracts initialized; live providers deferred
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="list-disc space-y-1.5 pl-4 text-[13px] text-[var(--ff-color-foreground)]">
                <li>ObjectIdentificationService: Vision analysis contract</li>
                <li>ObjectDescriptionService: Structured normalization contract</li>
                <li>ArtStyleService: Curated style library contract</li>
                <li>PromptComposerService: Generated, final, and approval contract</li>
                <li>ImageGenerationService: Strict text-only request contract</li>
                <li>ProjectStorageService: Local-first IndexedDB storage contract</li>
                <li>ExportService: Artwork export contract</li>
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Local-First IndexedDB Schema</CardTitle>
              <CardDescription>
                {schema.databaseName} · Schema v{schema.version}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="list-disc space-y-1.5 pl-4 text-[13px] text-[var(--ff-color-foreground)]">
                {schema.stores.map((store) => (
                  <li key={store.storeName}>{store.storeName}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </SectionContainer>
    </div>
  );
}

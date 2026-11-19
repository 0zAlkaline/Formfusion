import {
  Copy,
  Download,
  Image as ImageIcon,
  Layers,
  MoreHorizontal,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import {
  BRAND_COLORS,
  SPACING_SCALE,
  TYPOGRAPHY_TOKENS,
} from '../../styles/designTokens.ts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
  ConfirmationDialog,
  Dropdown,
  EmptyState,
  ErrorState,
  LoadingState,
  Modal,
  PageHeader,
  SearchInput,
  SectionContainer,
  Select,
  SurfacePanel,
  Switch,
  Textarea,
  TextInput,
  Tooltip,
  Typography,
  WorkspacePanel,
} from '../ui/index.ts';

const SWATCHES = [
  { name: 'Background', hex: BRAND_COLORS.background, darkText: true },
  { name: 'Surface', hex: BRAND_COLORS.surface, darkText: true },
  { name: 'Primary Text', hex: BRAND_COLORS.primaryText, darkText: false },
  { name: 'Secondary Text', hex: BRAND_COLORS.secondaryText, darkText: false },
  { name: 'Primary Accent', hex: BRAND_COLORS.primaryAccent, darkText: false },
  { name: 'Secondary Accent', hex: BRAND_COLORS.secondaryAccent, darkText: true },
  { name: 'Border', hex: BRAND_COLORS.border, darkText: true },
] as const;

export function DesignSystemShowcase() {
  const [searchQuery, setSearchQuery] = useState('');
  const [projectTitle, setProjectTitle] = useState('Brutalist Limestone Study');
  const [promptNotes, setPromptNotes] = useState(
    'Directional northern daylight across hand-textured ceramic geometry.',
  );
  const [aspectRatio, setAspectRatio] = useState('4:3');
  const [includeNegative, setIncludeNegative] = useState(true);
  const [highContrastPreview, setHighContrastPreview] = useState(false);
  const [buttonLoading, setButtonLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [lastMenuAction, setLastMenuAction] = useState<string | null>(null);

  const handleSimulatedAction = () => {
    setButtonLoading(true);
    window.setTimeout(() => setButtonLoading(false), 600);
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title="Visual Identity & Design System"
        description="Contemporary editorial creative studio foundation featuring centralized tokens, Manrope and Inter typography, 4px spatial rhythm, and desktop-first UI primitives."
        actions={
          <>
            <Dropdown
              label="Studio Actions"
              align="right"
              items={[
                { id: 'duplicate', label: 'Duplicate Palette', icon: <Copy className="h-4 w-4" /> },
                { id: 'export', label: 'Export Tokens', icon: <Download className="h-4 w-4" /> },
                { id: 'archive', label: 'Reset Preview', icon: <Trash2 className="h-4 w-4" />, destructive: true },
              ]}
              onSelect={(id) => setLastMenuAction(id)}
            />
            <Button variant="primary" onClick={() => setModalOpen(true)}>
              Inspect Modal
            </Button>
          </>
        }
      />

      {lastMenuAction ? (
        <Alert
          tone="info"
          title={`Selected dropdown action: ${lastMenuAction}`}
          description="Dropdown menu selection triggers real component state and dismisses cleanly."
          action={
            <Button variant="ghost" size="sm" onClick={() => setLastMenuAction(null)}>
              Dismiss
            </Button>
          }
        />
      ) : null}

      <SectionContainer
        title="Color Tokens"
        description="Warm linen canvas, crisp white work surfaces, cobalt blue primary actions, and restrained acid lime highlights."
      >
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-7">
          {SWATCHES.map((swatch) => (
            <SurfacePanel key={swatch.name} padding="none" className="overflow-hidden">
              <div
                className="flex h-20 items-end p-3 border-b border-[var(--ff-color-border)]"
                style={{ backgroundColor: swatch.hex }}
              >
                <span
                  className="text-[12px] font-medium tabular-nums"
                  style={{ color: swatch.darkText ? '#17191E' : '#FFFFFF' }}
                >
                  {swatch.hex}
                </span>
              </div>
              <div className="px-3 py-2.5">
                <Typography variant="label" className="block">
                  {swatch.name}
                </Typography>
              </div>
            </SurfacePanel>
          ))}
        </div>
      </SectionContainer>

      <div className="grid gap-6 xl:grid-cols-[1.25fr_1fr]">
        <SectionContainer
          title="Typography Scale"
          description="Manrope display hierarchy paired with Inter interface prose."
        >
          <SurfacePanel padding="lg" className="space-y-4">
            <div className="border-b border-[var(--ff-color-border)] pb-4">
              <Typography variant="caption" muted className="block mb-1">
                Display XL · Manrope 40px / 700
              </Typography>
              <Typography variant="display-xl">
                Object to Artwork Studio
              </Typography>
            </div>
            <div className="border-b border-[var(--ff-color-border)] pb-4">
              <Typography variant="caption" muted className="block mb-1">
                Display Large · Manrope 32px / 700
              </Typography>
              <Typography variant="display-lg">
                Structured Creative Direction
              </Typography>
            </div>
            <div className="grid gap-4 md:grid-cols-3 border-b border-[var(--ff-color-border)] pb-4">
              <div>
                <Typography variant="caption" muted className="block mb-1">
                  Heading 1 · 24px
                </Typography>
                <Typography variant="h1">Editorial Header</Typography>
              </div>
              <div>
                <Typography variant="caption" muted className="block mb-1">
                  Heading 2 · 20px
                </Typography>
                <Typography variant="h2">Section Title</Typography>
              </div>
              <div>
                <Typography variant="caption" muted className="block mb-1">
                  Heading 3 · 16px
                </Typography>
                <Typography variant="h3">Panel Heading</Typography>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Typography variant="body-lg">
                  Body Large (16px) — Primary studio narrative copy.
                </Typography>
                <Typography variant="body">
                  Body (14px) — Standard interface instructions and descriptions.
                </Typography>
                <Typography variant="body-sm" muted>
                  Body Small (13px) — Supporting technical notes.
                </Typography>
              </div>
              <div className="space-y-2">
                <Typography variant="label" className="block">
                  Label (13px / 500) — Form Field Title
                </Typography>
                <Typography variant="caption" muted className="block">
                  Caption (12px / 500) — Scale tokens: {Object.keys(TYPOGRAPHY_TOKENS).length} roles
                </Typography>
              </div>
            </div>
          </SurfacePanel>
        </SectionContainer>

        <SectionContainer
          title="4px Spacing Rhythm"
          description="Consistent spacing tokens for containers, panels, and gutters."
        >
          <SurfacePanel padding="lg" className="space-y-3">
            {Object.entries(SPACING_SCALE).map(([step, value]) => (
              <div key={step} className="flex items-center gap-4">
                <span className="w-20 whitespace-nowrap text-[12px] font-medium tabular-nums text-[var(--ff-color-muted-foreground)]">
                  space-{step}
                </span>
                <span className="w-12 text-[12px] font-medium tabular-nums text-[var(--ff-color-foreground)]">
                  {value}
                </span>
                <div className="flex-1">
                  <div
                    className="h-2.5 rounded-[2px] bg-[var(--ff-color-primary)]"
                    style={{ width: value }}
                  />
                </div>
              </div>
            ))}
          </SurfacePanel>
        </SectionContainer>
      </div>

      <SectionContainer
        title="Buttons & Interactive States"
        description="Cobalt blue primary actions, dark ink secondary actions, outline, ghost, destructive, pressed, disabled, and loading states."
      >
        <SurfacePanel padding="lg" className="space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" onClick={handleSimulatedAction} loading={buttonLoading}>
              Primary Action
            </Button>
            <Button variant="secondary">Secondary Dark</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive" onClick={() => setConfirmOpen(true)}>
              Destructive
            </Button>
            <Button variant="outline" pressed>
              Pressed
            </Button>
            <Button variant="primary" disabled>
              Disabled
            </Button>
            <Tooltip content="Compact icon action tooltip">
              <Button
                variant="outline"
                size="sm"
                aria-label="More studio options"
                leftIcon={<MoreHorizontal className="h-4 w-4" aria-hidden="true" />}
              >
                Tooltip
              </Button>
            </Tooltip>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-[var(--ff-color-border)] pt-4">
            <Badge tone="neutral">Neutral</Badge>
            <Badge tone="primary">Cobalt Active</Badge>
            <Badge tone="accent">Lime Highlight</Badge>
            <Badge tone="success">Approved</Badge>
            <Badge tone="warning">Review Required</Badge>
            <Badge tone="destructive">Blocked</Badge>
            <Badge tone="info">IndexedDB Ready</Badge>
          </div>
        </SurfacePanel>
      </SectionContainer>

      <WorkspacePanel
        title="Studio Workspace & Form Controls"
        subtitle="Wide desktop artwork canvas paired with structured creative inspector"
        toolbar={
          <>
            <Badge tone="accent">Preview Frame</Badge>
            <Button
              variant="outline"
              size="sm"
              leftIcon={<SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />}
              onClick={() => setHighContrastPreview((prev) => !prev)}
            >
              Toggle Dark Stage
            </Button>
          </>
        }
        aside={
          <div className="space-y-4">
            <SearchInput
              label="Filter Controls"
              placeholder="Search tokens or presets..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onClear={() => setSearchQuery('')}
            />
            <TextInput
              label="Project Title"
              value={projectTitle}
              onChange={(e) => setProjectTitle(e.target.value)}
              success={projectTitle.trim().length > 0 ? 'Valid project title' : undefined}
              error={projectTitle.trim().length === 0 ? 'Title is required' : undefined}
            />
            <Select
              label="Aspect Ratio"
              value={aspectRatio}
              onChange={(e) => setAspectRatio(e.target.value)}
              options={[
                { value: '1:1', label: '1:1 Square' },
                { value: '4:3', label: '4:3 Editorial Landscape' },
                { value: '3:4', label: '3:4 Portrait Study' },
                { value: '16:9', label: '16:9 Widescreen' },
              ]}
            />
            <Textarea
              label="Creative Direction Notes"
              rows={3}
              value={promptNotes}
              onChange={(e) => setPromptNotes(e.target.value)}
              hint="Editable before prompt approval."
            />
            <Checkbox
              label="Include negative directives"
              description="Applies style default exclusions."
              checked={includeNegative}
              onChange={(e) => setIncludeNegative(e.target.checked)}
            />
            <Switch
              label="Dark preview backdrop"
              description="Uses #17191E dark studio surface."
              checked={highContrastPreview}
              onCheckedChange={setHighContrastPreview}
            />
          </div>
        }
      >
        <div className="space-y-5">
          <SurfacePanel
            tone={highContrastPreview ? 'dark' : 'elevated'}
            padding="lg"
            className="flex min-h-[260px] flex-col items-center justify-center text-center"
          >
            <ImageIcon className="h-8 w-8 opacity-60" aria-hidden="true" />
            <p className="mt-3 font-[family-name:var(--ff-font-display)] text-[18px] font-semibold">
              {projectTitle || 'Untitled Study'}
            </p>
            <p className="mt-1 text-[13px] opacity-75">
              Aspect Ratio {aspectRatio} · Negative Prompt {includeNegative ? 'Enabled' : 'Off'}
            </p>
          </SurfacePanel>

          <div className="grid gap-4 md:grid-cols-2">
            <Alert
              tone="success"
              title="Accessible Contrast Verified"
              description="Semantic feedback combines icons, borders, and explicit text labels."
            />
            <Alert
              tone="warning"
              title="Phase 01.2 Boundary"
              description="Page-specific workflows and live AI integrations remain deferred."
            />
          </div>
        </div>
      </WorkspacePanel>

      <SectionContainer
        title="Feedback & Container States"
        description="Empty, loading, error, and structured card states."
      >
        <div className="grid gap-6 lg:grid-cols-3">
          <EmptyState
            icon={<Layers className="h-5 w-5" aria-hidden="true" />}
            title="No Artworks Yet"
            description="Artwork previews appear here after prompt approval and generation in Phase 02+."
            action={
              <Button variant="outline" size="sm" onClick={() => setModalOpen(true)}>
                Open Preview Dialog
              </Button>
            }
          />
          <LoadingState
            label="Synchronizing Local Studio"
            description="Subtle compositor-only spinner state."
          />
          <div className="space-y-4">
            <ErrorState
              title="Validation Boundary Example"
              message="Demonstrates accessible recovery messaging with retry affordance."
              onRetry={handleSimulatedAction}
            />
            <Card padding="md">
              <CardHeader>
                <CardTitle>Card Composition</CardTitle>
                <CardDescription>Single-elevation surface with hairline border.</CardDescription>
              </CardHeader>
              <CardFooter>
                <Button variant="ghost" size="sm">Cancel</Button>
                <Button variant="primary" size="sm">Save</Button>
              </CardFooter>
            </Card>
          </div>
        </div>
      </SectionContainer>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Modal Foundation"
        description="Keyboard-accessible dialog with Escape and backdrop dismissal."
        footer={
          <>
            <Button variant="outline" onClick={() => setModalOpen(false)}>
              Close
            </Button>
            <Button variant="primary" onClick={() => setModalOpen(false)}>
              Done
            </Button>
          </>
        }
      >
        <Typography variant="body-sm" muted>
          This modal foundation supports structured creative dialogs without adding external modal dependencies.
        </Typography>
      </Modal>

      <ConfirmationDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => setConfirmOpen(false)}
        title="Confirm Destructive Action"
        description="Verify destructive confirmation styling and focus handling."
        confirmLabel="Confirm Delete"
        tone="destructive"
      />
    </div>
  );
}

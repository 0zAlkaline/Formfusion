import { RefreshCw, ScanSearch, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button, ConfirmationDialog } from '../ui/index.ts';

export interface SourceAssetActionsProps {
  readonly fileName: string;
  readonly isBusy: boolean;
  readonly isAnalyzing?: boolean;
  readonly canAnalyze?: boolean;
  readonly analysisLabel?: string;
  readonly showRetrySave: boolean;
  readonly onAnalyzeObject?: () => void;
  readonly onReplace: () => void;
  readonly onConfirmRemove: () => Promise<void> | void;
  readonly onRetrySave: () => Promise<void> | void;
}

export function SourceAssetActions({
  fileName,
  isBusy,
  isAnalyzing = false,
  canAnalyze = false,
  analysisLabel = 'Analyze Object',
  showRetrySave,
  onAnalyzeObject,
  onReplace,
  onConfirmRemove,
  onRetrySave,
}: SourceAssetActionsProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const actionsLocked = isBusy || isAnalyzing;

  const handleConfirm = async () => {
    setConfirmOpen(false);
    await onConfirmRemove();
  };

  return (
    <div className="space-y-2.5" data-testid="source-asset-actions">
      {onAnalyzeObject ? (
        <Button
          variant="primary"
          size="sm"
          leftIcon={<ScanSearch className="h-3.5 w-3.5" aria-hidden="true" />}
          loading={isAnalyzing}
          disabled={!canAnalyze || actionsLocked}
          onClick={onAnalyzeObject}
          className="w-full"
        >
          {isAnalyzing ? 'Analyzing Object...' : analysisLabel}
        </Button>
      ) : null}

      {showRetrySave ? (
        <Button
          variant="primary"
          size="sm"
          leftIcon={<RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
          disabled={actionsLocked}
          onClick={() => void onRetrySave()}
          className="w-full"
        >
          Retry Save to Storage
        </Button>
      ) : null}

      <div className="grid grid-cols-2 gap-2.5">
        <Button
          variant="outline"
          size="sm"
          leftIcon={<RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
          disabled={actionsLocked}
          onClick={onReplace}
          className="w-full"
        >
          Replace Image
        </Button>

        <Button
          variant="outline"
          size="sm"
          leftIcon={<Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
          disabled={actionsLocked}
          onClick={() => setConfirmOpen(true)}
          className="w-full text-[var(--ff-color-destructive)] hover:border-[#ECC7C4] hover:bg-[var(--ff-color-destructive-subtle)]"
        >
          Remove
        </Button>
      </div>

      <ConfirmationDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => void handleConfirm()}
        title="Remove Source Image"
        description={`Remove "${fileName}" and clear its saved binary record from this study?`}
        confirmLabel="Remove Image"
        cancelLabel="Keep Image"
        tone="destructive"
        loading={actionsLocked}
      />
    </div>
  );
}

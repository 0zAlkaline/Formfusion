import { useEffect, useState, type FormEvent } from 'react';
import { MAX_PROJECT_TITLE_LENGTH, validateProjectTitle } from '../../services/project-storage/projectManagement.ts';
import {
  Alert,
  Button,
  Modal,
  TextInput,
  Textarea,
} from '../ui/index.ts';

export interface CreateProjectModalProps {
  readonly open: boolean;
  readonly isSubmitting: boolean;
  readonly submitError: string | null;
  readonly onClose: () => void;
  readonly onSubmit: (input: {
    readonly title: string;
    readonly description: string;
  }) => void | Promise<void>;
}

export function CreateProjectModal({
  open,
  isSubmitting,
  submitError,
  onClose,
  onSubmit,
}: CreateProjectModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTitle('');
      setDescription('');
      setFieldError(null);
    }
  }, [open]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const validation = validateProjectTitle(title);
    if (!validation.ok) {
      setFieldError(validation.error.message);
      return;
    }
    setFieldError(null);
    void onSubmit({
      title: validation.data,
      description: description.trim(),
    });
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!isSubmitting) {
          onClose();
        }
      }}
      title="Create New Project"
      description="Create an isolated local creative study in IndexedDB and open it in the Create workspace."
      size="sm"
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form="create-project-form"
            variant="primary"
            loading={isSubmitting}
            data-testid="confirm-create-project-button"
          >
            Create Project
          </Button>
        </>
      }
    >
      <form id="create-project-form" onSubmit={handleSubmit} className="space-y-4">
        {submitError ? (
          <Alert
            tone="destructive"
            title="Could not create project"
            description={submitError}
          />
        ) : null}

        <TextInput
          id="create-project-name"
          label="Project Name"
          placeholder="e.g., Porcelain Amphora Study"
          value={title}
          maxLength={MAX_PROJECT_TITLE_LENGTH}
          error={fieldError ?? undefined}
          hint="Required. Used to identify this study in My Projects and the Create workspace."
          autoFocus
          disabled={isSubmitting}
          onChange={(event) => {
            setTitle(event.target.value);
            if (fieldError) {
              setFieldError(null);
            }
          }}
        />

        <Textarea
          id="create-project-description"
          label="Description (optional)"
          placeholder="Short note about subject matter, lighting study, or target direction..."
          value={description}
          rows={3}
          maxLength={500}
          disabled={isSubmitting}
          onChange={(event) => setDescription(event.target.value)}
        />
      </form>
    </Modal>
  );
}

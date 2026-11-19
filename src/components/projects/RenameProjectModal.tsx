import { useEffect, useState, type FormEvent } from 'react';
import { MAX_PROJECT_TITLE_LENGTH, validateProjectTitle } from '../../services/project-storage/projectManagement.ts';
import type { Project } from '../../types/domain.ts';
import {
  Alert,
  Button,
  Modal,
  TextInput,
} from '../ui/index.ts';

export interface RenameProjectModalProps {
  readonly open: boolean;
  readonly project: Project | null;
  readonly isSubmitting: boolean;
  readonly submitError: string | null;
  readonly onClose: () => void;
  readonly onSubmit: (projectId: string, nextTitle: string) => void | Promise<void>;
}

export function RenameProjectModal({
  open,
  project,
  isSubmitting,
  submitError,
  onClose,
  onSubmit,
}: RenameProjectModalProps) {
  const [title, setTitle] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);

  useEffect(() => {
    if (open && project) {
      setTitle(project.title);
      setFieldError(null);
    }
  }, [open, project]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!project) {
      return;
    }
    const validation = validateProjectTitle(title);
    if (!validation.ok) {
      setFieldError(validation.error.message);
      return;
    }
    setFieldError(null);
    void onSubmit(project.id, validation.data);
  };

  return (
    <Modal
      open={open && project !== null}
      onClose={() => {
        if (!isSubmitting) {
          onClose();
        }
      }}
      title="Rename Project"
      description="Update the display name without altering project ID, artwork history, or linked records."
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
            form="rename-project-form"
            variant="primary"
            loading={isSubmitting}
            data-testid="confirm-rename-project-button"
          >
            Save Name
          </Button>
        </>
      }
    >
      <form id="rename-project-form" onSubmit={handleSubmit} className="space-y-4">
        {submitError ? (
          <Alert
            tone="destructive"
            title="Could not rename project"
            description={submitError}
          />
        ) : null}

        <TextInput
          id="rename-project-name"
          label="Project Name"
          value={title}
          maxLength={MAX_PROJECT_TITLE_LENGTH}
          error={fieldError ?? undefined}
          autoFocus
          disabled={isSubmitting}
          onChange={(event) => {
            setTitle(event.target.value);
            if (fieldError) {
              setFieldError(null);
            }
          }}
        />
      </form>
    </Modal>
  );
}

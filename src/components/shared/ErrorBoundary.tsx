import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  readonly children: ReactNode;
}

interface ErrorBoundaryState {
  readonly hasError: boolean;
  readonly message: string;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  override state: ErrorBoundaryState = {
    hasError: false,
    message: '',
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error.message || 'An unexpected rendering error occurred.',
    };
  }

  override componentDidCatch(_error: Error, _errorInfo: ErrorInfo): void {
    // Intentionally avoid logging sensitive state or external telemetry in Phase 01.1.
  }

  private readonly handleReset = () => {
    this.setState({ hasError: false, message: '' });
  };

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          className="mx-auto my-12 max-w-xl rounded-[var(--ff-radius-md)] border border-[#ECC7C4] bg-[var(--ff-color-destructive-subtle)] p-6 text-[var(--ff-color-foreground)]"
        >
          <h1 className="font-[family-name:var(--ff-font-display)] text-lg font-semibold text-[var(--ff-color-destructive)]">
            FormFusion Workspace Error
          </h1>
          <p className="mt-2 text-sm text-[var(--ff-color-foreground)]">
            {this.state.message}
          </p>
          <button
            type="button"
            onClick={this.handleReset}
            className="mt-4 inline-flex h-9 items-center rounded-[var(--ff-radius-md)] bg-[var(--ff-color-secondary)] px-4 text-sm font-medium text-[var(--ff-color-secondary-foreground)] hover:bg-[var(--ff-color-secondary-hover)] cursor-pointer"
          >
            Reset Workspace View
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

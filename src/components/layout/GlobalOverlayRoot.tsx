import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Button } from '../ui/Button.tsx';
import { Modal } from '../ui/Overlay.tsx';

export interface GlobalModalConfig {
  readonly title: string;
  readonly description?: string;
  readonly content: ReactNode;
  readonly size?: 'sm' | 'md' | 'lg';
  readonly confirmLabel?: string;
}

interface GlobalOverlayContextValue {
  readonly isOpen: boolean;
  readonly openModal: (config: GlobalModalConfig) => void;
  readonly closeModal: () => void;
}

const GlobalOverlayContext = createContext<GlobalOverlayContextValue | null>(
  null,
);

export function GlobalOverlayProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const [modalConfig, setModalConfig] = useState<GlobalModalConfig | null>(null);

  const openModal = useCallback((config: GlobalModalConfig) => {
    setModalConfig(config);
  }, []);

  const closeModal = useCallback(() => {
    setModalConfig(null);
  }, []);

  const value = useMemo<GlobalOverlayContextValue>(
    () => ({
      isOpen: modalConfig !== null,
      openModal,
      closeModal,
    }),
    [modalConfig, openModal, closeModal],
  );

  return (
    <GlobalOverlayContext.Provider value={value}>
      {children}
      <GlobalOverlayRoot
        modalConfig={modalConfig}
        onClose={closeModal}
      />
    </GlobalOverlayContext.Provider>
  );
}

export function GlobalOverlayRoot({
  modalConfig,
  onClose,
}: {
  readonly modalConfig: GlobalModalConfig | null;
  readonly onClose: () => void;
}) {
  return (
    <div data-overlay-root="true">
      {modalConfig ? (
        <Modal
          open
          onClose={onClose}
          title={modalConfig.title}
          description={modalConfig.description}
          size={modalConfig.size ?? 'md'}
          footer={
            <Button variant="primary" onClick={onClose}>
              {modalConfig.confirmLabel ?? 'Close'}
            </Button>
          }
        >
          {modalConfig.content}
        </Modal>
      ) : null}
    </div>
  );
}

export function useGlobalOverlay(): GlobalOverlayContextValue {
  const ctx = useContext(GlobalOverlayContext);
  if (ctx === null) {
    throw new Error(
      'useGlobalOverlay must be used inside GlobalOverlayProvider.',
    );
  }
  return ctx;
}

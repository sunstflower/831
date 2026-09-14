/// <reference types="vite/client" />

import type { DomainEvent } from '@udm/shared';

declare global {
  interface Window {
    dispatchApi?: {
      invoke(
        path: string,
        payload?: Record<string, unknown>,
        token?: string | null
      ): Promise<unknown>;
      on(event: string, handler: (message: DomainEvent) => void): () => void;
    };
  }
}

interface ImportMetaEnv {
  readonly VITE_API_ADAPTER?: 'mock' | 'ipc' | 'http';
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_PORT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

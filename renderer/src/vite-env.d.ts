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
      /** `event` 传 `null` 表示订阅全部（preload 按 falsy 判定）。 */
      on(event: string | null, handler: (message: DomainEvent) => void): () => void;
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

/// <reference types="vite/client" />

import type { DomainEvent } from '@udm/shared';
import type { HttpMethod } from './api/client';

declare global {
  interface Window {
    /**
     * preload 注入的桥（`desktop/preload.cjs`）。
     *
     * `method` 参与主进程的路由匹配（`Router` 按「方法 + 路径」查表），
     * 因此**必须**声明它 —— 漏了它 `tsc` 不报错（多传一个参数给 JS 函数是合法的），
     * 但主进程会把所有写请求当成 `GET`，于是「创建」会走成「列表」并返回一个数组。
     */
    dispatchApi?: {
      invoke(
        path: string,
        payload?: Record<string, unknown>,
        token?: string | null,
        method?: HttpMethod
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

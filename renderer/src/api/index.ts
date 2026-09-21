/**
 * 适配器装配：按 `VITE_API_ADAPTER` 选择实现（`.env`）。
 * 页面与 store 只 import 本模块的 `apiClient`，不直接 import 具体适配器。
 */
import type { AdapterKind, ApiClient } from './client';
import { createHttpAdapter } from './http';
import { createIpcAdapter } from './ipc';
import { createMockAdapter } from './mock';

export type { ApiClient, AdapterKind, Unsubscribe } from './client';
export type * from './types';

/** preload 是否已注入（即「是不是在 Electron 里」）。 */
function hasBridge(): boolean {
  return typeof window !== 'undefined' && Boolean(window.dispatchApi);
}

function resolveKind(): AdapterKind {
  const raw = import.meta.env.VITE_API_ADAPTER as string | undefined;
  if (raw === 'ipc' || raw === 'http' || raw === 'mock') {
    return raw;
  }
  // 未显式配置时的默认：
  // - 有 preload 桥 → ipc（桌面端生产形态，走真实主进程 + SQLite）
  // - 无桥 → mock（浏览器独立开发形态）
  //
  // 为什么不能一律默认 mock：打包后的 Electron 会 `loadFile` 渲染层产物，
  // 而构建时通常不会带 `.env`，于是 `VITE_API_ADAPTER` 为 undefined。
  // 若默认 mock，桌面端会**静默显示假数据**，既不读 SQLite 也不报错 ——
  // 是最难排查的一类问题（看起来一切正常）。按桥自动判定可消除该陷阱。
  return hasBridge() ? 'ipc' : 'mock';
}

export const adapterKind: AdapterKind = resolveKind();

export const apiClient: ApiClient =
  adapterKind === 'ipc'
    ? createIpcAdapter()
    : adapterKind === 'http'
      ? createHttpAdapter((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api')
      : createMockAdapter();

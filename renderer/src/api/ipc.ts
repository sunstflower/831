/**
 * IpcAdapter：Electron 生产形态。
 * 通过 preload 暴露的 `window.dispatchApi` 调用主进程（`desktop/preload.cjs`）。
 *
 * 若 preload 未注入（例如误用浏览器打开 Electron 形态），必须**明确报错**，
 * 不能静默降级到 Mock —— 否则会出现「以为在测真实数据、其实在看假数据」。
 */
import type { ApiResult, DomainEvent } from '@udm/shared';
import type { ApiClient, Unsubscribe } from './client';

export function createIpcAdapter(): ApiClient {
  const bridge = typeof window !== 'undefined' ? window.dispatchApi : undefined;

  return {
    async invoke<T>(path: string, payload: Record<string, unknown> = {}, token?: string | null): Promise<ApiResult<T>> {
      if (!bridge) {
        return {
          code: 'SYS.INTERNAL',
          message: '未检测到 preload 注入的 dispatchApi，请通过 Electron 启动（npm run dev:electron）',
          source: 'system'
        };
      }
      return (await bridge.invoke(path, payload, token ?? null)) as ApiResult<T>;
    },
    on<T>(event: string | null, handler: (message: DomainEvent<T>) => void): Unsubscribe {
      if (!bridge) {
        return () => {};
      }
      return bridge.on(event, handler as (message: DomainEvent) => void);
    }
  };
}

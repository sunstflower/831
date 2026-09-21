/**
 * HttpAdapter：预留形态（`docs/build-plan.md` §3.2），用于自动化契约测试。
 * 主进程侧尚未提供本地 HTTP 服务，故当前不可用于生产；契约与另两层一致。
 */
import type { ApiResult, DomainEvent } from '@udm/shared';
import type { ApiClient, Unsubscribe } from './client';

export function createHttpAdapter(baseUrl: string): ApiClient {
  const root = baseUrl.replace(/\/$/, '');

  return {
    async invoke<T>(path: string, payload: Record<string, unknown> = {}, token?: string | null): Promise<ApiResult<T>> {
      const response = await fetch(`${root}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify(payload)
      });
      return (await response.json()) as ApiResult<T>;
    },
    on<T>(_event: string | null, _handler: (message: DomainEvent<T>) => void): Unsubscribe {
      // SSE/WebSocket 通道未落地；明确返回空订阅而不是假装成功。
      return () => {};
    }
  };
}

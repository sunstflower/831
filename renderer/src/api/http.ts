/**
 * HttpAdapter：预留形态（`docs/build-plan.md` §3.2），用于自动化契约测试。
 * 主进程侧尚未提供本地 HTTP 服务，故当前不可用于生产；契约与另两层一致。
 */
import type { ApiResult, DomainEvent } from '@udm/shared';
import type { ApiClient, InvokeOptions, Unsubscribe } from './client';

export function createHttpAdapter(baseUrl: string): ApiClient {
  const root = baseUrl.replace(/\/$/, '');

  return {
    async invoke<T>(
      path: string,
      payload: Record<string, unknown> = {},
      token?: string | null,
      options?: InvokeOptions
    ): Promise<ApiResult<T>> {
      // 目前主进程未提供本地 HTTP 服务，这里保持「把语义原样表达出来」：
      // 方法走真实 HTTP 方法，而不是一律 POST 再把动词塞进 body —— 后者会让将来的
      // HTTP 网关无法按 REST 语义做路由与缓存，也读不出「这是一次写操作」。
      const response = await fetch(`${root}${path}`, {
        method: options?.method ?? 'GET',
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

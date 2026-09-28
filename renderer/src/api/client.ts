/**
 * 服务适配器契约（`design.md` §2.2）。
 *
 * 三层实现（`mock` / `ipc` / `http`）**必须行为一致**：页面只依赖本接口，
 * 不感知传输细节。切换由 `VITE_API_ADAPTER` 决定（`.env.example`）。
 *
 * 事件的类型直接复用 `shared` 的 `DomainEvent`（唯一来源）：主进程
 * `EventBus.emit` 实际发送的是 `{ type, payload, eventSeq }`，
 * **不含 `ts`** —— 渲染层不得凭空多声明字段，否则会写出永远取不到值的时间戳。
 */
import type { ApiResult, DomainEvent } from '@udm/shared';

export type Unsubscribe = () => void;

/**
 * HTTP 方法。
 *
 * 读接口只用 `GET`；写接口用它区分**同一路径上的不同语义**
 * （`GET /api/sites` 是列表、`POST /api/sites` 是创建、`PUT /api/sites/{id}` 是更新）。
 * 与 `docs/api.md` 的方法列、`desktop/src/ipc/router.ts` 的 `HttpMethod` 同一套取值。
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface InvokeOptions {
  /** 缺省 `GET` —— 老调用点不传它，行为不变。 */
  method?: HttpMethod;
}

export interface ApiClient {
  /** 调用服务；返回统一信封（成功 `code: 0`，失败为业务错误码）。 */
  invoke<T>(
    path: string,
    payload?: Record<string, unknown>,
    token?: string | null,
    options?: InvokeOptions
  ): Promise<ApiResult<T>>;
  /**
   * 订阅领域事件；返回取消订阅函数。
   * `event` 传 `null` 表示订阅全部事件（`desktop/preload.cjs` 按 falsy 判定）。
   */
  on<T = unknown>(event: string | null, handler: (message: DomainEvent<T>) => void): Unsubscribe;
}

/** 适配器标识，与 `.env.example` 的 `VITE_API_ADAPTER` 取值一致。 */
export type AdapterKind = 'mock' | 'ipc' | 'http';

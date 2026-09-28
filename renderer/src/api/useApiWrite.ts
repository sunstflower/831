/**
 * **写请求**钩子（M2/M3 共用，原先只在 `base/useBaseDataWrite.ts`）。
 *
 * 只管一件事：把「发一条写请求」包成 `{ busy, result }`，并把失败信封翻译成
 * 表单能直接用的一对东西 —— `fields`（标红输入框）与 `formError`（整表提示）。
 * 界面状态（弹层开不开、提交后刷不刷新）留在页面里，钩子不碰。
 *
 * 为什么按字段名标红而不是只弹一句错误：`VALIDATION.FAILED` 的 `detail.fields`
 * 是服务端逐字段给的原因（规则唯一作者 `shared/src/base-rules.ts`），
 * 丢掉它只显示「校验失败」，使用者就得自己猜是哪个框填错了。
 */
import { useCallback, useState } from 'react';
import { apiClient } from './index';
import type { HttpMethod } from './client';

/**
 * 响应是不是一个**列表信封**。
 *
 * 用途只有一条：写请求如果被当成读请求处理，返回的正是列表信封。
 * 实测（2026-09-26）：Electron 跑着旧构建（preload 未转发 `method`）时，
 * `POST /api/sites` 落到 `GET /api/sites` 上，返回 `code: 0` + 列表，
 * 界面于是弹出「已新增站点记录」——**数据库里什么都没有**。
 * 这是最坏的一类错误（假成功），所以宁可多这十几行也要让它变成一条明确失败。
 */
function looksLikeListEnvelope(data: unknown): boolean {
  return typeof data === 'object' && data !== null && Array.isArray((data as { records?: unknown }).records);
}

export interface WriteOutcome {
  ok: boolean;
  /**
   * 成功响应里的 `data`（可选）。
   *
   * 为什么把它带出来：状态操作的响应里含 `transition: { from, to }`，
   * 页面据此能说出「草稿 → 待派发」而不只是「操作成功」——
   * 后者在链式操作时完全无法确认这次到底推到了哪一步。
   */
  data?: unknown;
  /** 成功时的提示文案（用于页头的一行成功提示）。 */
  message: string;
  /** 失败时的字段级原因，键 = 表单字段名。 */
  fields: Record<string, string>;
  /** 失败时的整表级文案（没有字段可归属时展示它，如编码重复、节点不存在）。 */
  formError: string | null;
}

function fieldsOf(detail: unknown): Record<string, string> {
  if (typeof detail !== 'object' || detail === null) {
    return {};
  }
  const fields = (detail as { fields?: unknown }).fields;
  if (typeof fields !== 'object' || fields === null) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields as Record<string, unknown>)) {
    if (typeof value === 'string') {
      result[key] = value;
    }
  }
  return result;
}

/**
 * 为什么 M3 也用它：写请求的失败形态与 M2 完全一致（字段级 `detail.fields`、
 * 整表级 `message`、以及「写请求被当成读请求」的假成功），唯一不同是路径与权限点。
 * 这三件事都属于**传输层**，与具体资源无关，因此不再按模块各写一份。
 */
export function useApiWrite(token: string | null) {
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async (path: string, method: HttpMethod, payload: Record<string, unknown>, successMessage: string): Promise<WriteOutcome> => {
      setBusy(true);
      try {
        const result = await apiClient.invoke(path, payload, token, { method });
        if (result.code === 0) {
          if (looksLikeListEnvelope(result.data)) {
            // 不报成功：这条响应说明「写请求被当成了读请求」，本次改动很可能没有生效。
            // 常见成因是适配器与主进程不是同一批构建（`desktop/preload.cjs` 未转发 method）
            return {
              ok: false,
              message: '',
              fields: {},
              formError: '写请求的响应是一个列表，说明它被当成了读请求（多半是 Electron 跑着旧构建）。本次操作可能未生效，请重新构建后再试'
            };
          }
          return { ok: true, message: successMessage, fields: {}, formError: null, data: result.data };
        }
        const fields = fieldsOf(result.detail);
        return {
          ok: false,
          message: '',
          fields,
          // 有字段级原因时只在框下标红，不再叠一句「校验失败」——重复的提示会淹没真正的原因；
          // 一条字段都没有（编码重复、节点被引用、状态冲突）才用整表提示
          formError: Object.keys(fields).length === 0 ? result.message : null
        };
      } finally {
        setBusy(false);
      }
    },
    [token]
  );

  return { busy, run };
}

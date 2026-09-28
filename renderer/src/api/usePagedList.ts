/**
 * 分页列表的取数 hook（M2/M3 共用，原先只在 `base/useBaseDataList.ts`）。
 *
 * 与页面的分工：本文件只管「请求 —— 状态 —— 清理」，不含任何展示逻辑；
 * 列与页签的模型在各模块的 `model.ts`，排版在各自的页面里。
 *
 * **为什么抽到 `api/`**：M3 任务页的取数口径与 M2 逐条相同（防抖、翻页、竞态、卸载兜底），
 * 抄一份实现就会有两处各自演化 —— 例如只有一处修了「过期响应覆盖新结果」，
 * 另一处就会在快速切换筛选时安静地显示上一次的结果。这是本项目反复踩过的
 * 「同一事实多个作者」（D-34）在渲染层的同一个形态。
 *
 * 两个容易写错、这里显式处理的地方：
 *
 * 1. **竞态**：使用者快速改关键词时会有多个请求在飞，先发的可能后到。
 *    若不丢弃过期响应，表格会显示**上一个关键词**的结果，而且不报错。
 *    这里用递增的 `requestId` 只接受最后一次请求的结果。
 * 2. **卸载后 setState**：切换路由时组件已卸载，迟到的响应会触发 React 警告。
 *    用 `mountedRef` 兜住。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from './index';

export interface PagedListState<T> {
  records: T[];
  total: number;
  page: number;
  pageSize: number;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * 请求 `path` 并把列表信封翻成状态。
 *
 * `payload` **每次渲染都新建一个对象**（调用点直接写 `buildPayload(...)`），
 * 因此依赖用的是它的序列化值而不是引用 —— 后者会让 effect 每帧重启请求，
 * 页面看起来「一直在闪」。代价是每次渲染多一次 `JSON.stringify`：
 * 载荷只有几个标量，比一次多余的请求便宜得多。
 */
export function usePagedList<T>(
  path: string,
  payload: Record<string, unknown>,
  token: string | null
): PagedListState<T> {
  const [state, setState] = useState<Omit<PagedListState<T>, 'refresh'>>({
    records: [],
    total: 0,
    page: Number(payload.page ?? 1),
    pageSize: Number(payload.pageSize ?? 20),
    loading: true,
    error: null
  });
  const [revision, setRevision] = useState(0);
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);

  const payloadKey = JSON.stringify(payload);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    let cancelled = false;

    async function load() {
      setState((prev) => ({ ...prev, loading: true }));
      const body = JSON.parse(payloadKey) as Record<string, unknown>;
      const result = await apiClient.invoke<{
        records: T[];
        total: number;
        page: number;
        pageSize: number;
      }>(path, body, token);

      // 过期响应 / 已卸载：直接丢弃，不要把它写进 state
      if (cancelled || !mountedRef.current || requestId !== requestIdRef.current) {
        return;
      }
      if (result.code === 0) {
        setState({
          records: result.data.records,
          total: result.data.total,
          page: result.data.page,
          pageSize: result.data.pageSize,
          loading: false,
          error: null
        });
      } else {
        // 失败时**清空行**：留着上一次的结果会让人以为「筛选后就是这些」
        setState((prev) => ({ ...prev, records: [], total: 0, loading: false, error: result.message }));
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [path, payloadKey, token, revision]);

  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  return { ...state, refresh };
}

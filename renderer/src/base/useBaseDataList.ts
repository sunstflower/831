/**
 * 基础数据列表的取数 hook（M2）。
 *
 * 只是个**薄包装**：把「页签 + 查询状态」翻成路径与载荷，其余（请求生命周期、竞态、
 * 卸载兜底）由 `api/usePagedList.ts` 负责 —— M3 任务页用的是同一个实现。
 * 之所以保留这个具名包装而不是让页面直接调 `usePagedList`：
 * 页签模型（路径从哪来、空值发不发）属于本模块，放在这里可以让页面只有一行取数代码。
 */
import type { BaseDataRow, ListQuery, TabDef } from './model';
import { buildPayload } from './model';
import { usePagedList, type PagedListState } from '../api/usePagedList';

export type BaseDataListState = PagedListState<BaseDataRow>;

export function useBaseDataList(tab: TabDef, query: ListQuery, token: string | null): BaseDataListState {
  return usePagedList<BaseDataRow>(tab.path, buildPayload(tab, query), token);
}

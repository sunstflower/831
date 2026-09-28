/**
 * 任务管理页（M3，`design.md` §7.1）。
 *
 * **读 + 写 + 状态流转**：任务列表（关键词 / 状态 / 优先级 / 车辆过滤 + 分页）、
 * 新建与编辑（可套模板）、状态操作（提交 / 暂停 / 继续 / 取消 / 重派 / 重新入池 / 删除草稿）、
 * 以及只读的详情弹层（计划、路线、告警、最近操作）。
 *
 * ## 三个刻意的取舍
 *
 * 1. **按钮按状态渲染，而不是渲染一排禁用按钮**：一个点不动且不说原因的按钮
 *    比没有按钮更糟（`ISS-010` 的教训）。哪些动作可用由 `task/actions.ts` 从
 *    `shared` 的状态机派生，因此与主进程的判据同源。
 * 2. **写能力按 `task:write` 开关**：monitor 看到的是纯读取界面（没有操作列）。
 *    主进程仍会独立校验（D-08），前端隐藏只是体验优化。
 * 3. **不提供「批量操作」**：契约里没有批量接口，逐个点虽然慢，但每一次都会留下
 *    独立的审计与原因；批量入口会诱使人跳过原因输入，而原因正是复盘时唯一的线索。
 *
 * 数据来源：`/api/tasks`（列表）· `/api/tasks/{id}`（详情）· `/api/tasks/{id}/{action}`（状态操作），
 * 契约见 `docs/api.md` §3.3。浏览器 Mock 与 Electron 走同一份契约，
 * 两条路径的逐项一致性由 `api/mock-parity.test.ts` 断言。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  MAX_PAGE_SIZE,
  hasPermission,
  type SiteListItem,
  type TaskListItem,
  type TaskTemplateListItem,
  type TaskTransitionInfo,
  type VehicleListItem
} from '@udm/shared';
import { apiClient } from '../api';
import { usePagedList } from '../api/usePagedList';
import { useApiWrite } from '../api/useApiWrite';
import { IconAlert, IconCheck, IconInfo, IconRefresh, IconSearch } from '../components/icons';
import { EntityFormDialog } from '../base/EntityFormDialog';
import { clampPage, pageCountOf } from '../domain/paging';
import { TASK_STATUS_LABEL, labelOf } from '../domain/labels';
import { useSessionStore } from '../store/session';
import {
  EMPTY_QUERY,
  TASK_COLUMNS,
  TASK_PRIORITY_FILTERS,
  TASK_STATUS_FILTERS,
  UNFINISHED_STATUSES,
  buildPayload,
  vehicleOptionsOf,
  type ListQuery
} from '../task/model';
import { actionPayload, canEditTask, needsConfirm, taskActionDefs, type TaskActionDef } from '../task/actions';
import {
  TASK_FORM,
  buildTaskPayload,
  emptyTaskForm,
  siteOptionsOf,
  taskFormValuesOf,
  templateOptionsOf
} from '../task/form';
import { TaskActionDialog } from '../task/TaskActionDialog';
import { TaskDetailDialog } from '../task/TaskDetailDialog';
import type { FormField, FormValues } from '../domain/form';
import '../task/style/task.css';

/** 关键词防抖窗口（ms）：每敲一个字就发一次请求会让表格闪得读不成，也会打满主进程。 */
const SEARCH_DEBOUNCE_MS = 300;

interface DialogState {
  mode: 'create' | 'edit';
  row: TaskListItem | null;
  original: FormValues;
  values: FormValues;
  errors: Record<string, string>;
  formError: string | null;
}

/** 待确认的状态操作（含必须填写的原因）。 */
interface PendingState {
  row: TaskListItem;
  def: TaskActionDef;
  reason: string;
  error: string | null;
}

export function TasksPage() {
  const token = useSessionStore((state) => state.token);
  const role = useSessionStore((state) => state.user?.role);
  const canWrite = role !== undefined && hasPermission(role, 'task:write');

  const [query, setQuery] = useState<ListQuery>(EMPTY_QUERY);
  const [searchDraft, setSearchDraft] = useState('');
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [pending, setPending] = useState<PendingState | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [siteOptions, setSiteOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [templateOptions, setTemplateOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [vehicleOptions, setVehicleOptions] = useState<Array<{ value: string; label: string }>>([]);

  const payload = useMemo(() => buildPayload(query), [query]);
  const list = usePagedList<TaskListItem>('/api/tasks', payload, token);
  const write = useApiWrite(token);

  // 输入 → 查询条件（防抖）。清空输入等价于去掉搜索：`buildPayload` 不会发空值。
  useEffect(() => {
    const trimmed = searchDraft.trim();
    if (trimmed === query.keyword) {
      return;
    }
    const timer = setTimeout(() => {
      // 搜索条件变了必须回到第 1 页：否则会停在一个「筛选后不存在」的页上看到空表
      setQuery((prev) => ({ ...prev, keyword: trimmed, page: 1 }));
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchDraft, query.keyword]);

  // 总数变小（筛选 / 删除）时把页码夹回范围内，并重新请求 —— 见 `domain/paging.ts`
  useEffect(() => {
    const clamped = clampPage(query.page, list.total, query.pageSize);
    if (clamped !== query.page) {
      setQuery((prev) => ({ ...prev, page: clamped }));
    }
  }, [list.total, query.page, query.pageSize]);

  const pages = useMemo(() => pageCountOf(list.total, query.pageSize), [list.total, query.pageSize]);

  /**
   * 车辆筛选的候选项：只在挂载时拉一次。
   *
   * 失败不报错、只是筛不了车辆：一个次要下拉拉不到候选，不该让整页显示成「坏了」。
   * 用 `MAX_PAGE_SIZE` 一次拉全量 —— 分页会让人以为列表里没有的车不能筛。
   */
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const result = await apiClient.invoke<{ records: VehicleListItem[] }>(
        '/api/vehicles',
        { page: 1, pageSize: MAX_PAGE_SIZE },
        token
      );
      if (!cancelled && result.code === 0) {
        setVehicleOptions(vehicleOptionsOf(result.data.records));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  /**
   * 表单需要的候选清单（站点 / 模板）。
   *
   * 只在**真正打开表单**时才拉：站点与模板是两张可能很长的表，挂在页面上常驻拉取
   * 会让每次进入任务页都多两个请求，而它们只在编辑任务时用得上。
   */
  const loadFormOptions = useCallback(async () => {
    const [sites, templates] = await Promise.all([
      apiClient.invoke<{ records: SiteListItem[] }>('/api/sites', { page: 1, pageSize: MAX_PAGE_SIZE }, token),
      apiClient.invoke<{ records: TaskTemplateListItem[] }>(
        '/api/task-templates',
        { page: 1, pageSize: MAX_PAGE_SIZE },
        token
      )
    ]);
    if (sites.code === 0) {
      setSiteOptions(siteOptionsOf(sites.data.records));
    }
    if (templates.code === 0) {
      setTemplateOptions(templateOptionsOf(templates.data.records));
    }
  }, [token]);

  useEffect(() => {
    if (!dialog) {
      return;
    }
    // 拉取失败不阻断表单：候选为空时仍能编辑（已知 id 的字段照常提交），只是选不到新站点
    void loadFormOptions();
    // dialog 的身份（mode + 行）才是「重新打开」的信号；表单内部每次输入都换对象，不能进依赖
  }, [dialog?.mode, dialog?.row, dialog, loadFormOptions]);

  function openCreate() {
    setNotice(null);
    setActionError(null);
    const values = emptyTaskForm();
    setDialog({ mode: 'create', row: null, original: {}, values, errors: {}, formError: null });
  }

  function openEdit(row: TaskListItem) {
    setNotice(null);
    setActionError(null);
    const values = taskFormValuesOf(row);
    setDialog({ mode: 'edit', row, original: values, values, errors: {}, formError: null });
  }

  async function submitDialog() {
    if (!dialog) {
      return;
    }
    const built = buildTaskPayload(dialog.values, dialog.mode === 'create' ? 'create' : 'patch', dialog.original);
    if (!built.ok) {
      setDialog({ ...dialog, errors: built.fields, formError: null });
      return;
    }
    if (dialog.mode === 'edit' && Object.keys(built.payload).length === 0) {
      // 空补丁打过去不会报错，只是什么都没做 —— 那是最难察觉的一种「没生效」，直接说清楚
      setDialog({ ...dialog, errors: {}, formError: '没有任何修改' });
      return;
    }
    const path = dialog.mode === 'create' ? '/api/tasks' : `/api/tasks/${dialog.row!.id}`;
    const outcome = await write.run(
      path,
      dialog.mode === 'create' ? 'POST' : 'PUT',
      built.payload,
      dialog.mode === 'create' ? '已新建任务（草稿）' : '已保存任务修改'
    );
    if (outcome.ok) {
      setDialog(null);
      setNotice(outcome.message);
      list.refresh();
      return;
    }
    setDialog({ ...dialog, errors: outcome.fields, formError: outcome.formError });
  }

  /**
   * 执行一次状态操作。
   *
   * `delete` 走 `DELETE`、其余走 `POST …/{action}` —— 动作与方法的对应关系写在
   * `docs/api.md` §3.3，这里不另立规则：状态机里 `delete` 是「移出表」而不是改状态。
   */
  async function runAction(row: TaskListItem, def: TaskActionDef, reason = '') {
    const outcome =
      def.action === 'delete'
        ? await write.run(`/api/tasks/${row.id}`, 'DELETE', {}, `已删除草稿“${row.code}”`)
        : await write.run(
            `/api/tasks/${row.id}/${def.action}`,
            'POST',
            actionPayload(def, reason),
            `已${def.label}“${row.code}”`
          );
    if (outcome.ok) {
      setPending(null);
      setActionError(null);
      // 让提示说出「从什么变成了什么」：链式操作（提交 → 派发 → 暂停）时，
      // 只说「操作成功」等于让人自己回去看状态列
      const transition = (outcome.data as { transition?: TaskTransitionInfo } | undefined)?.transition;
      setNotice(
        transition && transition.from !== transition.to
          ? `${outcome.message}（${labelOf(TASK_STATUS_LABEL, transition.from)} → ${labelOf(TASK_STATUS_LABEL, transition.to)}）`
          : outcome.message
      );
      list.refresh();
      return;
    }
    const message = outcome.formError ?? '操作失败';
    if (pending) {
      // 弹层开着时把失败留在弹层里：关掉它再在页头报错，使用者会失去「刚才那一下」的上下文
      setPending({ ...pending, error: message });
    } else {
      setActionError(message);
    }
  }

  function onActionClick(row: TaskListItem, def: TaskActionDef) {
    setNotice(null);
    setActionError(null);
    if (needsConfirm(def)) {
      setPending({ row, def, reason: '', error: null });
      return;
    }
    void runAction(row, def);
  }

  function onFieldChange(name: string, value: string) {
    setDialog((prev) => (prev ? { ...prev, values: { ...prev.values, [name]: value }, errors: { ...prev.errors, [name]: '' } } : prev));
  }

  return (
    <div className="udm-page">
      <section className="udm-list__toolbar" role="group" aria-label="任务筛选">
        <label className="udm-field udm-list__search">
          <span className="udm-sr-only">搜索任务</span>
          <IconSearch size={14} />
          <input
            type="search"
            value={searchDraft}
            placeholder="按任务编码或标题搜索"
            onChange={(event) => setSearchDraft(event.target.value)}
          />
        </label>

        <div className="udm-list__filters">
          <label className="udm-field udm-list__select">
            <span className="udm-sr-only">按状态筛选</span>
            <select value={query.status} onChange={(event) => setQuery((prev) => ({ ...prev, status: event.target.value, page: 1 }))}>
              <option value="">全部状态</option>
              {TASK_STATUS_FILTERS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="udm-field udm-list__select">
            <span className="udm-sr-only">按优先级筛选</span>
            <select value={query.priority} onChange={(event) => setQuery((prev) => ({ ...prev, priority: event.target.value, page: 1 }))}>
              <option value="">全部优先级</option>
              {TASK_PRIORITY_FILTERS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="udm-field udm-list__select">
            <span className="udm-sr-only">按执行车辆筛选</span>
            <select value={query.vehicleId} onChange={(event) => setQuery((prev) => ({ ...prev, vehicleId: event.target.value, page: 1 }))}>
              <option value="">全部车辆</option>
              {vehicleOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <button type="button" className="udm-btn udm-btn--ghost" onClick={list.refresh}>
            <IconRefresh size={14} />
            刷新
          </button>

          {canWrite ? (
            <button type="button" className="udm-btn udm-btn--primary" onClick={openCreate}>
              新建任务
            </button>
          ) : null}
        </div>
      </section>

      <p className="udm-list__hint">
        {/* 状态名直接用 `TASK_STATUS_LABEL` 拼：提示里换一套叫法（「待派发」vs 列里的「待派」）
            会让使用者以为筛选器和表格说的不是同一件事 */}
        「进行中（未结束）」= {UNFINISHED_STATUSES.map((status) => labelOf(TASK_STATUS_LABEL, status)).join(' / ')}
        ；终态任务用状态下拉单独查看。点任务编码可看详情。
      </p>

      {notice ? (
        <p className="udm-list__banner udm-list__banner--ok" role="status">
          <IconCheck size={14} />
          <span>{notice}</span>
        </p>
      ) : null}

      {actionError ? (
        <div className="udm-alert" role="alert">
          <IconAlert size={16} />
          <span>操作失败：{actionError}</span>
        </div>
      ) : null}

      {list.error ? (
        <div className="udm-alert" role="alert">
          <IconAlert size={16} />
          <span>加载失败：{list.error}</span>
        </div>
      ) : null}

      <section className="udm-card udm-list__card" aria-label="任务列表">
        {list.loading && list.records.length === 0 ? (
          <div className="udm-empty" role="status">
            <span className="udm-spinner" aria-hidden="true" />
            <p className="udm-empty__title">正在加载任务…</p>
          </div>
        ) : list.records.length === 0 ? (
          <div className="udm-empty" role="status">
            <p className="udm-empty__title">没有可显示的任务</p>
            <p className="udm-empty__hint">
              当前筛选条件下没有任务。任务由调度流程产生：先新建草稿，再提交进候选池等待派车。
            </p>
          </div>
        ) : (
          <div className="udm-table__wrap">
            <table className="udm-table">
              <caption className="udm-sr-only">
                任务列表，共 {list.total} 条，第 {list.page} / {pages} 页
              </caption>
              <thead>
                <tr>
                  {TASK_COLUMNS.map((column) => (
                    <th key={column.key} scope="col" className={column.align === 'right' ? 'udm-table__num' : undefined}>
                      {column.label}
                    </th>
                  ))}
                  {canWrite ? (
                    <th scope="col" className="udm-table__actions">
                      操作
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {list.records.map((row) => {
                  const defs = taskActionDefs(row.status);
                  return (
                    <tr key={row.id}>
                      {TASK_COLUMNS.map((column) => (
                        <td key={column.key} className={column.align === 'right' ? 'udm-table__num' : undefined}>
                          {column.key === 'code' ? (
                            <button type="button" className="udm-linklike" onClick={() => setDetailId(row.id)}>
                              {row.code}
                            </button>
                          ) : (
                            column.cell(row)
                          )}
                        </td>
                      ))}
                      {canWrite ? (
                        <td className="udm-table__actions">
                          <div className="udm-list__row-actions">
                            {canEditTask(row.status) ? (
                              <button type="button" className="udm-btn udm-btn--ghost" onClick={() => openEdit(row)} disabled={write.busy}>
                                编辑
                              </button>
                            ) : null}
                            {defs.map((def) => (
                              <button
                                key={def.action}
                                type="button"
                                className={def.style === 'danger' ? 'udm-btn udm-btn--danger' : 'udm-btn udm-btn--ghost'}
                                onClick={() => onActionClick(row, def)}
                                disabled={write.busy}
                                title={def.note}
                              >
                                {def.label}
                              </button>
                            ))}
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <footer className="udm-list__foot">
          <span className="udm-list__count">
            共 <strong>{list.total}</strong> 条 · 第 {list.page} / {pages} 页
            {/* 加载中显示在文字后面而不是替换表格：替换会让表格高度跳动，读一行读到一半就没了 */}
            {list.loading && list.records.length > 0 ? ' · 更新中…' : ''}
          </span>
          <div className="udm-list__pager">
            <button
              type="button"
              className="udm-btn udm-btn--ghost"
              disabled={list.page <= 1}
              onClick={() => setQuery((prev) => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
            >
              上一页
            </button>
            <button
              type="button"
              className="udm-btn udm-btn--ghost"
              disabled={list.page >= pages}
              onClick={() => setQuery((prev) => ({ ...prev, page: Math.min(pages, prev.page + 1) }))}
            >
              下一页
            </button>
          </div>
        </footer>
      </section>

      <p className="udm-list__note">
        <IconInfo size={12} />
        <span>
          {canWrite
            ? '新建的任务是草稿，提交后才进入调度候选池；暂停 / 取消 / 重派会记录原因并写审计。'
            : '当前角色只能查看任务：新建、编辑与状态流转需要 task:write 权限（admin、dispatcher）。'}
          {' '}
          车辆在地图上的实时位置见 <Link to="/map">地图</Link>。
        </span>
      </p>

      {pending ? (
        <TaskActionDialog
          def={pending.def}
          taskLabel={`${pending.row.code} · ${pending.row.title}`}
          reason={pending.reason}
          busy={write.busy}
          error={pending.error}
          onReasonChange={(value) => setPending((prev) => (prev ? { ...prev, reason: value, error: null } : prev))}
          onConfirm={() => void runAction(pending.row, pending.def, pending.reason)}
          onCancel={() => setPending(null)}
        />
      ) : null}

      {dialog ? (
        <EntityFormDialog
          title={dialog.mode === 'create' ? TASK_FORM.titleCreate : TASK_FORM.titleEdit}
          fields={fieldsForDialog(templateOptions)}
          values={dialog.values}
          errors={dialog.errors}
          formError={dialog.formError}
          busy={write.busy}
          submitLabel={dialog.mode === 'create' ? '创建' : '保存'}
          editing={dialog.mode === 'edit'}
          candidates={{ site: siteOptions }}
          targetOptions={{ node: [], edge: [] }}
          onChange={onFieldChange}
          onSubmit={() => void submitDialog()}
          onClose={() => setDialog(null)}
        />
      ) : null}

      {detailId ? <TaskDetailDialog taskId={detailId} token={token} onClose={() => setDetailId(null)} /> : null}
    </div>
  );
}

/** 模板下拉的候选项是**运行时**才知道的（要读库），因此在这里替换掉字段定义里的空数组。 */
function fieldsForDialog(templateOptions: Array<{ value: string; label: string }>): FormField[] {
  return TASK_FORM.fields.map((field) =>
    field.name === 'templateId' ? { ...field, options: templateOptions } : field
  );
}

/**
 * 基础数据页（M2，`design.md` §7.1）。
 *
 * **查询 + 维护**：站点 / 车辆 / 路网节点 / 有向边四张表的搜索、筛选、分页，
 * 以及新增 / 编辑 / 停用启用。
 *
 * 写能力按 `base:write` 开关（`shared/src/enums.ts` 的权限点）：没有该权限的角色
 * （dispatcher / monitor）看到的是纯读取界面 —— **按钮不渲染**，而不是渲染出来再禁用。
 * 一个点不动的「新增」按钮比没有按钮更糟（`ISS-010` 的教训：把可用误当成已完成）；
 * 而这里两种做法的区别是「能力边界」与「故障感」的区别。主进程仍会独立校验权限（D-08），
 * 前端隐藏只是体验优化。
 *
 * 数据来源：`/api/sites` · `/api/vehicles` · `/api/nodes` · `/api/edges`（`docs/api.md` §3.2），
 * 读接口共用同一套分页口径（D-40），写接口的字段规则来自 `shared/src/base-rules.ts`。
 * 浏览器 Mock 与 Electron 走同一份契约，两条路径的逐项一致性由 `api/mock-parity.test.ts` 断言。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { MAX_PAGE_SIZE, hasPermission, type EdgeListItem, type NodeListItem } from '@udm/shared';
import { apiClient } from '../api';
import { IconAlert, IconCheck, IconInfo, IconRefresh, IconSearch } from '../components/icons';
import { useSessionStore } from '../store/session';
import { BASE_DATA_TABS, EMPTY_QUERY, tabOf, type BaseDataRow, type BaseDataTabKey, type ListQuery } from '../base/model';
import { clampPage, pageCountOf } from '../domain/paging';
import { useBaseDataList } from '../base/useBaseDataList';
import { EntityFormDialog } from '../base/EntityFormDialog';
import {
  FORM_SPECS,
  buildWritePayload,
  emptyFormValues,
  faultActionOf,
  formValuesOfRow,
  nodeOptionsOf,
  optionNeedsOf,
  rowTitleOf,
  statusActionOf,
  statusBlockedReason,
  type FormValues
} from '../base/form';
import { useApiWrite } from '../api/useApiWrite';

/** 关键词防抖窗口（ms）：每敲一个字就发一次请求会让表格闪得读不成，也会打满主进程。 */
const SEARCH_DEBOUNCE_MS = 300;

/** 弹层状态：一次只开一个，打开时快照下原始值，提交时用它做「改了哪些字段」的比对。 */
interface DialogState {
  mode: 'create' | 'edit';
  row: BaseDataRow | null;
  original: FormValues;
  values: FormValues;
  errors: Record<string, string>;
  formError: string | null;
}

export function BaseDataPage() {
  const token = useSessionStore((state) => state.token);
  const role = useSessionStore((state) => state.user?.role);
  const canWrite = role !== undefined && hasPermission(role, 'base:write');
  const [tabKey, setTabKey] = useState<BaseDataTabKey>('sites');
  const [query, setQuery] = useState<ListQuery>(EMPTY_QUERY);
  const [searchDraft, setSearchDraft] = useState('');
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [nodeOptions, setNodeOptions] = useState<Array<{ value: string; label: string }>>([]);
  /** 有向边的候选（只有禁行规则的目标选择器用它）。 */
  const [edgeOptions, setEdgeOptions] = useState<Array<{ value: string; label: string }>>([]);
  /** 待确认的物理删除：非空时弹出确认层。 */
  const [pendingDelete, setPendingDelete] = useState<BaseDataRow | null>(null);
  /** 成功提示：写操作成功后页面顶部的绿条（下一次操作时被覆盖）。 */
  const [notice, setNotice] = useState<string | null>(null);
  /** 行内动作（停用/启用）的失败提示：它没有表单可以挂字段级错误，只能整条显示。 */
  const [actionError, setActionError] = useState<string | null>(null);
  const tab = tabOf(tabKey);
  const list = useBaseDataList(tab, query, token);
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

  // 总数变小（筛选/停用）时把页码夹回范围内，并重新请求 —— 见 `domain/paging.ts` 的 `clampPage`
  useEffect(() => {
    const clamped = clampPage(query.page, list.total, query.pageSize);
    if (clamped !== query.page) {
      setQuery((prev) => ({ ...prev, page: clamped }));
    }
  }, [list.total, query.page, query.pageSize]);

  const pages = useMemo(() => pageCountOf(list.total, query.pageSize), [list.total, query.pageSize]);

  /**
   * 表单需要的候选清单（节点 / 边）。
   *
   * 只在**真正打开表单**时才拉，且按页签只拉需要的那一份：
   *   - 站点绑定节点、边选两端 → 只拉节点；
   *   - 禁行规则的目标是多态的（节点或边）→ 两份都拉。
   *
   * 用 `pageSize: MAX_PAGE_SIZE` 一次拉全量：这里要的是「能选哪些」，分页会让人以为
   * 列表里没有的节点就不能选。数据量再大一档时应改成搜索式下拉（`GET /api/nodes?keyword=`），
   * 届时契约不变 —— 这是「先做完，再做好」的边界，写在实现旁边以免被当成疏忽。
   */
  const loadOptions = useCallback(async () => {
    // 「这张表要不要节点 / 边清单」由字段定义推导（`optionNeedsOf`），不在页面里手写页签清单
    const { nodes: needsNodes, edges: needsEdges } = optionNeedsOf(tabKey);
    if (!needsNodes) {
      return;
    }
    const [nodes, edges] = await Promise.all([
      apiClient.invoke<{ records: NodeListItem[] }>('/api/nodes', { page: 1, pageSize: MAX_PAGE_SIZE }, token),
      needsEdges
        ? apiClient.invoke<{ records: EdgeListItem[] }>('/api/edges', { page: 1, pageSize: MAX_PAGE_SIZE }, token)
        : Promise.resolve(null)
    ]);
    if (nodes.code === 0) {
      setNodeOptions(nodeOptionsOf(nodes.data.records));
    }
    if (edges && edges.code === 0) {
      setEdgeOptions(edges.data.records.map((edge) => ({ value: edge.id, label: edge.code })));
    }
  }, [tabKey, token]);

  useEffect(() => {
    if (!dialog) {
      return;
    }
    // 拉取失败不阻断表单：候选为空时仍能编辑（已知 id 的字段照常提交），
    // 只是下拉里选不到新目标。这里不弹错 —— 打开表单就因为一个次要请求失败而报错，
    // 会让人以为「这个页面坏了」，而实际只是候选列表没拿到。
    void loadOptions();
    // dialog 的身份（mode + 行）才是「重新打开」的信号；表单内部每次输入都换对象，不能进依赖
  }, [dialog?.mode, dialog?.row, dialog, loadOptions]);

  function selectTab(key: BaseDataTabKey) {
    setTabKey(key);
    // 切页签 = 换一张表：搜索与筛选都要清掉（保留 pageSize，那是使用者的展示偏好）。
    // 提示条同理：它是上一张表的操作结果，留在新表上会让人以为刚刚在这里做了什么
    setQuery((prev) => ({ ...EMPTY_QUERY, pageSize: prev.pageSize }));
    setSearchDraft('');
    setNotice(null);
    setActionError(null);
  }

  function openCreate() {
    setNotice(null);
    setActionError(null);
    setDialog({
      mode: 'create',
      row: null,
      original: {},
      values: emptyFormValues(tabKey),
      errors: {},
      formError: null
    });
  }

  function openEdit(row: BaseDataRow) {
    setNotice(null);
    setActionError(null);
    const values = formValuesOfRow(tabKey, row);
    setDialog({ mode: 'edit', row, original: values, values, errors: {}, formError: null });
  }

  /**
   * 编辑边时，两端节点的选项必须包含该行当前绑定的节点。
   *
   * 不包含会**静默改数据**：`<select>` 的 `value` 不在选项里时浏览器显示第一项，
   * 使用者什么都没做、保存时却把端点换成了另一个节点。因此这里把缺失的端点补成选项。
   */
  const dialogNodeOptions = useMemo(() => {
    if (dialog?.mode !== 'edit' || tabKey !== 'edges' || !dialog.row) {
      return nodeOptions;
    }
    const edge = dialog.row as { fromNodeId: string; fromNodeCode: string; toNodeId: string; toNodeCode: string };
    const missing = [
      { id: edge.fromNodeId, code: edge.fromNodeCode },
      { id: edge.toNodeId, code: edge.toNodeCode }
    ].filter((endpoint) => !nodeOptions.some((option) => option.value === endpoint.id));
    return [...missing.map((endpoint) => ({ value: endpoint.id, label: `${endpoint.code} ·（不在当前节点列表）` })), ...nodeOptions];
  }, [dialog?.mode, dialog?.row, tabKey, nodeOptions]);

  async function submitDialog() {
    if (!dialog) {
      return;
    }
    const built = buildWritePayload(tabKey, dialog.values, dialog.mode === 'create' ? 'create' : 'patch', dialog.original);
    if (!built.ok) {
      setDialog({ ...dialog, errors: built.fields, formError: null });
      return;
    }
    if (dialog.mode === 'edit' && Object.keys(built.payload).length === 0) {
      // 空补丁打过去不会报错，只是什么都没做 —— 那是最难察觉的一种「没生效」，直接说清楚
      setDialog({ ...dialog, errors: {}, formError: '没有任何修改' });
      return;
    }
    const path = dialog.mode === 'create' ? tab.path : `${tab.path}/${dialog.row!.id}`;
    const outcome = await write.run(
      path,
      dialog.mode === 'create' ? 'POST' : 'PUT',
      built.payload,
      dialog.mode === 'create' ? `已新增${tab.label}记录` : `已保存${tab.label}修改`
    );
    if (outcome.ok) {
      setDialog(null);
      setNotice(outcome.message);
      list.refresh();
      return;
    }
    setDialog({ ...dialog, errors: outcome.fields, formError: outcome.formError });
  }

  async function toggleStatus(row: BaseDataRow) {
    const action = statusActionOf(tabKey, String((row as { status?: string }).status ?? ''));
    const outcome = await write.run(`${tab.path}/${row.id}/status`, 'PATCH', { status: action.next }, `已${action.label}“${rowTitleOf(row)}”`);
    setNotice(outcome.ok ? outcome.message : null);
    setActionError(outcome.ok ? null : (outcome.formError ?? '操作失败'));
    if (outcome.ok) {
      list.refresh();
    }
  }

  /**
   * 运维标记：标记故障 / 恢复可用（`AGENTS.md` D-62）。
   *
   * 走的是与启停**同一个**接口（`PATCH .../status`），只是取值不同 ——
   * 动作与文案由 `faultActionOf` 决定，页面不自己判断状态。
   */
  async function toggleFault(row: BaseDataRow) {
    const action = faultActionOf(tabKey, String((row as { status?: string }).status ?? ''));
    if (!action) {
      return;
    }
    const outcome = await write.run(`${tab.path}/${row.id}/status`, 'PATCH', { status: action.next }, `已${action.label}“${rowTitleOf(row)}”`);
    setNotice(outcome.ok ? outcome.message : null);
    setActionError(outcome.ok ? null : (outcome.formError ?? '操作失败'));
    if (outcome.ok) {
      list.refresh();
    }
  }

  /** 物理删除（目前只有禁行规则）。**必须二次确认**：删掉的行不会进回收站。 */
  async function confirmDelete() {
    const row = pendingDelete;
    if (!row) {
      return;
    }
    const outcome = await write.run(`${tab.path}/${row.id}`, 'DELETE', {}, `已删除“${rowTitleOf(row)}”`);
    setPendingDelete(null);
    setNotice(outcome.ok ? outcome.message : null);
    setActionError(outcome.ok ? null : (outcome.formError ?? '操作失败'));
    if (outcome.ok) {
      list.refresh();
    }
  }

  function onFieldChange(name: string, value: string) {
    setDialog((prev) => {
      if (!prev) {
        return prev;
      }
      const values = { ...prev.values, [name]: value };
      if (tabKey === 'restrictions' && name === 'type') {
        // 切换目标类型时**清空已选目标**：节点与边的 id 是两套空间，
        // 留着旧值会让下拉显示一个「不在候选里」的占位项，提交后被服务端判为
        // 「目标不存在」—— 那是使用者切换类型之后的必然结果，不该由他去排查
        values['targetId'] = '';
      }
      return { ...prev, values, errors: { ...prev.errors, [name]: '', ...(tabKey === 'restrictions' && name === 'type' ? { targetId: '' } : {}) } };
    });
  }

  return (
    <div className="udm-page">
      <section className="udm-list__toolbar" role="group" aria-label="基础数据分类">
        <div className="udm-list__tabs">
          {BASE_DATA_TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={item.key === tabKey ? 'udm-list__tab is-active' : 'udm-list__tab'}
              aria-pressed={item.key === tabKey}
              onClick={() => selectTab(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="udm-list__filters">
          {tab.search ? (
            <label className="udm-field udm-list__search">
              <span className="udm-sr-only">{tab.search.placeholder}</span>
              <IconSearch size={14} />
              <input
                type="search"
                value={searchDraft}
                placeholder={tab.search.placeholder}
                onChange={(event) => setSearchDraft(event.target.value)}
              />
            </label>
          ) : null}

          {tab.typeOptions ? (
            <label className="udm-field udm-list__select">
              <span className="udm-sr-only">按类型筛选</span>
              <select value={query.type} onChange={(event) => setQuery((prev) => ({ ...prev, type: event.target.value, page: 1 }))}>
                <option value="">全部类型</option>
                {tab.typeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {/* 状态维度不存在时**不渲染**这个下拉：一个永远筛不出东西的下拉比没有下拉更糟 */}
          {tab.statusOptions.length > 0 ? (
            <label className="udm-field udm-list__select">
              <span className="udm-sr-only">按状态筛选</span>
              <select value={query.status} onChange={(event) => setQuery((prev) => ({ ...prev, status: event.target.value, page: 1 }))}>
                <option value="">全部状态</option>
                {tab.statusOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <button type="button" className="udm-btn udm-btn--ghost" onClick={list.refresh}>
            <IconRefresh size={14} />
            刷新
          </button>

          {canWrite ? (
            <button type="button" className="udm-btn udm-btn--primary" onClick={openCreate}>
              新增{tab.label}
            </button>
          ) : null}
        </div>
      </section>

      {tab.search ? <p className="udm-list__hint">{tab.search.hint}</p> : null}

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

      <section className="udm-card udm-list__card" aria-label={`${tab.label}列表`}>
        {list.loading && list.records.length === 0 ? (
          <div className="udm-empty" role="status">
            <span className="udm-spinner" aria-hidden="true" />
            <p className="udm-empty__title">正在加载{tab.label}…</p>
          </div>
        ) : list.records.length === 0 ? (
          <div className="udm-empty" role="status">
            <p className="udm-empty__title">没有可显示的记录</p>
            <p className="udm-empty__hint">{tab.emptyHint}</p>
          </div>
        ) : (
          <div className="udm-table__wrap">
            <table className="udm-table">
              <caption className="udm-sr-only">
                {tab.label}列表，共 {list.total} 条，第 {list.page} / {pages} 页
              </caption>
              <thead>
                <tr>
                  {tab.columns.map((column) => (
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
                  // 启停按钮只在**有 status 列**的页签上出现：模板与禁行规则都没有
                  // 「一键启停」这回事（前者无状态列，后者的失效是要写理由的编辑动作）
                  const supportsStatus = tab.statusToggle !== false;
                  const rowStatus = String((row as { status?: string }).status ?? '');
                  const action = supportsStatus ? statusActionOf(tabKey, rowStatus) : null;
                  const blocked = supportsStatus ? statusBlockedReason(tabKey, row) : null;
                  // 运维标记（只有车辆页签会返回非 null）：与启停并列的第二颗按钮，见 D-62
                  const faultAction = supportsStatus ? faultActionOf(tabKey, rowStatus) : null;
                  return (
                    <tr key={row.id}>
                      {tab.columns.map((column) => (
                        <td key={column.key} className={column.align === 'right' ? 'udm-table__num' : undefined}>
                          {column.cell(row)}
                        </td>
                      ))}
                      {canWrite ? (
                        <td className="udm-table__actions">
                          <div className="udm-list__row-actions">
                            <button type="button" className="udm-btn udm-btn--ghost" onClick={() => openEdit(row)} disabled={write.busy}>
                              编辑
                            </button>
                            {action ? (
                              <button
                                type="button"
                                className="udm-btn udm-btn--ghost"
                                onClick={() => void toggleStatus(row)}
                                disabled={write.busy || blocked !== null}
                                title={blocked ?? undefined}
                              >
                                {action.label}
                              </button>
                            ) : null}
                            {faultAction ? (
                              <button
                                type="button"
                                className="udm-btn udm-btn--ghost"
                                onClick={() => void toggleFault(row)}
                                disabled={write.busy}
                                title="人工报障：把车标记为故障（修好后点「恢复可用」）——派发到它的任务会在告警中心被列为执行风险"
                              >
                                {faultAction.label}
                              </button>
                            ) : null}
                            {tab.removable ? (
                              <button
                                type="button"
                                className="udm-btn udm-btn--danger"
                                onClick={() => setPendingDelete(row)}
                                disabled={write.busy}
                                title="物理删除：记录从库中移除，仅在审计里留下痕迹"
                              >
                                删除
                              </button>
                            ) : null}
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
            ? '新增 / 编辑 / 启停都会写审计留痕，并由主进程按服务端校验执行（前端只做必填与数字格式的即时提示）。'
            : '当前角色只能查询：新增 / 编辑 / 停用需要 base:write 权限（admin）。'}
          {' '}
          相关实体在地图上的位置见 <Link to="/map">地图</Link>。
        </span>
      </p>

      {pendingDelete ? (
        <div className="udm-overlay" role="presentation">
          <div className="udm-dialog udm-dialog--confirm" role="alertdialog" aria-modal="true" aria-label="确认删除">
            <header className="udm-dialog__head">
              <h2 className="udm-dialog__title">确认删除</h2>
            </header>
            <div className="udm-dialog__body">
              <p>
                即将<strong>物理删除</strong>“{rowTitleOf(pendingDelete)}”。这一步不可撤销：
                记录会从库中移除，只在审计日志里留下「谁在什么时候删的、删的是什么」。
              </p>
              <p className="udm-list__hint">
                如果只是想让这条规则暂时不生效，请改用「编辑 → 状态 = 已失效」——记录会保留。
              </p>
            </div>
            <footer className="udm-dialog__foot">
              <button type="button" className="udm-btn udm-btn--ghost" onClick={() => setPendingDelete(null)} disabled={write.busy}>
                取消
              </button>
              <button type="button" className="udm-btn udm-btn--danger" onClick={() => void confirmDelete()} disabled={write.busy}>
                {write.busy ? '删除中…' : '确认删除'}
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {dialog ? (
        <EntityFormDialog
          title={dialog.mode === 'create' ? FORM_SPECS[tabKey].titleCreate : FORM_SPECS[tabKey].titleEdit}
          fields={FORM_SPECS[tabKey].fields}
          values={dialog.values}
          errors={dialog.errors}
          formError={dialog.formError}
          busy={write.busy}
          submitLabel={dialog.mode === 'create' ? '创建' : '保存'}
          editing={dialog.mode === 'edit'}
          candidates={{ node: dialogNodeOptions }}
          targetOptions={{ node: nodeOptions, edge: edgeOptions }}
          onChange={onFieldChange}
          onSubmit={() => void submitDialog()}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * 调度台（M4，`docs/api.md` §3.4）。
 *
 * ## 这一屏回答的三个问题
 *
 *   1. **派给谁** —— 左边选任务与策略，点「预览」；
 *   2. **哪个策略更好** —— `all` 一次跑两个策略，右侧对比表 + 一句推荐；
 *   3. **到底派了没有** —— 「应用派发」要二次确认，确认清单里逐条列出「任务 → 车辆」，
 *      落库后左下角给出回执，右下角的调度日志留痕。
 *
 * ## 三条刻意的设计
 *
 *   1. **预览与应用分开**（`design.md` §4.4「先预览后生效」）：预览只读，应用才落库。
 *      按钮文案也据此区分（「预览」/「应用派发」），不用一个「执行」把两件事混起来。
 *   2. **候选池只列 `pending` 任务**：已派发的任务要改派走「重算」或任务页的「重派」，
 *      把它们混进候选池里，点了预览只会得到一句 `TASK.STATE_CONFLICT`。
 *   3. **应用的是「屏幕上那一份」**：请求体只带 `requestId`（服务端回读预览存档），
 *      所以不存在「点应用时算法又跑了一遍、结果变了」这种事（§10.2）。
 *
 * 这里**不做**任何可行性判断：谁能派、代价多少、为什么被拒全部来自服务端
 * （主进程与浏览器 Mock 跑的是同一份内核）。界面只负责把结构化结果讲清楚。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  MAX_PAGE_SIZE,
  hasPermission,
  type DispatchStrategyInfo,
  type PreviewResult,
  type TaskListItem,
  type VehicleListItem
} from '@udm/shared';
import { apiClient } from '../api';
import { usePagedList } from '../api/usePagedList';
import { IconDispatch, IconInfo, IconRefresh, IconWarning } from '../components/icons';
import { useNavigate } from 'react-router-dom';
import { useSessionStore } from '../store/session';
import { useSelectionStore } from '../store/selection';
import { vehicleNodeId } from '../map/model/ids';
import { TASK_PRIORITY_LABEL } from '../domain/labels';
import { ConfirmDispatchDialog } from './ConfirmDispatchDialog';
import { DispatchLogPanel } from './DispatchLogPanel';
import {
  applyPayload,
  canApply as canApplyPlans,
  candidateOptions,
  confirmLinesOf,
  confirmRejectLinesOf,
  differenceLinesOf,
  manualAssignPayload,
  outcomeOf,
  outcomeRowOf,
  planRowOf,
  previewPayload,
  recommendationOf,
  recomputePayload,
  rejectRowOf,
  selectionState,
  strategyLabel,
  strategyOptions,
  taskCodesOf,
  vehiclePlanGroupsOf,
  type PreviewSelection
} from './model';

type Busy = 'preview' | 'apply' | 'manual' | 'recompute' | null;

export function DispatchConsole() {
  const token = useSessionStore((state) => state.token);
  const role = useSessionStore((state) => state.user?.role);
  const canPreview = role !== undefined && hasPermission(role, 'dispatch:preview');
  const canApply = role !== undefined && hasPermission(role, 'dispatch:apply');

  const pendingQuery = useMemo(() => ({ status: 'pending', page: 1, pageSize: MAX_PAGE_SIZE }), []);
  const assignedQuery = useMemo(() => ({ status: 'assigned,running,paused', page: 1, pageSize: MAX_PAGE_SIZE }), []);
  const vehicleQuery = useMemo(() => ({ page: 1, pageSize: MAX_PAGE_SIZE }), []);
  const pending = usePagedList<TaskListItem>('/api/tasks', pendingQuery, token);
  const assigned = usePagedList<TaskListItem>('/api/tasks', assignedQuery, token);
  const vehicles = usePagedList<VehicleListItem>('/api/vehicles', vehicleQuery, token);

  const [strategies, setStrategies] = useState<DispatchStrategyInfo[]>([]);
  const [strategy, setStrategy] = useState<PreviewSelection>('greedy');
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [activeStrategy, setActiveStrategy] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /*
   * 刚派发出去的那一批（用于「去地图上看」）。
   *
   * 为什么要留一个 state 而不是渲染完就丢：派发是这一页唯一会**改变世界**的动作，
   * 使用者紧接着要做的几乎一定是「去看看车现在在哪」。
   * 只留一条「已派发 N 单」的提示，等于把下一步交给使用者自己找。
   */
  const [applied, setApplied] = useState<{ vehicles: Array<{ id: string; code: string }>; count: number } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [logsRevision, setLogsRevision] = useState(0);
  const [manual, setManual] = useState({ taskId: '', vehicleId: '', reason: '' });
  const [recomputeForm, setRecomputeForm] = useState({ taskId: '', reason: '' });
  const navigate = useNavigate();
  const select = useSelectionStore((state) => state.select);

  const candidates = useMemo(() => candidateOptions(pending.records), [pending.records]);
  const taskCodes = useMemo(() => taskCodesOf(pending.records), [pending.records]);
  const strategyList = useMemo(() => strategyOptions(strategies), [strategies]);
  const idleVehicles = useMemo(() => vehicles.records.filter((item) => item.status === 'idle'), [vehicles.records]);
  const activeOutcome = outcomeOf(preview, activeStrategy ?? strategy);
  const recommendation = useMemo(() => recommendationOf(preview?.strategies ?? []), [preview]);
  const allSelected = selectionState(selected, candidates) === 'all';
  const differences = useMemo(
    () => differenceLinesOf(preview?.strategies ?? [], recommendation.strategy),
    [preview, recommendation.strategy]
  );
  // 按车辆分组的明细：平铺表看不出「接力」，这一份视图专门给它
  const fleetGroups = useMemo(
    () => (activeOutcome ? vehiclePlanGroupsOf(activeOutcome, taskCodes) : []),
    [activeOutcome, taskCodes]
  );

  // 策略清单来自服务端（`enabled` 决定哪一项可用），失败时不阻塞页面：下拉仍有 `all` 一项
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await apiClient.invoke<DispatchStrategyInfo[]>('/api/dispatch/strategies', {}, token);
      if (!cancelled && result.code === 0) {
        setStrategies(result.data);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const refreshAll = useCallback(() => {
    pending.refresh();
    assigned.refresh();
    vehicles.refresh();
    setLogsRevision((value) => value + 1);
    // `refresh` 的引用稳定（`usePagedList` 里是空依赖的 `useCallback`），
    // 因此这里不必把三个 hook 整个放进依赖数组（那会在每次渲染时重建）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 别的窗口（或另一个页面）改了任务 / 车辆时，候选池与已派发清单要跟着更新
  useEffect(() => {
    const unsubscribe = apiClient.on(null, (message) => {
      if (message.type === 'task.changed' || message.type === 'vehicle.changed') {
        pending.refresh();
        assigned.refresh();
        vehicles.refresh();
        setLogsRevision((value) => value + 1);
      }
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 统一处理失败：`detail.fields` 的字段级信息比一句总述更能指到该改哪里。 */
  const failureText = useCallback((result: { message: string; detail?: unknown }): string => {
    const fields = (result.detail as { fields?: Record<string, string> } | undefined)?.fields;
    if (fields && Object.keys(fields).length > 0) {
      return `${result.message}：${Object.values(fields).join('；')}`;
    }
    const specifics = (result.detail as { message?: unknown } | undefined)?.message;
    return typeof specifics === 'string' && specifics ? `${result.message}：${specifics}` : result.message;
  }, []);

  const runPreview = useCallback(async () => {
    if (selected.length === 0) {
      setError('请先勾选至少一条待派任务');
      return;
    }
    setBusy('preview');
    setError(null);
    setNotice(null);
    try {
      const result = await apiClient.invoke<PreviewResult>('/api/dispatch/preview', previewPayload(selected, strategy), token, {
        method: 'POST'
      });
      if (result.code === 0) {
        setPreview(result.data);
        setActiveStrategy(result.data.strategies[0]?.strategy ?? null);
      } else {
        // 失败时清掉上一次的预览：留着它会被读成「这次的输入算出了这个方案」
        setPreview(null);
        setActiveStrategy(null);
        setError(failureText(result));
      }
    } finally {
      setBusy(null);
    }
  }, [failureText, selected, strategy, token]);

  const runApply = useCallback(async () => {
    const outcome = outcomeOf(preview, activeStrategy ?? strategy);
    if (!preview || !outcome) {
      return;
    }
    setBusy('apply');
    setError(null);
    try {
      const result = await apiClient.invoke<{
        appliedPlans: Array<{ vehicleId: string; vehicleCode: string }>;
        summary: { assigned: number };
      }>(
        '/api/dispatch/apply',
        applyPayload(preview.requestId, outcome.strategy),
        token,
        { method: 'POST' }
      );
      if (result.code === 0) {
        setNotice(`已派发 ${result.data.appliedPlans.length} 单（${strategyLabel(outcome.strategy)}）`);
        // 去重：同一台车在这批里可能接了两单（接力），「去看车」只需要去一次
        const uniqueVehicles = new Map<string, string>();
        for (const plan of result.data.appliedPlans) {
          uniqueVehicles.set(plan.vehicleId, plan.vehicleCode);
        }
        setApplied({
          vehicles: [...uniqueVehicles].map(([id, code]) => ({ id, code })),
          count: result.data.appliedPlans.length
        });
        setPreview(null);
        setActiveStrategy(null);
        setSelected([]);
        setConfirming(false);
        refreshAll();
      } else {
        setConfirming(false);
        setError(failureText(result));
      }
    } finally {
      setBusy(null);
    }
  }, [activeStrategy, failureText, preview, refreshAll, strategy, token]);

  const runManual = useCallback(async () => {
    setBusy('manual');
    setError(null);
    setNotice(null);
    try {
      const result = await apiClient.invoke<{ appliedPlans: Array<{ vehicleCode: string }> }>(
        '/api/dispatch/manual-assign',
        manualAssignPayload(manual.taskId, manual.vehicleId, manual.reason),
        token,
        { method: 'POST' }
      );
      if (result.code === 0) {
        setNotice(`已手动指派给 ${result.data.appliedPlans[0]?.vehicleCode ?? ''}`);
        setManual({ taskId: '', vehicleId: '', reason: '' });
        refreshAll();
      } else {
        setError(failureText(result));
      }
    } finally {
      setBusy(null);
    }
  }, [failureText, manual, refreshAll, token]);

  const runRecompute = useCallback(async () => {
    setBusy('recompute');
    setError(null);
    setNotice(null);
    try {
      const result = await apiClient.invoke<PreviewResult>(
        '/api/dispatch/recompute',
        recomputePayload(recomputeForm.taskId, strategy, recomputeForm.reason),
        token,
        { method: 'POST' }
      );
      if (result.code === 0) {
        // 重算**不自动应用**（§10.4）：把新预览显示出来，让人再看一眼
        setPreview(result.data);
        setActiveStrategy(result.data.strategies[0]?.strategy ?? null);
        setSelected(result.data.strategies[0]?.plans.map((plan) => plan.taskId) ?? []);
        setNotice('已回收原计划并重算，下面是新的建议（尚未应用）');
        setRecomputeForm({ taskId: '', reason: '' });
        refreshAll();
      } else {
        setError(failureText(result));
      }
    } finally {
      setBusy(null);
    }
  }, [failureText, recomputeForm, refreshAll, strategy, token]);

  const disabled = busy !== null;

  return (
    <div className="udm-dispatch">
      {/* ============ 左栏：选任务与策略 ============ */}
      <div className="udm-dispatch__col">
        <div className="udm-dispatch__block">
          <div className="udm-dispatch__block-head">
            <h3 className="udm-dispatch__block-title">待派任务（{candidates.length}）</h3>
            <button
              type="button"
              className="udm-btn udm-btn--ghost"
              onClick={() => setSelected(allSelected ? [] : candidates.map((item) => item.value))}
              disabled={candidates.length === 0 || disabled}
            >
              {allSelected ? '清空' : '全选'}
            </button>
          </div>

          {candidates.length === 0 ? (
            <div className="udm-empty">
              <div className="udm-empty__icon">
                <IconDispatch />
              </div>
              <p className="udm-empty__title">{pending.loading ? '加载中…' : '没有待派任务'}</p>
              <p className="udm-empty__hint">
                草稿任务在「任务管理」里提交后才会进入这里。已派发任务要改派请用下面的「重算」。
              </p>
            </div>
          ) : (
            <ul className="udm-dispatch__candidates">
              {candidates.map((item) => (
                <li key={item.value}>
                  <label className="udm-dispatch__candidate">
                    <input
                      type="checkbox"
                      checked={selected.includes(item.value)}
                      onChange={(event) =>
                        setSelected((current) =>
                          event.target.checked ? [...current, item.value] : current.filter((id) => id !== item.value)
                        )
                      }
                      disabled={disabled}
                    />
                    <span>
                      <span className="udm-dispatch__candidate-title">{item.label}</span>
                      <span className="udm-dispatch__candidate-meta">{item.detail}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}

          <div className="udm-dispatch__toolbar">
            <button type="button" className="udm-btn udm-btn--ghost" onClick={pending.refresh} disabled={pending.loading}>
              <IconRefresh /> 刷新候选池
            </button>
          </div>
        </div>

        <div className="udm-dispatch__block">
          <div className="udm-dispatch__block-head">
            <h3 className="udm-dispatch__block-title">策略</h3>
          </div>
          <fieldset className="udm-dispatch__strategies">
            <legend className="udm-sr-only">调度策略</legend>
            {strategyList.map((item) => (
              <label key={item.key} className="udm-dispatch__strategy" data-disabled={!item.enabled}>
                <input
                  type="radio"
                  name="dispatch-strategy"
                  value={item.key}
                  checked={strategy === item.key}
                  disabled={!item.enabled || disabled}
                  onChange={() => setStrategy(item.key as PreviewSelection)}
                />
                <span>
                  <span className="udm-dispatch__candidate-title">{item.label}</span>
                  <span className="udm-dispatch__strategy-desc">{item.description}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="udm-dispatch__actions">
            <button
              type="button"
              className="udm-btn udm-btn--primary"
              onClick={() => void runPreview()}
              disabled={!canPreview || disabled || candidates.length === 0}
            >
              {busy === 'preview' ? '计算中…' : '预览派发'}
            </button>
          </div>
          {!canPreview ? (
            <p className="udm-dispatch__hint">当前角色没有 `dispatch:preview` 权限，只能查看日志（主进程同样会拒绝，D-08）</p>
          ) : null}
        </div>

        {/* ============ 手动指派：约束由内核评估，不是绕过通道 ============ */}
        <div className="udm-dispatch__block">
          <div className="udm-dispatch__block-head">
            <h3 className="udm-dispatch__block-title">手动指派</h3>
          </div>
          <div className="udm-form__field">
            <label htmlFor="dispatch-manual-task">任务</label>
            <select
              id="dispatch-manual-task"
              value={manual.taskId}
              onChange={(event) => setManual((current) => ({ ...current, taskId: event.target.value }))}
              disabled={disabled}
            >
              <option value="">请选择…</option>
              {candidates.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
          <div className="udm-form__field">
            <label htmlFor="dispatch-manual-vehicle">车辆（仅空闲）</label>
            <select
              id="dispatch-manual-vehicle"
              value={manual.vehicleId}
              onChange={(event) => setManual((current) => ({ ...current, vehicleId: event.target.value }))}
              disabled={disabled}
            >
              <option value="">请选择…</option>
              {idleVehicles.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.code} · 载重 {item.capacityKg}kg
                </option>
              ))}
            </select>
          </div>
          <div className="udm-form__field">
            <label htmlFor="dispatch-manual-reason">原因（必填）</label>
            <input
              id="dispatch-manual-reason"
              value={manual.reason}
              onChange={(event) => setManual((current) => ({ ...current, reason: event.target.value }))}
              placeholder="例如：客户指定车辆"
              disabled={disabled}
            />
          </div>
          <div className="udm-dispatch__actions">
            <button
              type="button"
              className="udm-btn"
              onClick={() => void runManual()}
              disabled={!canApply || disabled || !manual.taskId || !manual.vehicleId || manual.reason.trim() === ''}
            >
              {busy === 'manual' ? '指派中…' : '确认指派'}
            </button>
          </div>
          <p className="udm-dispatch__hint">与自动派发同一套约束校验：不可用 / 超载 / 时间窗冲突都会被拒并说明原因。</p>
        </div>

        {/* ============ 重算：回收 + 新预览，不自动应用 ============ */}
        <div className="udm-dispatch__block">
          <div className="udm-dispatch__block-head">
            <h3 className="udm-dispatch__block-title">重算（已派发任务）</h3>
          </div>
          <div className="udm-form__field">
            <label htmlFor="dispatch-recompute-task">任务</label>
            <select
              id="dispatch-recompute-task"
              value={recomputeForm.taskId}
              onChange={(event) => setRecomputeForm((current) => ({ ...current, taskId: event.target.value }))}
              disabled={disabled}
            >
              <option value="">请选择…</option>
              {assigned.records.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.code} · {TASK_PRIORITY_LABEL[task.priority]} · {task.vehicleCode ?? '未指派'}
                </option>
              ))}
            </select>
          </div>
          <div className="udm-form__field">
            <label htmlFor="dispatch-recompute-reason">原因（必填）</label>
            <input
              id="dispatch-recompute-reason"
              value={recomputeForm.reason}
              onChange={(event) => setRecomputeForm((current) => ({ ...current, reason: event.target.value }))}
              placeholder="例如：A 仓封路"
              disabled={disabled}
            />
          </div>
          <div className="udm-dispatch__actions">
            <button
              type="button"
              className="udm-btn"
              onClick={() => void runRecompute()}
              disabled={
                !canApply || disabled || !recomputeForm.taskId || recomputeForm.reason.trim() === '' || strategy === 'all'
              }
            >
              {busy === 'recompute' ? '重算中…' : '回收并重算'}
            </button>
          </div>
          <p className="udm-dispatch__hint">原计划作废、车辆回收、任务回到「待派」，随后给出新的建议（需再确认才生效）。</p>
        </div>
      </div>

      {/* ============ 右栏：结果 ============ */}
      <div className="udm-dispatch__col">
        {error ? (
          <div className="udm-alert" role="alert">
            {error}
          </div>
        ) : null}
        {notice ? (
          <div className="udm-dispatch__notice" role="status">
            <span>{notice}</span>
            {/*
              派发是这一页唯一会改变世界的动作，而「它到底变成了什么样」只有地图答得了：
              车在哪、走哪条线、什么时候开始动。因此这里必须给一条直达路径，
              而不是让使用者自己想起来「还有个地图页」。
            */}
            {applied && applied.vehicles.length > 0 ? (
              <button
                type="button"
                className="udm-btn udm-btn--ghost udm-dispatch__to-map"
                title="在地图上选中这批派发里的第一台车"
                onClick={() => {
                  const first = applied.vehicles[0]!;
                  select({
                    entityType: 'vehicle',
                    entityId: first.id,
                    flowId: vehicleNodeId(first.id),
                    label: first.code
                  });
                  navigate('/map');
                }}
              >
                在地图上查看这 {applied.vehicles.length} 台车
              </button>
            ) : null}
          </div>
        ) : null}

        {preview ? (
          <>
            <div className={`udm-dispatch__reco udm-dispatch__reco--${recommendation.tone}`} role="status">
              {recommendation.text}
            </div>

            <div className="udm-dispatch__block">
              <div className="udm-dispatch__block-head">
                <h3 className="udm-dispatch__block-title">策略对比</h3>
                <span className="udm-card__aside">
                  request <code>{preview.requestId}</code>
                </span>
              </div>
              <div className="udm-table__wrap">
                <table className="udm-table">
                  <thead>
                    <tr>
                      <th>策略</th>
                      <th className="udm-table__num">指派 / 任务</th>
                      <th className="udm-table__num">拒绝</th>
                      <th className="udm-table__num">执行里程</th>
                      <th className="udm-table__num">行驶耗时</th>
                      <th className="udm-table__num">全部完成</th>
                      <th className="udm-table__num">用车</th>
                      <th className="udm-table__num">总代价</th>
                      <th className="udm-table__num">算法耗时</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {preview.strategies.map((outcome) => {
                      const row = outcomeRowOf(outcome, recommendation.strategy);
                      return (
                        <tr key={row.strategy} className={row.recommended ? 'udm-dispatch__row--pick' : undefined}>
                          <td>{row.label}</td>
                          <td className="udm-table__num">
                            {row.assigned} / {row.totalTasks}
                          </td>
                          <td className="udm-table__num">{row.rejectedCount}</td>
                          <td className="udm-table__num">{row.distance}</td>
                          <td className="udm-table__num">{row.drive}</td>
                          <td className="udm-table__num">{row.finishAt}</td>
                          <td className="udm-table__num">{row.fleet}</td>
                          <td className="udm-table__num">{row.totalCost}</td>
                          <td className="udm-table__num">{row.elapsedMs}ms</td>
                          <td className="udm-table__actions">
                            <button
                              type="button"
                              className="udm-btn udm-btn--ghost"
                              onClick={() => setActiveStrategy(row.strategy)}
                              disabled={activeStrategy === row.strategy}
                            >
                              {activeStrategy === row.strategy ? '当前查看' : '查看明细'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {differences.length > 0 ? (
                <ul className="udm-dispatch__diffs">
                  {differences.map((item) => (
                    <li key={item.strategy}>{item.text}</li>
                  ))}
                </ul>
              ) : null}
              <p className="udm-dispatch__hint">
                「执行里程」只算任务起点 → 终点的载货段（空驶段没有路线摘要，故不计入）；
                「行驶耗时」= 空驶 + 执行，即车真正在动的时间。「用车」里标出的接力，
                指同一台车在这批里连跑两单。
              </p>
            </div>

            {activeOutcome ? (
              <div className="udm-dispatch__block">
                <div className="udm-dispatch__block-head">
                  <h3 className="udm-dispatch__block-title">派发明细</h3>
                  <div className="udm-dispatch__toolbar">
                    <button
                      type="button"
                      className="udm-btn udm-btn--primary"
                      onClick={() => setConfirming(true)}
                      disabled={!canApply || !canApplyPlans(activeOutcome, disabled)}
                    >
                      应用这 {activeOutcome.plans.length} 条派发
                    </button>
                  </div>
                </div>

                {activeOutcome.plans.length === 0 ? (
                  <p className="udm-empty__hint">这个策略没有派出任何任务，原因见下面的「拒绝原因」。</p>
                ) : (
                  <div className="udm-table__wrap">
                    <table className="udm-table">
                      <thead>
                        <tr>
                          <th>任务</th>
                          <th>车辆</th>
                          <th>路线（载货段）</th>
                          <th className="udm-table__num">空驶</th>
                          <th className="udm-table__num">执行</th>
                          <th className="udm-table__num">等待</th>
                          <th className="udm-table__num">晚点</th>
                          <th className="udm-table__num">续航风险</th>
                          <th className="udm-table__num">代价</th>
                          <th className="udm-table__num">预计完成</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeOutcome.plans.map((plan) => {
                          const row = planRowOf(plan, taskCodes);
                          return (
                            <tr key={plan.taskId}>
                              <td>{row.taskCode}</td>
                              <td>{row.vehicleCode}</td>
                              <td className={row.routeSegments === 0 ? 'udm-dispatch__noroute' : undefined}>{row.route}</td>
                              <td className="udm-table__num">{row.deadheadS}</td>
                              <td className="udm-table__num">{row.executeS}</td>
                              <td className="udm-table__num">{row.waitS}</td>
                              <td className="udm-table__num">{row.lateS}</td>
                              <td className="udm-table__num">{row.chargeRisk}</td>
                              <td className="udm-table__num">{row.cost}</td>
                              <td className="udm-table__num">{row.doneAt}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {fleetGroups.length > 0 ? (
                  <div className="udm-dispatch__fleet">
                    <p className="udm-dispatch__confirm-sub">
                      按车辆分组（同一台车有第 2 单即为<strong>接力</strong>，顺序就是它跑单的先后）：
                    </p>
                    {fleetGroups.map((group) => (
                      <div key={group.vehicleId} className="udm-dispatch__fleet-group">
                        <p className="udm-dispatch__fleet-head">
                          <strong>{group.vehicleCode}</strong>
                          <span
                            className={`udm-badge ${group.relay ? 'udm-badge--info' : 'udm-badge--ok'}`}
                          >
                            {group.relay ? `接力 ${group.steps.length} 单` : '单趟'}
                          </span>
                        </p>
                        <ol className="udm-dispatch__fleet-steps">
                          {group.steps.map((step) => (
                            <li key={step.taskId}>
                              <span className="udm-dispatch__fleet-seq">第 {step.seq} 单</span>
                              <span className="udm-dispatch__fleet-task">{step.taskCode}</span>
                              <span className="udm-dispatch__fleet-time">
                                {step.beginsAt} → {step.doneAt}
                              </span>
                              <span className="udm-dispatch__fleet-meta">
                                {step.distanceM} m · 空驶 {step.deadheadS} + 执行 {step.executeS} · 代价{' '}
                                {step.cost}
                              </span>
                            </li>
                          ))}
                        </ol>
                      </div>
                    ))}
                  </div>
                ) : null}

                {activeOutcome.rejected.length > 0 ? (
                  <>
                    <p className="udm-dispatch__confirm-sub">拒绝原因：</p>
                    <div className="udm-table__wrap">
                      <table className="udm-table">
                        <thead>
                          <tr>
                            <th>任务</th>
                            <th>原因</th>
                            <th>具体情况</th>
                          </tr>
                        </thead>
                        <tbody>
                          {activeOutcome.rejected.map((item) => {
                            const row = rejectRowOf(item, taskCodes);
                            return (
                              <tr key={item.taskId}>
                                <td>{row.taskCode}</td>
                                <td>{row.reason}</td>
                                <td className="udm-dispatch__reason">{row.detail}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}
          </>
        ) : (
          <div className="udm-dispatch__block">
            <div className="udm-empty">
              <div className="udm-empty__icon">
                <IconDispatch />
              </div>
              <p className="udm-empty__title">还没有预览结果</p>
              <p className="udm-empty__hint">
                勾选左边的待派任务、选一个策略（或「全部（对比）」），然后点「预览派发」。
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ============ 日志：跨两栏 ============ */}
      <div className="udm-dispatch__logs" style={{ gridColumn: '1 / -1' }}>
        <div className="udm-dispatch__block">
          <DispatchLogPanel token={token} revision={logsRevision} />
        </div>
      </div>

      {confirming && activeOutcome ? (
        <ConfirmDispatchDialog
          title={`确认应用派发（${activeOutcome.plans.length} 条）`}
          lines={confirmLinesOf(activeOutcome, taskCodes)}
          rejectLines={confirmRejectLinesOf(activeOutcome, taskCodes)}
          busy={busy === 'apply'}
          onConfirm={() => void runApply()}
          onCancel={() => setConfirming(false)}
        />
      ) : null}

      {pending.error ? (
        <p className="udm-dispatch__hint">
          <IconWarning /> 候选池加载失败：{pending.error}
        </p>
      ) : null}
    </div>
  );
}

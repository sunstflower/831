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
  DISPATCH_UNSERVED_PENALTY_S,
  MAX_PAGE_SIZE,
  hasPermission,
  type PlanRiskReport,
  type SiteListItem,
  type TaskDetail,
  type DispatchStrategyInfo,
  type TaskTemplateListItem,
  type PreviewResult,
  type TaskListItem,
  type VehicleListItem
} from '@udm/shared';
import { apiClient } from '../api';
import { usePagedList } from '../api/usePagedList';
import { IconDispatch, IconInfo, IconRefresh, IconWarning } from '../components/icons';
import { Link, useNavigate } from 'react-router-dom';
import { useSessionStore } from '../store/session';
import { useSelectionStore } from '../store/selection';
import { vehicleNodeId } from '../map/model/ids';
import { COST_METRIC_LABEL, TASK_PRIORITY_LABEL } from '../domain/labels';
import { filterRiskReport, riskSummaryOf, shortTime } from '../ops/model';
import { RiskTable } from '../ops/RiskTable';
import { siteOptionsOf, templateOptionsOf } from '../task/form';
import { ConfirmDispatchDialog } from './ConfirmDispatchDialog';
import { DispatchLogPanel } from './DispatchLogPanel';
import { NewOrderDialog, type NewOrderResult } from './NewOrderDialog';
import { summarizeDispatchRun, type DispatchRunSummary, type DispatchStartAttempt } from './applyFlow';
import {
  applyPayload,
  assignmentDiffsOf,
  canApply as canApplyPlans,
  candidateOptions,
  confirmLinesOf,
  confirmRejectLinesOf,
  differenceLinesOf,
  manualAssignPayload,
  metricComparisonOf,
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
  const canStart = role !== undefined && hasPermission(role, 'execution:start');
  const canWriteTask = role !== undefined && hasPermission(role, 'task:write');

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
  /*
   * 「派发后立即开跑」（Req-M4-9 / D-58）。
   *
   * 默认值取**当前会话是否有 `execution:start`**：有权限的人默认拿到「应用完车就跑」的
   * 完整链路，没权限的人看不到这个开关（而不是看到一个点了会被服务端拒绝的开关）。
   * 勾选状态不落库、不进设置 —— 它是一次操作的参数，不是系统配置。
   */
  const [autoStart, setAutoStart] = useState(() => canStart);
  const [runSummary, setRunSummary] = useState<DispatchRunSummary | null>(null);
  const [orderDialog, setOrderDialog] = useState(false);
  const [siteOptions, setSiteOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [templateOptions, setTemplateOptions] = useState<Array<{ value: string; label: string }>>([]);
  /*
   * 本批次的冲突 / 超时预检（Req-M4-10）。
   *
   * `taskIds` 是**发起那次扫描时**的批次：报告本身可能更晚才回来，而批次不会变 ——
   * 用它过滤出「这次派发有关的风险」，同时把完整的报告链接到告警中心。
   */
  const [risk, setRisk] = useState<{
    report: PlanRiskReport | null;
    loading: boolean;
    error: string | null;
    taskIds: string[];
  }>({ report: null, loading: false, error: null, taskIds: [] });
  const navigate = useNavigate();
  const select = useSelectionStore((state) => state.select);

  /*
   * 新建订单弹层的候选项：**打开时才取**。
   *
   * 不在挂载时预取，是因为这一页最主要的路径是「派发已有任务」，而站点/模板清单
   * 只用在一个弹层里 —— 为一条不一定会走的路径多发两个请求，代价是首屏多两轮往返。
   */
  useEffect(() => {
    if (!orderDialog || !token) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const [sites, templates] = await Promise.all([
        apiClient.invoke<{ records: SiteListItem[] }>('/api/sites', { page: 1, pageSize: MAX_PAGE_SIZE }, token),
        apiClient.invoke<{ records: TaskTemplateListItem[] }>(
          '/api/task-templates',
          { page: 1, pageSize: MAX_PAGE_SIZE },
          token
        )
      ]);
      if (cancelled) {
        return;
      }
      if (sites.code === 0) {
        setSiteOptions(siteOptionsOf(sites.data.records));
      }
      if (templates.code === 0) {
        setTemplateOptions(templateOptionsOf(templates.data.records));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orderDialog, token]);

  /**
   * 拉一次预检，并记住「这次是给哪一批任务看的」。
   *
   * 判定与渲染之间有一段时间差（请求在飞），而批次是发起时确定的 ——
   * 因此把 `taskIds` 与报告放在同一个 state 里更新，避免出现
   * 「报告是旧批次的、批次是新的」这种半新半旧（`ops/model.ts` 的 `filterRiskReport` 只做过滤）。
   */
  const loadRisks = useCallback(
    async (taskIds: readonly string[]) => {
      setRisk((current) => ({ ...current, loading: true, error: null, taskIds: [...taskIds] }));
      const result = await apiClient.invoke<PlanRiskReport>('/api/alerts/risks', {}, token);
      setRisk((current) =>
        result.code === 0
          ? { report: result.data, loading: false, error: null, taskIds: current.taskIds }
          : { ...current, loading: false, error: result.message }
      );
    },
    [token]
  );

  const filteredRisk = useMemo(() => filterRiskReport(risk.report, risk.taskIds), [risk.report, risk.taskIds]);

  /** 新建订单成功后：刷新候选池、自动勾选它、并立刻看一次预检（它此刻一定「未分配车辆」）。 */
  const onOrderCreated = useCallback(
    (task: NewOrderResult) => {
      setOrderDialog(false);
      setRunSummary(null);
      /*
       * 也要清掉上一批的「在地图上查看这 N 台车」。
       *
       * 走查实测：不清时新订单的提示旁边会继续挂着**上一批**的车辆按钮
       * （如「已新建订单“T2026…”并提交到待派队列 在地图上查看这 2 台车」）——
       * 两个动作的产物并排出现，读起来像新建的这一单已经派了 2 台车。
       */
      setApplied(null);
      setNotice(`已新建订单“${task.code} · ${task.title}”并提交到待派队列`);
      pending.refresh();
      setSelected([task.id]);
      void loadRisks([task.id]);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [loadRisks]
  );

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
  // 逐指标对照（推荐策略为基准列）+ 逐任务「同一单派给了不同车」
  const metricComparison = useMemo(
    () => metricComparisonOf(preview?.strategies ?? [], recommendation.strategy),
    [preview, recommendation.strategy]
  );
  const assignmentDiffs = useMemo(
    () => assignmentDiffsOf(preview?.strategies ?? [], taskCodes, recommendation.strategy),
    [preview, recommendation.strategy, taskCodes]
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
        appliedPlans: Array<{ taskId: string; taskCode: string; vehicleId: string; vehicleCode: string }>;
        summary: { assigned: number };
      }>(
        '/api/dispatch/apply',
        applyPayload(preview.requestId, outcome.strategy),
        token,
        { method: 'POST' }
      );
      if (result.code === 0) {
        const plans = result.data.appliedPlans;
        // 去重：同一台车在这批里可能接了两单（接力），「去看车」只需要去一次
        const uniqueVehicles = new Map<string, string>();
        for (const plan of plans) {
          uniqueVehicles.set(plan.vehicleId, plan.vehicleCode);
        }
        setApplied({
          vehicles: [...uniqueVehicles].map(([id, code]) => ({ id, code })),
          count: plans.length
        });
        setPreview(null);
        setActiveStrategy(null);
        setSelected([]);
        setConfirming(false);

        /*
         * 逐单开跑（Req-M4-9 / D-58）。
         *
         * 为什么是**顺序**而不是 `Promise.all`：执行器的 start 各自写库并推遥测，
         * 并发发起时「哪一单先占用车辆」会由网络顺序决定，失败信息也会互相交错 ——
         * 演示规模下串行的耗时可以忽略，换来的是一条能逐单读的结果清单。
         */
        const attempts: DispatchStartAttempt[] = [];
        for (const plan of plans) {
          if (!autoStart || !canStart) {
            attempts.push({ taskId: plan.taskId, taskCode: plan.taskCode, vehicleCode: plan.vehicleCode, start: null });
            continue;
          }
          const started = await apiClient.invoke(`/api/execution/tasks/${plan.taskId}/start`, {}, token, {
            method: 'POST'
          });
          attempts.push({
            taskId: plan.taskId,
            taskCode: plan.taskCode,
            vehicleCode: plan.vehicleCode,
            start: started.code === 0 ? { ok: true } : { ok: false, message: failureText(started) }
          });
        }
        setRunSummary(summarizeDispatchRun(attempts, strategyLabel(outcome.strategy)));
        // 旧的一条「已派发 N 单」提示被更完整的结果块取代：两条并存会让人以为发生了两次派发
        setNotice(null);
        refreshAll();
        void loadRisks(plans.map((plan) => plan.taskId));
      } else {
        setConfirming(false);
        setError(failureText(result));
      }
    } finally {
      setBusy(null);
    }
  }, [activeStrategy, autoStart, canStart, failureText, loadRisks, preview, refreshAll, strategy, token]);

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

  /*
   * 「在地图上查看这批车」—— 派发与开跑两组回执都要它（见下面两处 `{toMapButton}`）。
   *
   * 抽成一个变量而不是在两个区块里各写一遍：重复的后果不是代码难看，而是两处的
   * 选中逻辑（写全局 selection 的哪个字段）会各自演化，其中一个改错不会有人发现。
   */
  const toMapButton =
    applied && applied.vehicles.length > 0 ? (
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
    ) : null;

  return (
    <div className="udm-dispatch">
      {/* ============ 左栏：选任务与策略 ============ */}
      <div className="udm-dispatch__col">
        <div className="udm-dispatch__block">
          <div className="udm-dispatch__block-head">
            <h3 className="udm-dispatch__block-title">待派任务（{candidates.length}）</h3>
            <div className="udm-dispatch__toolbar">
              {/*
                「新建订单」是这一页主链路的起点（Req-M4-8）：建单 → 入池 → 预览 → 派发 → 看车跑。
                权限点用现成的 `task:write`（与任务管理页的新建同一个点），没有它时按钮不出现 ——
                服务端同样会拒（D-08）。
              */}
              {canWriteTask ? (
                <button type="button" className="udm-btn udm-btn--primary" onClick={() => setOrderDialog(true)} disabled={disabled}>
                  新建订单
                </button>
              ) : null}
              <button
                type="button"
                className="udm-btn udm-btn--ghost"
                onClick={() => setSelected(allSelected ? [] : candidates.map((item) => item.value))}
                disabled={candidates.length === 0 || disabled}
              >
                {allSelected ? '清空' : '全选'}
              </button>
            </div>
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

        {/*
          高级操作收进折叠区（本轮的「精简」）：主链路是「新建订单 → 预览 → 应用 → 看车跑」，
          手动指派与回收重算都是**例外路径**（前者是人工指定、后者是数据变了要重排）。
          默认展开会让首屏被四个表单填满，而使用者 90% 的访问只需要前两块。
          收起不等于删除：折叠区里的按钮与接口调用完全不变，只是不再抢注意力。
        */}
        <details className="udm-dispatch__advanced">
          <summary className="udm-dispatch__advanced-summary">高级操作：手动指派 / 回收重算</summary>

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
        </details>
      </div>

      {/* ============ 右栏：结果 ============ */}
      <div className="udm-dispatch__col">
        {error ? (
          <div className="udm-alert" role="alert">
            {error}
          </div>
        ) : null}

        {/*
          派发 + 逐单开跑的**结果回执**（Req-M4-9 / D-58）。
          成功的部分与失败的部分都要出现：只报「派发成功」会让没开跑的那几单无人认领。
        */}
        {runSummary ? (
          <div className={`udm-dispatch__notice udm-dispatch__run udm-dispatch__notice--${runSummary.tone}`} role="status">
            <span className="udm-dispatch__run-head">
              <strong>{runSummary.headline}</strong>
              {toMapButton}
            </span>
            {runSummary.details.length > 0 ? (
              <ul className="udm-dispatch__run-details">
                {runSummary.details.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {/*
          本批次的冲突 / 超时预检（Req-M4-10）。判定由服务端给出（与告警中心同一份
          `GET /api/alerts/risks`），这里只展示**与本批任务有关**的那些条目。
        */}
        {risk.taskIds.length > 0 ? (
          <div className="udm-dispatch__block udm-risk" aria-label="本批次预检">
            <div className="udm-dispatch__block-head">
              <h3 className="udm-dispatch__block-title">本批次预检（冲突 / 超时）</h3>
              <span className="udm-card__aside">
                {risk.error
                  ? '读取失败'
                  : risk.loading && !filteredRisk
                    ? '扫描中…'
                    : filteredRisk
                      ? riskSummaryOf(filteredRisk.counts)
                      : '—'}
              </span>
            </div>
            <p className="udm-risk__lead">
              按<strong>当前</strong>的车辆—任务—路线分配，列出与本次操作相关、接下来可能撞上的事。
              它们不是告警（还没发生），因此不能「认领」—— 要么当场处理（改派 / 调时间窗），
              要么等它真的发生、由执行器落一条真告警。
            </p>
            {risk.error ? (
              <div className="udm-alert" role="alert">
                <IconWarning aria-hidden="true" />
                <span>预检读取失败：{risk.error}</span>
                <button type="button" className="udm-btn udm-btn--ghost" onClick={() => void loadRisks(risk.taskIds)}>
                  重试
                </button>
              </div>
            ) : !filteredRisk ? (
              <div className="udm-empty" role="status">
                <span className="udm-spinner" aria-hidden="true" />
                <p className="udm-empty__title">正在扫描当前的派发…</p>
              </div>
            ) : filteredRisk.records.length === 0 ? (
              <div className="udm-empty">
                <p className="udm-empty__title">本批次没有发现冲突或超时</p>
                <p className="udm-empty__hint">
                  扫描时刻 {shortTime(filteredRisk.scannedAt)}；未派车任务若在下面列出，说明它还没排上车。
                </p>
              </div>
            ) : (
              <RiskTable records={filteredRisk.records} />
            )}
            {filteredRisk && filteredRisk.unassignedTasks.length > 0 ? (
              <p className="udm-risk__foot">
                <IconInfo aria-hidden="true" />
                还有 <strong>{filteredRisk.unassignedTasks.length}</strong> 条待派任务没有安排车辆（
                {filteredRisk.unassignedTasks.slice(0, 6).map((row) => row.taskCode).join('、')}
                {filteredRisk.unassignedTasks.length > 6 ? ' 等' : ''}）。
              </p>
            ) : null}
            <p className="udm-risk__foot">
              <IconInfo aria-hidden="true" />
              完整预检与「任务分配派发」区块在 <Link to="/alerts">告警中心</Link>。
            </p>
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
            {toMapButton}
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
                      <th
                        className="udm-table__num"
                        title={`${COST_METRIC_LABEL}：越低越好。由空驶 / 执行 / 等待 / 晚点 / 续航风险加权得出，权重的唯一作者是 shared 的 DISPATCH_COST_WEIGHTS`}
                      >
                        {COST_METRIC_LABEL}
                      </th>
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

              {/*
                逐指标对照：推荐策略为基准列，其余列显示「值 + 相对基准的带符号差值」。
                差值列是这一屏存在的理由 —— 只看两行绝对值，读者仍要自己做减法。
              */}
              {metricComparison ? (
                <div className="udm-dispatch__compare">
                  <h4 className="udm-dispatch__sub-title">差异对照（逐指标）</h4>
                  <div className="udm-table__wrap">
                    <table className="udm-table">
                      <thead>
                        <tr>
                          <th>指标</th>
                          {metricComparison.columns.map((column) => (
                            <th key={column.strategy} className="udm-table__num">
                              {column.label}
                              {column.base ? <span className="udm-dispatch__base-tag">基准</span> : null}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {metricComparison.rows.map((row) => (
                          <tr key={row.key}>
                            <td>{row.label}</td>
                            {metricComparison.columns.map((column, index) =>
                              index === 0 ? (
                                <td key={column.strategy} className="udm-table__num">
                                  {row.texts[index]}
                                </td>
                              ) : (
                                <td key={column.strategy} className="udm-table__num">
                                  <span>{row.texts[index]}</span>
                                  {row.deltas[index] ? (
                                    <span
                                      className={`udm-dispatch__delta udm-dispatch__delta--${row.verdicts[index]}`}
                                      title={
                                        row.verdicts[index] === 'better'
                                          ? '优于基准策略'
                                          : row.verdicts[index] === 'worse'
                                            ? '劣于基准策略'
                                            : '与基准策略相同'
                                      }
                                    >
                                      {row.deltas[index]}
                                    </span>
                                  ) : null}
                                </td>
                              )
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {/*
                    「加权综合分」的口径容易被读成「所有计划的时间相加」，而它必须包含
                    「没派出去的单」—— 否则拒得多的一方分数更低，两个指派数不同的策略
                    就不在同一杆秤上（见 `shared/src/dispatch-evaluate.ts` 的 `compositeScoreOf`）。
                    这句话把公式写在表下，读者不用去翻文档。
                  */}
                  <p className="udm-dispatch__hint">
                    {COST_METRIC_LABEL} = Σ 已派发计划的加权代价 + 未派发单数 × {DISPATCH_UNSERVED_PENALTY_S}
                    （未派发惩罚）；被拒任务不再记 0 分。
                  </p>
                </div>
              ) : null}

              {/*
                「同一单派给了不同车」：两个策略的分歧最终要落到具体任务上才可核对。
                「未派发」那一格就是匈牙利为整体最优放弃的那几单。
              */}
              {assignmentDiffs && assignmentDiffs.rows.length > 0 ? (
                <div className="udm-dispatch__compare">
                  <h4 className="udm-dispatch__sub-title">
                    派单差异（同一单派给了不同车 · {assignmentDiffs.rows.length} 单）
                  </h4>
                  <div className="udm-table__wrap">
                    <table className="udm-table">
                      <thead>
                        <tr>
                          <th>任务</th>
                          {assignmentDiffs.columns.map((column) => (
                            <th key={column.strategy}>{column.label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {assignmentDiffs.rows.map((row) => (
                          <tr key={row.taskId}>
                            <td>{row.taskCode}</td>
                            {row.vehicles.map((cell) => (
                              <td key={cell.strategy}>
                                {cell.vehicleCode ?? <span className="udm-dispatch__none">未派发</span>}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}

              <p className="udm-dispatch__hint">
                「执行里程」只算任务起点 → 终点的载货段（空驶段没有路线摘要，故不计入）；
                「行驶耗时」= 空驶 + 执行，即车真正在动的时间。「用车」里标出的接力，
                指同一台车在这批里连跑两单。
                「差异对照」以推荐策略为基准：正值表示另一策略更大，颜色表示这项是更优还是更差；
                两个策略派单数不同时，合计值天然偏向派得少的一方，故同时给出「单车平均」口径。
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
                    {/*
                      「派发后立即开跑」放在**应用按钮旁边**而不是策略区：它是这次应用的一个参数，
                      不是算法或系统设置。默认勾选状态随权限（见 `autoStart` 的定义）。
                    */}
                    {canStart ? (
                      <label
                        className="udm-dispatch__autostart"
                        title="应用派发后逐单调用 POST /api/execution/tasks/{id}/start，让车真的跑起来（Req-M4-9）"
                      >
                        <input
                          type="checkbox"
                          checked={autoStart}
                          onChange={(event) => setAutoStart(event.target.checked)}
                          disabled={disabled}
                        />
                        派发后立即开跑
                      </label>
                    ) : null}
                  </div>
                </div>

                {canApply && !canStart ? (
                  <p className="udm-dispatch__hint">
                    当前角色没有 <code>execution:start</code> 权限：应用派发后请到
                    <Link to="/tasks">任务管理</Link>逐单「开始执行」。
                  </p>
                ) : null}

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
                          <th className="udm-table__num" title={`${COST_METRIC_LABEL}：越低越好`}>
                            {COST_METRIC_LABEL}
                          </th>
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
                                {step.distanceM} m · 空驶 {step.deadheadS} + 执行 {step.executeS} · {COST_METRIC_LABEL}{' '}
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

      {/*
        日志跨两栏且默认收起：它是**复盘**材料（每次动作一条），不是决策时的输入 ——
        查「刚才那次为什么被拒」时才展开，平时不该占掉半屏高度。
      */}
      <details className="udm-dispatch__advanced udm-dispatch__logs" style={{ gridColumn: '1 / -1' }}>
        <summary className="udm-dispatch__advanced-summary">调度日志（每次预览 / 应用 / 重算各一条，可复核）</summary>
        <div className="udm-dispatch__block">
          <DispatchLogPanel token={token} revision={logsRevision} />
        </div>
      </details>

      {orderDialog ? (
        <NewOrderDialog
          token={token}
          siteOptions={siteOptions}
          templateOptions={templateOptions}
          onCreated={onOrderCreated}
          onClose={() => setOrderDialog(false)}
        />
      ) : null}

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

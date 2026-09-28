/**
 * 路径规划面板（M5，`docs/api.md` §3.5）。
 *
 * ## 三件事刻意不做
 *
 * 1. **不自己算路线**：结果一律来自 `POST /api/routes/plan` —— 主进程与浏览器 Mock
 *    跑的是同一份内核（`shared/src/route-search.ts`）。前端若在这里再实现一遍最短路，
 *    就会出现「界面上显示的路与调度实际走的路不同」这种最糟糕的分叉（D-21 的同类）。
 * 2. **不隐藏失败**：`GRAPH.BLOCKED` / `ROUTE.NOT_FOUND_PATH` 这些错误码带的是
 *    **可行动的信息**（哪个节点被封、卡在哪一段），因此错误区会把 `detail.message`
 *    原样显示出来，而不是只弹一句「规划失败」。
 * 3. **不做「算法选择」以外的自动重算**：规划是显式动作（点按钮）。输入框一变就发请求
 *    会让使用者还没选完终点就看到一条无关的路线，也会在主进程里留下大量无意义调用。
 *
 * 车种与算法的选项来自 `shared` 的枚举（`VEHICLE_TYPES` / `ROUTE_ALGORITHMS`），
 * 文案来自 `domain/labels.ts` —— 新增一个车种时这里不需要改（D-34）。
 */
import { useCallback, useMemo, useState } from 'react';
import {
  MAX_PAGE_SIZE,
  hasPermission,
  type NodeListItem,
  type RouteCompareResponse,
  type RoutePlan,
  type RoutePlanResponse
} from '@udm/shared';
import { apiClient } from '../api';
import { usePagedList } from '../api/usePagedList';
import { IconInfo, IconTarget } from '../components/icons';
import { useSessionStore } from '../store/session';
import {
  ALGORITHM_OPTIONS,
  EMPTY_ROUTE_QUERY,
  VEHICLE_OPTIONS,
  buildPlanPayload,
  compareRowsOf,
  compareVerdict,
  nodeChainOf,
  nodeOptionsOf,
  routeFactsOf,
  type RouteQuery
} from './model';

interface PlanState {
  route: RoutePlan | null;
  error: string | null;
}

interface CompareState {
  response: RouteCompareResponse | null;
  error: string | null;
}

export function RoutePlanner() {
  const token = useSessionStore((state) => state.token);
  const role = useSessionStore((state) => state.user?.role);
  const canPlan = role !== undefined && hasPermission(role, 'route:plan');

  const [query, setQuery] = useState<RouteQuery>(EMPTY_ROUTE_QUERY);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [plan, setPlan] = useState<PlanState>({ route: null, error: null });
  const [compare, setCompare] = useState<CompareState>({ response: null, error: null });
  const [busy, setBusy] = useState<'plan' | 'compare' | null>(null);

  // 节点下拉的数据源：一次取满分页（`MAX_PAGE_SIZE`），而不是做搜索式下拉 ——
  // 园区路网规模是「几十个节点」，全量列出比让使用者先搜再选快得多。
  const nodesQuery = useMemo(() => ({ page: 1, pageSize: MAX_PAGE_SIZE }), []);
  const nodes = usePagedList<NodeListItem>('/api/nodes', nodesQuery, token);
  const options = useMemo(() => nodeOptionsOf(nodes.records), [nodes.records]);

  const update = useCallback((patch: Partial<RouteQuery>) => {
    setQuery((current) => ({ ...current, ...patch }));
  }, []);

  const runPlan = useCallback(async () => {
    const built = buildPlanPayload(query, nodes.records);
    setFields(built.fields);
    if (!built.payload) {
      // 本地就通不过的参数：**清掉上一次的结果**。
      // 留着上一条路线的摘要会被读成「这次的输入算出了这条路」（实测走查时确实会误读）——
      // 界面上宁可只剩红框与空态，也不要一句可能被当成答案的旧数据
      setPlan({ route: null, error: null });
      setCompare({ response: null, error: null });
      return;
    }
    setBusy('plan');
    setCompare({ response: null, error: null });
    try {
      const result = await apiClient.invoke<RoutePlanResponse>('/api/routes/plan', built.payload, token, {
        method: 'POST'
      });
      if (result.code === 0) {
        setPlan({ route: result.data.route, error: null });
      } else {
        // 域错误的 `message` 由错误码目录唯一作者产出；`detail.message` 更具体
        // （哪个节点被封 / 卡在哪一段），两者都显示：前者说「这类失败是什么」，
        // 后者说「这次为什么失败」
        const detail = result.detail as { message?: unknown; unreachableVia?: unknown } | undefined;
        const specifics =
          typeof detail?.message === 'string'
            ? detail.message
            : Array.isArray(detail?.unreachableVia)
              ? `不可达的途经点：${detail.unreachableVia.join('、')}`
              : null;
        setPlan({ route: null, error: specifics ? `${result.message}：${specifics}` : result.message });
      }
    } finally {
      setBusy(null);
    }
  }, [nodes.records, query, token]);

  const runCompare = useCallback(async () => {
    const built = buildPlanPayload(query, nodes.records);
    setFields(built.fields);
    if (!built.payload) {
      setPlan({ route: null, error: null });
      setCompare({ response: null, error: null });
      return;
    }
    setBusy('compare');
    setPlan({ route: null, error: null });
    try {
      const result = await apiClient.invoke<RouteCompareResponse>('/api/routes/compare', built.payload, token, {
        method: 'POST'
      });
      if (result.code === 0) {
        setCompare({ response: result.data, error: null });
      } else {
        setCompare({ response: null, error: result.message });
      }
    } finally {
      setBusy(null);
    }
  }, [nodes.records, query, token]);

  const verdict = compare.response ? compareVerdict(compare.response) : null;

  return (
    <div className="udm-route">
      <form
        className="udm-route__form"
        onSubmit={(event) => {
          // 表单默认提交会刷新整个页面（Electron 里表现为白屏重载），必须拦住
          event.preventDefault();
          void runPlan();
        }}
      >
        <div className="udm-form__field">
          <label htmlFor="route-from">起点节点</label>
          <select
            id="route-from"
            value={query.fromNodeId}
            onChange={(event) => update({ fromNodeId: event.target.value })}
            className={fields['fromNodeId'] ? 'is-invalid' : undefined}
          >
            <option value="">请选择…</option>
            {options.map((option) => (
              <option key={option.value} value={option.value} disabled={option.disabled}>
                {option.label}
                {option.disabled ? '（已停用）' : ''}
              </option>
            ))}
          </select>
          {fields['fromNodeId'] ? <span className="udm-form__error">{fields['fromNodeId']}</span> : null}
        </div>

        <div className="udm-form__field">
          <label htmlFor="route-to">终点节点</label>
          <select
            id="route-to"
            value={query.toNodeId}
            onChange={(event) => update({ toNodeId: event.target.value })}
            className={fields['toNodeId'] ? 'is-invalid' : undefined}
          >
            <option value="">请选择…</option>
            {options.map((option) => (
              <option key={option.value} value={option.value} disabled={option.disabled}>
                {option.label}
                {option.disabled ? '（已停用）' : ''}
              </option>
            ))}
          </select>
          {fields['toNodeId'] ? <span className="udm-form__error">{fields['toNodeId']}</span> : null}
        </div>

        <div className="udm-form__field">
          <label htmlFor="route-via">途经点（可选）</label>
          <input
            id="route-via"
            value={query.viaText}
            placeholder="按顺序填写节点编码，用逗号分隔，如 N02, N05"
            onChange={(event) => update({ viaText: event.target.value })}
            className={fields['viaText'] ? 'is-invalid' : undefined}
          />
          <span className="udm-form__help">最多 10 个；顺序即经过顺序</span>
          {fields['viaText'] ? <span className="udm-form__error">{fields['viaText']}</span> : null}
        </div>

        <div className="udm-route__row">
          <div className="udm-form__field">
            <label htmlFor="route-vehicle">车种</label>
            <select id="route-vehicle" value={query.vehicleType} onChange={(event) => update({ vehicleType: event.target.value as RouteQuery['vehicleType'] })}>
              {VEHICLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="udm-form__help">决定没有单独限速的路段按多快计算</span>
          </div>
          <div className="udm-form__field">
            <label htmlFor="route-algorithm">算法</label>
            <select id="route-algorithm" value={query.algorithm} onChange={(event) => update({ algorithm: event.target.value as RouteQuery['algorithm'] })}>
              {ALGORITHM_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="udm-form__help">对比时两个都会算</span>
          </div>
        </div>

        <div className="udm-route__actions">
          <button type="submit" className="udm-btn udm-btn--primary" disabled={!canPlan || busy !== null}>
            {busy === 'plan' ? '规划中…' : '规划路线'}
          </button>
          <button
            type="button"
            className="udm-btn"
            disabled={!canPlan || busy !== null}
            onClick={() => void runCompare()}
          >
            {busy === 'compare' ? '对比中…' : '对比 A* / Dijkstra'}
          </button>
        </div>
        {!canPlan ? (
          <p className="udm-route__hint">
            当前角色没有 `route:plan` 权限，只能查看。主进程同样会拒绝（D-08），此处只是不显示入口
          </p>
        ) : null}
      </form>

      <div className="udm-route__result">
        {/* 失败一律用 `.udm-alert`：它本身就是红色告警条（失败语义），不需要再加修饰类 */}
        {plan.error ? (
          <div className="udm-alert" role="alert">
            {plan.error}
          </div>
        ) : null}
        {compare.error ? (
          <div className="udm-alert" role="alert">
            {compare.error}
          </div>
        ) : null}

        {plan.route ? (
          <div className="udm-route__summary">
            <dl className="udm-kv">
              {routeFactsOf(plan.route).map((fact) => (
                <div key={fact.label}>
                  <dt>{fact.label}</dt>
                  <dd>{fact.value}</dd>
                </div>
              ))}
            </dl>
            <p className="udm-route__chain" aria-label="经过的节点">
              {nodeChainOf(plan.route, nodes.records).map((code, index) => (
                <span key={`${code}-${index}`}>
                  {index > 0 ? <span className="udm-route__arrow"> → </span> : null}
                  <span className="udm-route__node">{code}</span>
                </span>
              ))}
            </p>
            {plan.route.warnings.length > 0 ? (
              <ul className="udm-route__warnings">
                {plan.route.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : (
              <p className="udm-route__note">
                <IconInfo /> 没有需要提醒的地方（无慢速段、无绕行）
              </p>
            )}
          </div>
        ) : null}

        {compare.response ? (
          <div className="udm-route__compare">
            {verdict ? (
              <div
                className={`udm-route__verdict ${verdict.tone === 'ok' ? 'udm-route__verdict--ok' : 'udm-route__verdict--danger'}`}
                role="status"
              >
                {verdict.text}
              </div>
            ) : null}
            <table className="udm-table">
              <thead>
                <tr>
                  <th>算法</th>
                  <th className="udm-table__num">里程</th>
                  <th className="udm-table__num">耗时</th>
                  <th className="udm-table__num">经停节点</th>
                  <th className="udm-table__num">计算耗时</th>
                </tr>
              </thead>
              <tbody>
                {compareRowsOf(compare.response).map((row) => (
                  <tr key={row.algorithm}>
                    <td>{row.label}</td>
                    <td className="udm-table__num">{row.distanceM}</td>
                    <td className="udm-table__num">{row.durationS}</td>
                    <td className="udm-table__num">{row.nodeCount}</td>
                    <td className="udm-table__num">{row.elapsedMs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {!plan.route && !compare.response && !plan.error && !compare.error ? (
          <div className="udm-empty">
            <div className="udm-empty__icon"><IconTarget /></div>
            <p className="udm-empty__title">还没有规划结果</p>
            <p className="udm-empty__hint">选好起终点后点「规划路线」；想比较两种算法就点「对比」</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

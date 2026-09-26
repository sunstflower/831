/**
 * 监控工作台（`design.md` §7.1 的「概览指标、异常任务、事件流」落点）。
 *
 * **数据来源的诚实说明**：本页读的是 `GET /api/map/overview`（Req-M6-5 的「画布唯一数据入口」），
 * 而不是 `/api/monitor/*` —— 后者属 M7，尚未实现（ISS-010）。因此：
 *   - 页面上标注了数据来源与刷新方式，不让「看起来有数」被误当成「M7 已完成」；
 *   - 全部指标都由已有快照派生，**不新增接口、不新增契约**（新增接口属 M7 的活）；
 *   - 一旦 `/api/monitor/overview` 落地，只需替换数据源 hook，本页的 `model/` 与面板不用改。
 *
 * 布局（栅格见 `dashboard/style/dashboard.css`）：
 *   1. 四个 KPI 卡 —— 决定「现在要不要人介入」；
 *   2. 车队分布 / 任务进度 / 待处理告警 —— 三栏并排，是这一屏的主要工作区；
 *   3. 地图预览 + 数据源卡片 —— 把「在哪、什么数据」交代清楚。
 */
import { Link } from 'react-router-dom';
import { adapterKind } from '../api';
import { useMapOverview } from '../map/hooks/useMapOverview';
import { computeMetrics } from '../map/model/metrics';
import { useSessionStore } from '../store/session';
import { AlertFeed } from '../dashboard/panels/AlertFeed';
import { FleetBreakdown } from '../dashboard/panels/FleetBreakdown';
import { KpiCards } from '../dashboard/panels/KpiCards';
import { MapPreview } from '../dashboard/panels/MapPreview';
import { SourceCard } from '../dashboard/panels/SourceCard';
import { TaskProgress } from '../dashboard/panels/TaskProgress';
import { buildAlertRows, buildFleetBuckets, buildKpis, buildTaskRows } from '../dashboard/model/summary';
import { IconActivity, IconAlert, IconArrowRight, IconMap, IconRefresh, IconTasks, IconVehicle } from '../components/icons';
import '../dashboard/style/dashboard.css';

/** 卡片标题右侧的「去完整页面」入口：概览只给结论，细节在专门页面里。 */
function MoreLink({ to, label }: { to: string; label: string }) {
  return (
    <Link className="udm-card__more" to={to}>
      {label}
      <IconArrowRight size={12} />
    </Link>
  );
}

export function DashboardPage() {
  const user = useSessionStore((state) => state.user);
  const token = useSessionStore((state) => state.token);
  const { overview, loading, error, lastEventSeq, refresh } = useMapOverview(token);

  if (error) {
    return (
      <div className="udm-page">
        <div className="udm-alert" role="alert">
          <IconAlert />
          <span>打开工作台失败：{error}</span>
        </div>
        <p className="udm-page__lead">
          请确认已登录且主进程可用；浏览器形态下适配器应为 <code>mock</code>（当前：<code>{adapterKind}</code>）。
        </p>
        <div className="udm-page__actions">
          <button type="button" className="udm-btn" onClick={refresh}>
            <IconRefresh />
            重试
          </button>
        </div>
      </div>
    );
  }

  if (!overview) {
    return (
      <div className="udm-page">
        <div className="udm-empty" role="status">
          <span className="udm-spinner" aria-hidden="true" />
          <p className="udm-empty__title">{loading ? '正在加载概览数据…' : '暂无数据'}</p>
        </div>
      </div>
    );
  }

  const metrics = computeMetrics(overview);
  const kpis = buildKpis(overview, metrics);
  const fleet = buildFleetBuckets(overview);
  const tasks = buildTaskRows(overview);
  const alerts = buildAlertRows(overview);

  return (
    <div className="udm-page udm-dashboard">
      <div className="udm-page__intro">
        <p className="udm-page__lead">
          {user ? `${user.displayName}，` : ''}当前展示车队与任务的实时概览。
          {metrics.newAlerts > 0
            ? `有 ${metrics.newAlerts} 条告警待确认，建议先处理。`
            : '暂无待确认告警。'}
        </p>
        <div className="udm-page__actions">
          <button type="button" className="udm-btn udm-btn--ghost" onClick={refresh} title="立即重新拉取快照">
            <IconRefresh />
            刷新
          </button>
          <Link className="udm-btn udm-btn--primary" to="/map">
            <IconMap />
            打开地图
          </Link>
        </div>
      </div>

      <KpiCards kpis={kpis} />

      <div className="udm-dashboard__columns">
        <section className="udm-card" aria-label="车队状态分布">
          <header className="udm-card__head">
            <IconVehicle className="udm-card__icon" />
            <h2 className="udm-card__title">车队状态</h2>
            <span className="udm-card__aside">{metrics.vehicles} 台</span>
          </header>
          <div className="udm-card__body">
            {metrics.vehicles === 0 ? (
              <div className="udm-empty">
                <p className="udm-empty__title">暂无车辆</p>
                <p className="udm-empty__hint">车辆在「基础数据」维护（M2）；当前演示数据来自 seed。</p>
              </div>
            ) : (
              <FleetBreakdown buckets={fleet} total={metrics.vehicles} />
            )}
          </div>
        </section>

        <section className="udm-card" aria-label="任务执行进度">
          <header className="udm-card__head">
            <IconTasks className="udm-card__icon" />
            <h2 className="udm-card__title">任务执行</h2>
            <span className="udm-card__aside">
              <Link className="udm-card__more" to="/tasks">
                任务管理
                <IconArrowRight size={12} />
              </Link>
            </span>
          </header>
          <div className="udm-card__body">
            <TaskProgress rows={tasks.rows} hidden={tasks.hidden} />
          </div>
        </section>

        <section className="udm-card" aria-label="待处理告警">
          <header className="udm-card__head">
            <IconAlert className="udm-card__icon" />
            <h2 className="udm-card__title">告警</h2>
            <span className="udm-card__aside">
              {metrics.newAlerts > 0 ? (
                <span className="udm-badge udm-badge--danger">{metrics.newAlerts} 待确认</span>
              ) : (
                <span className="udm-badge udm-badge--ok">无待确认</span>
              )}
            </span>
          </header>
          <div className="udm-card__body">
            <AlertFeed rows={alerts.rows} hidden={alerts.hidden} openCount={alerts.openCount} />
          </div>
        </section>
      </div>

      <div className="udm-dashboard__wide">
        <section className="udm-card" aria-label="地图预览">
          <header className="udm-card__head">
            <IconMap className="udm-card__icon" />
            <h2 className="udm-card__title">实时地图预览</h2>
            <span className="udm-card__aside">
              <MoreLink to="/map" label="完整地图" />
            </span>
          </header>
          <div className="udm-card__body udm-card__body--flush">
            {metrics.nodes === 0 && metrics.sites === 0 ? (
              <div className="udm-empty">
                <p className="udm-empty__title">路网为空</p>
                <p className="udm-empty__hint">请先在「基础数据」导入或创建路网节点与站点（M2）。</p>
              </div>
            ) : (
              <MapPreview overview={overview} />
            )}
          </div>
        </section>

        <section className="udm-card" aria-label="数据源与运行环境">
          <header className="udm-card__head">
            <IconActivity className="udm-card__icon" />
            <h2 className="udm-card__title">数据源</h2>
          </header>
          <div className="udm-card__body">
            <SourceCard metrics={metrics} lastEventSeq={lastEventSeq} />
            <p className="udm-sources__note">
              概览读的是地图快照接口；M7 运行监控的专属接口（<code>/api/monitor/*</code>）尚未实现，
              因此本页指标与地图页同源。
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

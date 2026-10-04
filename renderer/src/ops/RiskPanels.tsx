/**
 * 告警中心的两个「看未来」区块（`docs/api.md` §3.8.3）。
 *
 * 告警列表回答「**已经**出了什么事」；这两个区块回答「按现在这份派发，
 * **接下来**会撞上什么」：
 *
 *   1. **任务风险预检** —— 车撞单、车不可用、电量不足、缺路线、预计超时、
 *      窗口已过、以及还没排上车的任务。判断全部由主进程 / Mock 的后端给出
 *      （`GET /api/alerts/risks`），这里只负责渲染；
 *      **分两节**（`planRiskSectionsOf`，口径的唯一作者在 `shared`）：依赖已生效派发的
 *      「派发冲突与执行风险」在前、与派发无关的「待派与超时缺口」在后 ——
 *      见 `ISS-096`：平铺在一张表里时，「一条都没派却在报冲突」是必然的误读；
 *   2. **任务分配派发** —— 按车辆分组列出已生效的派发（任务 → 车辆 → 时间区间），
 *      同一台车的第 2 单即为**接力**。
 *
 * ## 为什么这两块**不是**告警
 *
 * 它们没有 `id`、没有状态机、不能认领 —— 一条「预计会超时」被认领掉毫无意义：
 * 它要么被处理掉（改派 / 调窗口），要么等它真的超时、由执行器落一条真告警。
 * 因此按钮只有「去做那件事」（去调度中心、去地图看车），没有「标记为已处理」。
 *
 * ## 为什么不做成可折叠
 *
 * 首屏最重要的信息是「有没有必须处理的事」。默认折叠会让这一页退化成
 * 那个只管历史的列表 —— 而这一页的价值恰恰在于把两件事放在一起。
 * 只有在没有风险时，区块才收敛成一行结论（`riskSummaryOf`）。
 */
import { Link } from 'react-router-dom';
import { planRiskSectionsOf, type PlanRiskReport } from '@udm/shared';
import { IconAlert, IconInfo } from '../components/icons';
import { badgeToneClass, TASK_STATUS_TONE } from '../domain/tone';
import { TASK_STATUS_LABEL } from '../domain/labels';
import { useSelectionStore } from '../store/selection';
import { vehicleNodeId } from '../map/model/ids';
import { assignmentGroupsOf, riskSummaryOf, shortTime } from './model';
import { RiskTable } from './RiskTable';

interface RiskPanelsProps {
  report: PlanRiskReport | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

export function RiskPanels({ report, loading, error, onRefresh }: RiskPanelsProps) {
  const select = useSelectionStore((state) => state.select);
  const groups = report ? assignmentGroupsOf(report.assignments) : [];
  /*
   * 分节只做分组，排序与分类都来自 `shared`（`planRiskSectionsOf`）——
   * 界面不重新排一次，也不自己判断「哪一类算冲突」。
   */
  const sections = report ? planRiskSectionsOf(report.records) : [];

  return (
    <>
      <section className="udm-card udm-risk" aria-label="任务风险预检">
        <header className="udm-card__head">
          <h3 className="udm-card__title">任务风险预检</h3>
          <span className="udm-card__aside">
            {error ? '读取失败' : loading && !report ? '扫描中…' : report ? riskSummaryOf(report.counts) : '—'}
          </span>
        </header>
        <div className="udm-card__body">
          <p className="udm-risk__lead">
            按<strong>当前</strong>的车辆—任务—路线分配推算接下来会撞上什么。下面分两节：
            先看<strong>派发冲突与执行风险</strong>（抢同一台车、车跑不了、电量撑不到、缺路线、预计迟到）——
            这一节只由已生效的派发算出来，<strong>还没派发就必然是空的</strong>；
            再看<strong>待派与超时缺口</strong>（窗口已过、还没排上车）——它与有没有派发无关，
            所以<strong>没派发也会出现</strong>。
            它们不是告警（没有发生），因此不能「认领」—— 要么处理掉，要么等它真的发生。
          </p>

          {error ? (
            <div className="udm-alert" role="alert">
              <IconAlert />
              <span>风险预检读取失败：{error}</span>
              <button type="button" className="udm-btn udm-btn--ghost" onClick={onRefresh}>
                重试
              </button>
            </div>
          ) : !report ? (
            <div className="udm-empty" role="status">
              <span className="udm-spinner" aria-hidden="true" />
              <p className="udm-empty__title">正在扫描当前的派发…</p>
            </div>
          ) : sections.length === 0 ? (
            <div className="udm-empty">
              <p className="udm-empty__title">没有发现任务冲突或超时</p>
              <p className="udm-empty__hint">
                扫描时刻 {shortTime(report.scannedAt)}；当前没有未派发任务，也没有时间窗过期的任务。
              </p>
            </div>
          ) : (
            sections.map((view) => (
              <div key={view.section} className="udm-risk__section">
                <div className="udm-risk__section-head">
                  <h4 className="udm-risk__section-title">{view.title}</h4>
                  <span className="udm-risk__section-count">{riskSummaryOf(view.counts)}</span>
                </div>
                <p className="udm-risk__section-hint">{view.hint}</p>
                <RiskTable records={view.records} />
                {/*
                  「还有 N 条没排上车」这条结论只跟「待派」这一节有关：
                  它数的是 pending 且没有任何计划的任务，放在第一节下面会读成冲突的一部分。
                */}
                {view.section === 'backlog' && report.unassignedTasks.length > 0 ? (
                  <p className="udm-risk__foot">
                    <IconInfo aria-hidden="true" />
                    其中 <strong>{report.unassignedTasks.length}</strong> 条完全没有安排车辆
                    （{report.unassignedTasks.slice(0, 6).map((row) => row.taskCode).join('、')}
                    {report.unassignedTasks.length > 6 ? ' 等' : ''}）——
                    <Link to="/dispatch">去调度中心派发</Link>。
                  </p>
                ) : null}
              </div>
            ))
          )}
        </div>
      </section>

      <section className="udm-card udm-risk" aria-label="任务分配派发">
        <header className="udm-card__head">
          <h3 className="udm-card__title">任务分配派发</h3>
          <span className="udm-card__aside">
            {loading && !report ? '读取中…' : `${groups.length} 台车 · ${report?.assignments.length ?? 0} 单已生效`}
          </span>
        </header>
        <div className="udm-card__body">
          <p className="udm-risk__lead">
            当前已生效的派发，按车辆分组 —— 同一台车有第 2 单即为<strong>接力</strong>。
            点车辆可跳转到地图上看它的实时位置与路线。
          </p>
          {groups.length === 0 ? (
            <div className="udm-empty">
              <p className="udm-empty__title">还没有生效中的派发</p>
              <p className="udm-empty__hint">
                在<Link to="/dispatch">调度中心</Link>预览并应用一次派发后，这里会按车辆列出任务分配。
              </p>
            </div>
          ) : (
            <ul className="udm-risk__fleet">
              {groups.map((group) => (
                <li key={group.vehicleId} className="udm-risk__fleet-group">
                  <p className="udm-risk__fleet-head">
                    <button
                      type="button"
                      className="udm-linklike udm-risk__vehicle"
                      title={`在地图上查看 ${group.vehicleCode}`}
                      onClick={() =>
                        select({
                          entityType: 'vehicle',
                          entityId: group.vehicleId,
                          flowId: vehicleNodeId(group.vehicleId),
                          label: group.vehicleCode
                        })
                      }
                    >
                      {group.vehicleCode}
                    </button>
                    <span className={`udm-badge ${group.relay ? 'udm-badge--info' : 'udm-badge--ok'}`}>
                      {group.relay ? `接力 ${group.steps.length} 单` : '单趟'}
                    </span>
                    <Link className="udm-risk__fleet-map" to="/map">
                      在地图上看
                    </Link>
                  </p>
                  <ol className="udm-risk__fleet-steps">
                    {group.steps.map((step, index) => (
                      <li key={step.taskId}>
                        <span className="udm-risk__step-seq">第 {index + 1} 单</span>
                        <span className="udm-risk__step-task">{step.taskCode}</span>
                        <span className="udm-risk__step-time">
                          {shortTime(step.beginsAt)} → {shortTime(step.doneAt)}
                        </span>
                        <span className="udm-risk__step-meta">
                          <span className={`udm-badge ${badgeToneClass(TASK_STATUS_TONE[step.taskStatus])}`}>
                            {TASK_STATUS_LABEL[step.taskStatus]}
                          </span>
                          {step.hasRoute ? null : <span className="udm-risk__step-noroute">缺路线</span>}
                        </span>
                      </li>
                    ))}
                  </ol>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </>
  );
}

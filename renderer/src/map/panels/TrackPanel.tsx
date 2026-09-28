/**
 * 轨迹回放面板（Req-M6-3 的轨迹一半，数据来自 `GET /api/map/tracks/{vehicleId}`）。
 *
 * ## 这一屏回答三个问题
 *
 *   1. **这台车最近走过哪里** —— 采样点数 / 时间跨度 / 折线里程 / 速度极值；
 *   2. **某个时刻它在哪、状态如何** —— 拖动回放滑块定位到具体采样点，
 *      面板给出那一刻的坐标、速度、状态与所属任务；
 *   3. **地图上要不要画出来** —— 折线开关（画布上的折线是纯装饰，不参与命中）。
 *
 * ## 为什么回放**不动**地图上的车辆
 *
 * 地图上的车辆位置是实时位置（由事件驱动补帧）。让回放滑块去移动它，
 * 使用者就分不清「这是历史还是现在」—— 一次误判会直接导致错误的现场判断。
 * 因此回放只画一条折线 + 一个游标，车辆节点始终是**此刻**的位置。
 *
 * ## 为什么没有采样点时要说清原因
 *
 * 「暂无轨迹」有两种完全不同的含义：还没执行过，或者执行器刚启动还没采到点。
 * 只写一句「暂无数据」会让人去查接口是否坏了 —— 这里如实说明采样的产生条件。
 */
import type { VehicleTrackPoint } from '@udm/shared';
import { IconActivity, IconRefresh } from '../../components/icons';
import { formatDateTime } from '../../domain/format';
import type { VehicleTracksState } from '../hooks/useVehicleTracks';
import { formatDuration, formatSpeedKph, scrubIndex, trackSummary } from '../model/track';

export interface TrackPanelProps {
  /** 选中的车辆编码（非车辆选中或未选中时为 `null`）。 */
  vehicleLabel: string | null;
  state: VehicleTracksState;
  /** 画布上是否画折线。 */
  show: boolean;
  onShowChange: (next: boolean) => void;
  /** 回放进度 0–1（1 = 最新）。 */
  fraction: number;
  onFractionChange: (next: number) => void;
}

/** 回放游标那一刻的字段。 */
function cursorOf(points: VehicleTrackPoint[], fraction: number): VehicleTrackPoint | undefined {
  const index = scrubIndex(points.length, fraction);
  return index >= 0 ? points[index] : undefined;
}

export function TrackPanel({ vehicleLabel, state, show, onShowChange, fraction, onFractionChange }: TrackPanelProps) {
  const points = state.track?.points ?? [];
  const summary = trackSummary(points);
  const cursor = points.length > 0 ? cursorOf(points, fraction) : undefined;

  return (
    <aside className="udm-panel udm-track" aria-label="轨迹回放">
      <header className="udm-panel__head">
        <IconActivity className="udm-panel__icon" />
        <h2>轨迹回放</h2>
        {summary.count > 0 ? <span className="udm-track__count">{summary.count} 个采样点</span> : null}
      </header>

      {!vehicleLabel ? (
        <p className="udm-track__empty">
          选中一台车辆即可回看它的历史轨迹。轨迹由执行器在任务执行期间周期性采样，与实时位置分开显示。
        </p>
      ) : state.error ? (
        <p className="udm-track__error" role="alert">
          读取轨迹失败：{state.error}
        </p>
      ) : state.loading && !state.track ? (
        <p className="udm-track__empty" role="status">
          正在加载 {vehicleLabel} 的轨迹…
        </p>
      ) : summary.count === 0 ? (
        <p className="udm-track__empty">
          {vehicleLabel} 还没有轨迹采样。执行器每周期采一次；车辆首次进入执行后才会有点，
          种子数据里的车辆在「开始执行」之前是空的。
        </p>
      ) : (
        <>
          <dl className="udm-kv">
            <div>
              <dt>时间跨度</dt>
              <dd>{formatDuration(summary.durationMs)}</dd>
            </div>
            <div>
              <dt>折线里程</dt>
              <dd>{Math.round(summary.distanceM)} m</dd>
            </div>
            <div>
              <dt>速度（均 / 峰）</dt>
              <dd>
                {formatSpeedKph(summary.avgSpeedMps)} / {formatSpeedKph(summary.maxSpeedMps)}
              </dd>
            </div>
          </dl>

          <label className="udm-track__toggle">
            <input type="checkbox" checked={show} onChange={(event) => onShowChange(event.target.checked)} />
            在地图上画出折线
          </label>

          {/*
            回放滑块：`max=100` 而不是 `max=count-1`，这样采样点增长时滑块位置不会跳动，
            「回看到哪」始终是同一个时间比例。
          */}
          <div className="udm-track__scrub">
            <label htmlFor="udm-track-range">回放位置</label>
            <input
              id="udm-track-range"
              type="range"
              min={0}
              max={100}
              value={Math.round(fraction * 100)}
              onChange={(event) => onFractionChange(Number(event.target.value) / 100)}
            />
            <div className="udm-track__scrub-actions">
              <button type="button" className="udm-btn udm-btn--ghost" onClick={() => onFractionChange(0)}>
                从头看
              </button>
              <button type="button" className="udm-btn udm-btn--ghost" onClick={() => onFractionChange(1)}>
                回到最新
              </button>
            </div>
          </div>

          {cursor ? (
            <dl className="udm-kv udm-kv--stacked udm-track__cursor">
              <div>
                <dt>该时刻</dt>
                <dd>{formatDateTime(cursor.ts)}</dd>
              </div>
              <div>
                <dt>位置 / 速度</dt>
                <dd>
                  ({Math.round(cursor.x)}, {Math.round(cursor.y)}) m · {formatSpeedKph(cursor.speedMps)}
                </dd>
              </div>
              <div>
                <dt>状态 / 任务</dt>
                <dd>
                  {cursor.status}
                  {cursor.taskId ? ` · ${cursor.taskId}` : ' · 无任务'}
                </dd>
              </div>
            </dl>
          ) : null}
        </>
      )}

      {vehicleLabel ? (
        <div className="udm-track__actions">
          <button type="button" className="udm-btn udm-btn--ghost" onClick={state.refresh} disabled={state.loading}>
            <IconRefresh />
            刷新轨迹
          </button>
        </div>
      ) : null}
    </aside>
  );
}

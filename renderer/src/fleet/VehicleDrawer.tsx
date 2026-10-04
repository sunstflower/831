/**
 * 单车详情抽屉（车辆中心右侧）。
 *
 * 三个区块回答三个不同的问题：
 *   1. **这台车现在什么状态** —— 型号 / 状态 / 载重 / 电量 / 心跳；
 *   2. **它在哪、在干什么** —— 实时位置 + 当前任务 + 「在地图上查看」（写全局选中态后跳地图）；
 *   3. **它最近走过哪里** —— 轨迹折线 + 采样点表（数据源与地图的轨迹回放面板同一条接口）。
 *
 * ## 为什么这里只画折线、不移动地图上的车
 *
 * 与 `map/panels/TrackPanel.tsx` 同一条判据：地图上的车辆位置是**实时位置**，
 * 让历史轨迹去驱动它会让人分不清「这是历史还是现在」。抽屉里画的是**采样点本身**，
 * 不插值（`map/model/track.ts` 的文件头解释了原因：采样点之间没有观测）。
 *
 * ## 没有采样点时要说清原因
 *
 * 「暂无轨迹」有两种含义：这台车还没执行过任务，或者刚开跑还没采到第一个点。
 * 只写「暂无数据」会让人去查接口是否坏了。
 */
import type { MonitorVehicleItem, VehicleTracks } from '@udm/shared';
import { IconActivity, IconClose, IconInfo, IconMap } from '../components/icons';
import { badgeToneClass } from '../domain/tone';
import { formatDateTime, formatNumber } from '../domain/format';
import { formatDuration, formatSpeedKph, trackSummary } from '../map/model/track';
import { batteryToneOf, trackPathOf, type FleetRow } from './model';

interface VehicleDrawerProps {
  vehicle: MonitorVehicleItem;
  row: FleetRow;
  /** 当前任务的标题（任务不在本页取数时可为 `null`，此时只显示编码）。 */
  taskTitle: string | null;
  track: VehicleTracks | null;
  trackLoading: boolean;
  trackError: string | null;
  onLocate: (vehicleId: string, label: string) => void;
  onClose: () => void;
}

export function VehicleDrawer({
  vehicle,
  row,
  taskTitle,
  track,
  trackLoading,
  trackError,
  onLocate,
  onClose
}: VehicleDrawerProps) {
  const points = track?.points ?? [];
  const summary = trackSummary(points);
  const path = trackPathOf(points);

  return (
    <aside className="udm-panel udm-flt__drawer" aria-label={`车辆 ${row.code} 详情`}>
      <header className="udm-panel__head">
        <IconActivity className="udm-panel__icon" />
        <h2>
          {row.code} · {row.name}
        </h2>
        <button type="button" className="udm-btn udm-btn--ghost" onClick={onClose} aria-label="关闭详情">
          <IconClose size={14} />
        </button>
      </header>

      <div className="udm-flt__section">
        <h3 className="udm-flt__section-title">基本状态</h3>
        <dl className="udm-flt__facts">
          <div>
            <dt>型号</dt>
            <dd>{row.typeLabel}</dd>
          </div>
          <div>
            <dt>状态</dt>
            <dd>
              <span className={badgeToneClass(row.statusTone)}>{row.statusLabel}</span>
            </dd>
          </div>
          <div>
            <dt>载重</dt>
            <dd>{row.loadText}</dd>
          </div>
          <div>
            <dt>电量</dt>
            <dd>
              <span className={badgeToneClass(batteryToneOf(row.battery))}>{row.battery.toFixed(0)}%</span>
            </dd>
          </div>
          <div>
            <dt>最大速度</dt>
            <dd>{formatSpeedKph(vehicle.maxSpeedMps)}</dd>
          </div>
          <div>
            <dt>心跳</dt>
            <dd>{row.heartbeatText || '无记录'}</dd>
          </div>
        </dl>
      </div>

      <div className="udm-flt__section">
        <h3 className="udm-flt__section-title">此刻在哪、在干什么</h3>
        <p className="udm-flt__line">
          <span className="udm-flt__k">位置</span>
          <span>
            x {formatNumber(vehicle.x)}, y {formatNumber(vehicle.y)}（米，平面坐标）
          </span>
        </p>
        <p className="udm-flt__line">
          <span className="udm-flt__k">当前任务</span>
          <span>
            {row.taskCode ?? '空闲'} {taskTitle ? `· ${taskTitle}` : ''}
          </span>
        </p>
        <div className="udm-flt__actions">
          <button
            type="button"
            className="udm-btn udm-btn--ghost"
            onClick={() => onLocate(vehicle.id, `${row.code} · ${row.name}`)}
          >
            <IconMap size={14} /> 在地图上查看
          </button>
        </div>
      </div>

      <div className="udm-flt__section">
        <h3 className="udm-flt__section-title">轨迹</h3>
        {trackError ? (
          <p className="udm-flt__line" role="alert">
            轨迹读取失败：{trackError}
          </p>
        ) : points.length === 0 ? (
          <p className="udm-list__note" role="note">
            <IconInfo />
            <span>
              {trackLoading
                ? '正在读取轨迹…'
                : '暂无采样点。执行器只在车辆开始执行后才记录轨迹 —— 派发并开跑后回到这里再看。'}
            </span>
          </p>
        ) : (
          <>
            <p className="udm-flt__line">
              <span className="udm-flt__k">采样</span>
              <span>
                {summary.count} 点 · 跨度 {formatDuration(summary.durationMs)} · 折线 {summary.distanceM.toFixed(1)} m · 最高{' '}
                {formatSpeedKph(summary.maxSpeedMps)}
              </span>
            </p>
            <svg
              className="udm-flt__track"
              viewBox="0 0 240 120"
              role="img"
              aria-label={`${row.code} 最近 ${summary.count} 个采样点的轨迹`}
            >
              <path d={path} fill="none" strokeWidth="2" />
            </svg>
            <p className="udm-flt__hint">
              具体到每一段是视觉近似；下表是执行器实际记下的采样点（不插值）。
              完整回放（时间轴 + 游标）在地图页的轨迹面板。
            </p>
            <div className="udm-flt__points">
              <table className="udm-table">
                <thead>
                  <tr>
                    <th>时刻</th>
                    <th className="udm-table__num">x, y</th>
                    <th className="udm-table__num">速度</th>
                  </tr>
                </thead>
                <tbody>
                  {points
                    .slice(-8)
                    .reverse()
                    .map((point, index) => (
                      // 采样点的时间戳可能重复（执行器同一毫秒内连记两点），不能用 `ts` 做 key
                      <tr key={`${point.ts}-${index}`}>
                        <td>{formatDateTime(point.ts)}</td>
                        <td className="udm-table__num">
                          {formatNumber(point.x)}, {formatNumber(point.y)}
                        </td>
                        <td className="udm-table__num">{formatSpeedKph(point.speedMps)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

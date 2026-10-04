/**
 * 车辆中心（`design.md` §7.1 `/fleet`，Req-M2-8 / Req-M7-6）。
 *
 * ## 这一页解决什么
 *
 * 地图回答「车队在路网上的哪里」，基础数据页回答「车辆档案长什么样」，
 * 而调度员日常问的是第三个问题：**「现在哪台车能动、哪台车在忙什么、它跑得怎么样」**。
 * 这一页把三者收在一屏：状态分桶 → 车队表格 → 单车抽屉（位置 / 当前任务 / 轨迹）。
 *
 * ## 三个刻意的边界（对应 D-59）
 *
 * 1. **只读运行态**：本页不提供新增/编辑车辆 —— 那是 `base:write` 与基础数据页的职责，
 *    这里的入口是**跳转**而不是复制表单（D-34：同一个字段清单不能有两个作者）。
 * 2. **取数走 `monitor/vehicles`**：它比 `map/overview` 多出载重 / 型号 / 心跳等静态字段，
 *    而位置由 `vehicle.changed` 事件增量覆盖（`fleet/useFleetList.ts` 的文件头说明了分层）。
 * 3. **不分页**：以 `MAX_PAGE_SIZE` 一次取回，这样 KPI 与状态分桶是**全量**的，
 *    不会出现「表格说 3 台在忙、分桶说 1 台」这种同屏自相矛盾。车队超过一页（100 台）时
 *    页面会如实提示「统计只覆盖前 100 台」—— 演示与园区场景远低于这个量级。
 *
 * ## 与地图的关系
 *
 * 抽屉里的「在地图上查看」写的是**全局选中态**（`store/selection`）再跳 `/map`，
 * 与列表→地图的联动是同一套机制（`design.md` §7.2 第 2 条）。本页**不**再画一次地图：
 * 一张图已经在地图页，复制一份会得到两个各自演化的画布。
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MAX_PAGE_SIZE, hasPermission, type TaskListItem } from '@udm/shared';
import { KpiCards } from '../dashboard/panels/KpiCards';
import type { Kpi } from '../dashboard/model/summary';
import { IconDatabase, IconRefresh } from '../components/icons';
import { usePagedList } from '../api/usePagedList';
import { toneClass } from '../domain/tone';
import { useSessionStore } from '../store/session';
import { useSelectionStore } from '../store/selection';
import { vehicleNodeId } from '../map/model/ids';
import { useVehicleTracks } from '../map/hooks/useVehicleTracks';
import { FleetTable } from '../fleet/FleetTable';
import { VehicleDrawer } from '../fleet/VehicleDrawer';
import { batteryToneOf, fleetAttentionCount, fleetBucketsOf, fleetRowsOf } from '../fleet/model';
import { useFleetList } from '../fleet/useFleetList';
import '../fleet/style/fleet.css';

/** 搜索防抖窗口（ms），与任务页同口径：输入过程中不发请求。 */
const SEARCH_DEBOUNCE_MS = 300;

export function FleetPage() {
  const token = useSessionStore((state) => state.token);
  const role = useSessionStore((state) => state.user?.role);
  const select = useSelectionStore((state) => state.select);
  const navigate = useNavigate();
  const canMaintain = role !== undefined && hasPermission(role, 'base:write');

  const [searchDraft, setSearchDraft] = useState('');
  const [status, setStatus] = useState('');
  const [keyword, setKeyword] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // 输入 → 查询条件（防抖）。清空输入等价于去掉搜索。
  useEffect(() => {
    const trimmed = searchDraft.trim();
    if (trimmed === keyword) {
      return;
    }
    const timer = setTimeout(() => setKeyword(trimmed), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchDraft, keyword]);

  const list = useFleetList(token, { keyword, status, page: 1, pageSize: MAX_PAGE_SIZE });
  /*
   * 当前任务的**编码与标题**：`monitor/vehicles` 只给 `currentTaskId`，而表格里显示一串
   * UUID 没有意义。任务清单走 `monitor/tasks`（默认只看在跑的 + 出问题的，与
   * `currentTaskId` 的语义一致）。
   */
  const tasks = usePagedList<TaskListItem>('/api/monitor/tasks', { page: 1, pageSize: MAX_PAGE_SIZE }, token);
  const rows = useMemo(() => fleetRowsOf(list.rows, tasks.records), [list.rows, tasks.records]);
  const buckets = useMemo(() => fleetBucketsOf(list.rows), [list.rows]);

  const selectedRow = rows.find((row) => row.id === selectedId) ?? null;
  const selectedVehicle = list.rows.find((vehicle) => vehicle.id === selectedId) ?? null;
  const selectedTask = tasks.records.find((task) => task.id === selectedVehicle?.currentTaskId) ?? null;
  const track = useVehicleTracks(token, selectedId);

  // 刷新后选中的车可能被筛掉/删掉：抽屉必须跟着关，否则会显示一份过期数据
  useEffect(() => {
    if (selectedId && !list.loading && !list.rows.some((vehicle) => vehicle.id === selectedId)) {
      setSelectedId(null);
    }
  }, [selectedId, list.loading, list.rows]);

  const kpis = useMemo<Kpi[]>(() => {
    const byStatus = new Map(buckets.map((bucket) => [bucket.status, bucket.count]));
    const active = (byStatus.get('busy') ?? 0) + (byStatus.get('reserved') ?? 0);
    const avgBattery =
      list.rows.length === 0 ? 0 : list.rows.reduce((sum, vehicle) => sum + vehicle.battery, 0) / list.rows.length;
    return [
      {
        key: 'total',
        label: '车队总数',
        value: String(list.total),
        suffix: '台',
        hint: '含停用与故障，与基础数据页的车辆档案同源',
        tone: 'info'
      },
      {
        key: 'idle',
        label: '空闲可派',
        value: String(byStatus.get('idle') ?? 0),
        suffix: '台',
        hint: '处于 idle，可直接进入调度候选池',
        tone: (byStatus.get('idle') ?? 0) > 0 ? 'ok' : 'warn'
      },
      {
        key: 'active',
        label: '在途',
        value: String(active),
        suffix: '台',
        hint: '已预留（reserved）+ 执行中（busy）',
        tone: active > 0 ? 'info' : 'dim'
      },
      {
        key: 'attention',
        label: '需关注',
        value: String(fleetAttentionCount(list.rows)),
        suffix: '台',
        hint: '充电中 / 离线 / 故障 —— 停用不计入（那是刻意关掉的）',
        tone: fleetAttentionCount(list.rows) > 0 ? 'warn' : 'ok'
      },
      {
        key: 'battery',
        label: '平均电量',
        value: avgBattery.toFixed(0),
        suffix: '%',
        hint: '按当前车队求平均；低于 40% 的车在表里标黄',
        tone: batteryToneOf(avgBattery)
      }
    ];
  }, [buckets, list.rows, list.total]);

  function locate(vehicleId: string, label: string) {
    select({ entityType: 'vehicle', entityId: vehicleId, flowId: vehicleNodeId(vehicleId), label });
    navigate('/map');
  }

  const truncated = list.total > list.rows.length;

  return (
    <div className="udm-page">
      <KpiCards kpis={kpis} />

      <section className="udm-list__toolbar" role="group" aria-label="车辆筛选">
        <label className="udm-field udm-list__search">
          <span className="udm-sr-only">搜索车辆</span>
          <input
            type="search"
            value={searchDraft}
            placeholder="按车辆编码或名称搜索"
            onChange={(event) => setSearchDraft(event.target.value)}
          />
        </label>

        <div className="udm-list__filters">
          <label className="udm-field udm-list__select">
            <span className="udm-sr-only">按状态筛选</span>
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">全部状态</option>
              {buckets.map((bucket) => (
                <option key={bucket.status} value={bucket.status}>
                  {bucket.label}（{bucket.count}）
                </option>
              ))}
            </select>
          </label>

          <button type="button" className="udm-btn udm-btn--ghost" onClick={list.refresh} disabled={list.loading}>
            <IconRefresh size={14} /> 刷新
          </button>

          {canMaintain ? (
            <Link className="udm-btn udm-btn--ghost" to="/base-data">
              <IconDatabase size={14} /> 去基础数据维护车辆
            </Link>
          ) : null}
        </div>
      </section>

      <section className="udm-card" aria-label="车队列表">
        <header className="udm-card__head">
          <h3 className="udm-card__title">车队列表（{list.total}）</h3>
          <span className="udm-card__aside">
            M7 · <code>/api/monitor/vehicles</code> · <code>{'/api/map/tracks/{vehicleId}'}</code>
          </span>
        </header>
        <div className="udm-card__body">
          <p className="udm-flt__buckets" aria-label="状态分桶">
            {buckets.map((bucket) => (
              <button
                key={bucket.status}
                type="button"
                className={`udm-flt__bucket ${status === bucket.status ? 'is-active' : ''}`}
                onClick={() => setStatus(status === bucket.status ? '' : bucket.status)}
                aria-pressed={status === bucket.status}
              >
                <span className={`udm-dot ${toneClass(bucket.tone)}`} aria-hidden="true" />
                {bucket.label}
                <strong>{bucket.count}</strong>
              </button>
            ))}
          </p>
          {truncated ? (
            <p className="udm-list__hint">
              车队共 {list.total} 台，超过单页上限，KPI 与分桶只统计已取回的 {list.rows.length} 台。
            </p>
          ) : null}

          <div className={selectedVehicle ? 'udm-flt__split' : undefined}>
            <FleetTable
              rows={rows}
              loading={list.loading}
              error={list.error}
              selectedId={selectedId}
              onOpen={(row) => setSelectedId(row.id)}
              onRetry={list.refresh}
            />
            {selectedVehicle && selectedRow ? (
              <VehicleDrawer
                vehicle={selectedVehicle}
                row={selectedRow}
                taskTitle={selectedTask?.title ?? null}
                track={track.track}
                trackLoading={track.loading}
                trackError={track.error}
                onLocate={locate}
                onClose={() => setSelectedId(null)}
              />
            ) : null}
          </div>

          {!selectedVehicle ? (
            <p className="udm-list__hint">点车辆编码打开右侧详情：实时位置、当前任务与轨迹采样点。</p>
          ) : null}
        </div>
      </section>
    </div>
  );
}

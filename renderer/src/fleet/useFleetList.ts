/**
 * 车辆中心的取数 hook：`GET /api/monitor/vehicles` + 事件驱动的增量位置。
 *
 * ## 为什么不用 `usePagedList`
 *
 * 通用分页 hook 只会在「参数变化 / 手动 refresh」时取数，而这一页要的是
 * **会动的车队表**：车在跑的时候位置每秒都在变。因此这里在通用分页的基础上多了一层
 * 事件订阅，且按事件的性质分两种处理（沿用 D-23 的同一判据）：
 *
 * | 事件 | 处理 |
 * | --- | --- |
 * | `vehicle.changed`（**带坐标**，如执行推进 / 演示缓动） | 只把坐标并进本地覆盖表，**不发请求** |
 * | `vehicle.changed`（不带坐标，如 apply 改状态）/ `execution.progress` / `task.changed` / `map.updated` | 节流 500 ms 重拉列表 |
 *
 * 位置落在**本地覆盖表**而不是整表，是因为「每秒重拉」虽然只有几十行，但会让
 * 表格里的输入框/筛选状态跟着重建；而坐标是唯一高频变化的字段，单独覆盖代价最小。
 *
 * ## 不挂轮询兜底
 *
 * 地图页有 1 s 兜底轮询（事件丢一条就少一帧）。本页不挂：表格的用途是「看现状」，
 * 少一帧不影响判断，而兜底轮询会让这个页面在空闲时也持续发请求。需要最新值时有刷新按钮。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_PAGE_SIZE, type DomainEvent, type MonitorVehicleItem } from '@udm/shared';
import { apiClient } from '../api';

/** 高频事件的重拉节流窗口（ms）。比地图的 250 ms 宽：表格不需要每帧都准。 */
const THROTTLE_MS = 500;

export interface FleetQuery {
  keyword: string;
  status: string;
  page: number;
  pageSize?: number;
}

export interface FleetListState {
  rows: MonitorVehicleItem[];
  total: number;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/** 事件是否携带可用坐标（`vehicle.changed` 的两种形态见文件头）。 */
function positionOf(payload: unknown): { vehicleId: string; x: number; y: number } | null {
  const value = payload as { vehicleId?: unknown; x?: unknown; y?: unknown } | null;
  if (!value || typeof value.vehicleId !== 'string') {
    return null;
  }
  if (typeof value.x !== 'number' || typeof value.y !== 'number' || !Number.isFinite(value.x) || !Number.isFinite(value.y)) {
    return null;
  }
  return { vehicleId: value.vehicleId, x: value.x, y: value.y };
}

export function useFleetList(token: string | null, query: FleetQuery): FleetListState {
  const [rows, setRows] = useState<MonitorVehicleItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<Record<string, { x: number; y: number }>>({});
  const [revision, setRevision] = useState(0);

  const requestRef = useRef(0);
  const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  const payload = useMemo(
    () => ({
      page: query.page,
      pageSize: query.pageSize ?? DEFAULT_PAGE_SIZE,
      keyword: query.keyword.trim(),
      status: query.status
    }),
    [query.page, query.pageSize, query.keyword, query.status]
  );
  const payloadKey = JSON.stringify(payload);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const request = (requestRef.current += 1);
    setLoading(true);
    void apiClient
      .invoke<{ records: MonitorVehicleItem[]; total: number }>('/api/monitor/vehicles', payload, token)
      .then((result) => {
        // 过期响应一律丢弃（与 `usePagedList` 同因：先发的可能后到）
        if (!mountedRef.current || request !== requestRef.current) {
          return;
        }
        if (result.code === 0) {
          setRows(result.data.records);
          setTotal(result.data.total);
          // 服务端值是新基线，覆盖表清空重来（否则被删掉的车辆会留下幻影坐标）
          setOverlay({});
          setError(null);
        } else {
          setError(result.message);
        }
      })
      .finally(() => {
        if (mountedRef.current && request === requestRef.current) {
          setLoading(false);
        }
      });
  }, [token, payloadKey, revision, payload]);

  useEffect(() => {
    const schedule = () => {
      if (pendingRef.current) {
        return;
      }
      pendingRef.current = setTimeout(() => {
        pendingRef.current = null;
        refresh();
      }, THROTTLE_MS);
    };

    const unsubscribe = apiClient.on(null, (message: DomainEvent) => {
      if (message.type === 'vehicle.changed') {
        const position = positionOf(message.payload);
        if (position) {
          setOverlay((current) => ({ ...current, [position.vehicleId]: { x: position.x, y: position.y } }));
          return;
        }
        schedule();
        return;
      }
      if (
        message.type === 'execution.progress' ||
        message.type === 'task.changed' ||
        message.type === 'map.updated'
      ) {
        schedule();
      }
    });

    return () => {
      unsubscribe();
      if (pendingRef.current) {
        clearTimeout(pendingRef.current);
        pendingRef.current = null;
      }
    };
  }, [refresh]);

  const merged = useMemo(
    () =>
      rows.map((row) => {
        const position = overlay[row.id];
        return position ? { ...row, x: position.x, y: position.y } : row;
      }),
    [rows, overlay]
  );

  return { rows: merged, total, loading, error, refresh };
}

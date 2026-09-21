/**
 * 地图数据入口：拉取 + 事件刷新 + 轮询兜底。
 *
 * **事件必须分层**，否则会踩到本项目实测过的性能事故：
 *
 * | 事件 | 处理方式 | 原因 |
 * | --- | --- | --- |
 * | `map.updated` / `task.changed` / `alert.*` | 重新拉取 `overview` | 改变的是**图结构**（路网/路线/站点/角标） |
 * | `vehicle.changed` / `execution.progress` | 只写入 `positionsRef` | 改变的是**位置**，高频；若也触发全量拉取，会每秒重建 `nodes`/`edges`，导致 React Flow 反复重挂载（实测：边会间歇性渲染不出来） |
 *
 * 位置因此**不进 React state**（`positionsRef` 是 ref），车辆的绘制由 `useVehicleMotion`
 * 通过 `updateNode` 定向更新，完全不触发容器重渲染。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '../../api';
import type { MapOverview, MapVehicle } from '../../api/types';
import type { DomainEvent } from '@udm/shared';
import { structuralSignature } from '../model/structural';

/** 高频事件节流窗口（ms），与 `docs/api.md` §4 的「≥250ms」一致。 */
const THROTTLE_MS = 250;
const FALLBACK_INTERVAL_MS = 1000;

/** 改变**图结构**、需要重新拉取快照的事件。 */
const STRUCTURAL_EVENTS = ['map.updated', 'task.changed', 'alert.created', 'alert.updated'] as const;
/** 只改变**位置/运行态**、不应触发快照重拉的高频事件。 */
const POSITIONAL_EVENTS = ['vehicle.changed', 'execution.progress'] as const;

/** 车辆实时位置源（ref，变化不触发重渲染）。 */
export interface VehiclePosition {
  x: number;
  y: number;
  status?: MapVehicle['status'];
  battery?: number;
  taskId?: string | null;
}

export interface MapOverviewState {
  overview: MapOverview | null;
  loading: boolean;
  error: string | null;
  lastEventSeq: number;
  /** 车辆实时位置（含事件推送的最新值）；读取时机由调用方决定。 */
  positionsRef: React.RefObject<Record<string, VehiclePosition>>;
  /** 运行态变化的小版本号（仅在 status/battery 真的变化时自增，低频）。 */
  statusRevision: number;
  refresh: () => void;
}

export function useMapOverview(token: string | null): MapOverviewState {
  const [overview, setOverview] = useState<MapOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastEventSeq, setLastEventSeq] = useState(0);
  const [statusRevision, setStatusRevision] = useState(0);

  const positionsRef = useRef<Record<string, VehiclePosition>>({});
  /** 上一份快照的结构签名；相同则保持原引用，避免每秒重建图结构。 */
  const signatureRef = useRef<string | null>(null);
  const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const lastSeqRef = useRef(0);

  /** 把快照里的车辆位置并入实时位置（快照是权威基线，事件在其上增量更新）。 */
  const mergeSnapshotVehicles = useCallback((vehicles: MapVehicle[]) => {
    const next = { ...positionsRef.current };
    for (const vehicle of vehicles) {
      next[vehicle.id] = {
        x: vehicle.x,
        y: vehicle.y,
        status: vehicle.status,
        battery: vehicle.battery,
        taskId: vehicle.taskId
      };
    }
    positionsRef.current = next;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await apiClient.invoke<MapOverview>('/api/map/overview', {}, token);
    if (!mountedRef.current) {
      return;
    }
    if (result.code === 0) {
      const signature = structuralSignature(result.data);
      // 结构没变就不换引用：否则 `nodes`/`edges` 每秒重建，React Flow 全量重算
      if (signature !== signatureRef.current) {
        signatureRef.current = signature;
        setOverview(result.data);
        mergeSnapshotVehicles(result.data.vehicles);
      }
      lastSeqRef.current = result.data.eventSeq;
      setLastEventSeq(result.data.eventSeq);
      setError(null);
    } else {
      setError(result.message);
    }
    setLoading(false);
  }, [token, mergeSnapshotVehicles]);

  const scheduleLoad = useCallback(() => {
    if (pendingRef.current) {
      return;
    }
    pendingRef.current = setTimeout(() => {
      pendingRef.current = null;
      void load();
    }, THROTTLE_MS);
  }, [load]);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    return () => {
      mountedRef.current = false;
      if (pendingRef.current) {
        clearTimeout(pendingRef.current);
        pendingRef.current = null;
      }
    };
  }, [load]);

  useEffect(() => {
    const unsubscribe = apiClient.on<Record<string, unknown>>(null, (message: DomainEvent<Record<string, unknown>>) => {
      // 按 eventSeq 去重（重连后主进程可能重放）
      if (typeof message.eventSeq === 'number') {
        if (message.eventSeq <= lastSeqRef.current) {
          return;
        }
        lastSeqRef.current = message.eventSeq;
        setLastEventSeq(message.eventSeq);
      }

      if ((POSITIONAL_EVENTS as readonly string[]).includes(message.type)) {
        const payload = message.payload ?? {};
        const vehicleId = String(payload.vehicleId ?? '');
        const x = Number(payload.x);
        const y = Number(payload.y);
        if (!vehicleId || !Number.isFinite(x) || !Number.isFinite(y)) {
          return;
        }
        const prev = positionsRef.current[vehicleId];
        const status = payload.status as MapVehicle['status'] | undefined;
        const battery = Number.isFinite(Number(payload.battery)) ? Number(payload.battery) : undefined;
        positionsRef.current = {
          ...positionsRef.current,
          [vehicleId]: { x, y, status: status ?? prev?.status, battery: battery ?? prev?.battery, taskId: prev?.taskId ?? null }
        };
        // 只有运行态（状态/电量）真的变化时才触发一次低频重渲染，位置变化不触发
        const statusChanged = status !== undefined && status !== prev?.status;
        const batteryChanged = battery !== undefined && Math.round(battery) !== Math.round(prev?.battery ?? -1);
        if (statusChanged || batteryChanged) {
          setStatusRevision((value) => value + 1);
        }
        return;
      }

      if ((STRUCTURAL_EVENTS as readonly string[]).includes(message.type)) {
        scheduleLoad();
      }
    });
    return unsubscribe;
  }, [scheduleLoad]);

  // 定时兜底 + 页面重新可见时补齐
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) {
        void load();
      }
    }, FALLBACK_INTERVAL_MS);
    const onVisible = () => {
      if (!document.hidden) {
        void load();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  return { overview, loading, error, lastEventSeq, positionsRef, statusRevision, refresh: () => void load() };
}

/**
 * 拉取选中车辆的轨迹（`GET /api/map/tracks/{vehicleId}`，M6 §3.6.2）。
 *
 * ## 为什么只在「选中了车辆」时请求
 *
 * 轨迹点会随执行器采样不断增长（一台上线车辆几分钟就是几百点），
 * 而它**只服务当前的选中对象**（回放面板）。对全部车辆预取等于把
 * 「每台车的历史」都搬进渲染层内存，而其中绝大多数永远不会被看。
 *
 * ## 为什么要有请求序号
 *
 * 使用者连续点选不同车辆时会有多个请求在飞，返回顺序不保证。
 * 没有序号的话，先发的慢响应会覆盖后发的快响应 —— 详情栏显示 A 车、
 * 轨迹却是 B 车的，且**看不出任何异常**（这类静默错配比报错难查得多）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { VehicleTracks } from '@udm/shared';
import { apiClient } from '../../api';

export interface VehicleTracksState {
  /** 当前选中车辆的轨迹点（升序）；没有选中或尚未返回时为 `[]`。 */
  track: VehicleTracks | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useVehicleTracks(token: string | null, vehicleId: string | null): VehicleTracksState {
  const [track, setTrack] = useState<VehicleTracks | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const requestRef = useRef(0);

  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    if (!token || !vehicleId) {
      setTrack(null);
      setError(null);
      setLoading(false);
      return;
    }
    const request = (requestRef.current += 1);
    let cancelled = false;
    setLoading(true);

    void apiClient
      .invoke<VehicleTracks>(`/api/map/tracks/${vehicleId}`, {}, token)
      .then((result) => {
        // 过期响应一律丢弃（见文件头第 2 条）
        if (cancelled || request !== requestRef.current) {
          return;
        }
        if (result.code === 0) {
          setTrack(result.data);
          setError(null);
        } else {
          setTrack(null);
          setError(result.message);
        }
      })
      .finally(() => {
        if (!cancelled && request === requestRef.current) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [token, vehicleId, revision]);

  return { track, loading, error, refresh };
}

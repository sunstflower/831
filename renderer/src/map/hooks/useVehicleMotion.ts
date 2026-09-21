/**
 * 车辆位置补帧（rAF 驱动，**不产生任何 React 重渲染**）。
 *
 * 设计要点：
 * 1. 位置源是 **ref**（`positionsRef`），每帧直接读取，因此新坐标到达时
 *    不需要经过 state 就能被感知 —— 这是断开「高频事件 → 容器重渲染 → 图重建」链条的关键；
 * 2. 只有坐标**真的变化**时才登记新的缓动段，并刷新该车辆的 `lastSeen`；
 *    目标不变时不刷新 `lastSeen`，这样「长时间没有新事件」才能被正确判定为过期并冻结；
 * 3. 每帧结果通过 `onFrame` 回调交给调用方，由 `updateNode` 做定向更新。
 */
import { useEffect, useRef } from 'react';
import { toFlowXY } from '../model/projection';
import { computeFrame, registerTrip, sameXY, type MotionTrips, type XY } from '../model/motion';

export interface MotionSource {
  x: number;
  y: number;
}

export interface VehicleMotionOptions {
  /** 每帧回调；仅在坐标真的变化时触发。 */
  onFrame: (positions: Record<string, XY>) => void;
  /** 位置源；每帧读取其 `current`（ref，变化不触发重渲染）。 */
  sourceRef: React.RefObject<Record<string, MotionSource>>;
}

export function useVehicleMotion(options: VehicleMotionOptions): void {
  const tripsRef = useRef<MotionTrips>({});
  const lastSeenRef = useRef<Record<string, number>>({});
  const lastTargetRef = useRef<Record<string, XY>>({});
  const lastEmittedRef = useRef<Record<string, XY>>({});
  const onFrameRef = useRef(options.onFrame);
  const sourceRefRef = useRef(options.sourceRef);
  onFrameRef.current = options.onFrame;
  sourceRefRef.current = options.sourceRef;

  useEffect(() => {
    let frame = 0;
    let stopped = false;

    const tick = () => {
      if (stopped) {
        return;
      }
      const now = performance.now();
      const source = sourceRefRef.current.current ?? {};
      let trips = tripsRef.current;

      // 1) 感知新坐标：只对「目标发生变化」的车辆登记缓动并刷新 lastSeen
      for (const [vehicleId, raw] of Object.entries(source)) {
        const target = toFlowXY(raw);
        const previousTarget = lastTargetRef.current[vehicleId];
        if (!sameXY(previousTarget, target)) {
          lastTargetRef.current[vehicleId] = target;
          lastSeenRef.current[vehicleId] = now;
          trips = registerTrip(trips, vehicleId, target, now, lastEmittedRef.current[vehicleId]);
        }
      }
      tripsRef.current = trips;

      // 2) 计算该帧位置
      const { positions } = computeFrame(tripsRef.current, lastSeenRef.current, now);
      const changed: Record<string, XY> = {};
      let dirty = false;
      for (const [vehicleId, xy] of Object.entries(positions)) {
        if (!sameXY(lastEmittedRef.current[vehicleId], xy)) {
          changed[vehicleId] = xy;
          lastEmittedRef.current[vehicleId] = xy;
          dirty = true;
        }
      }
      if (dirty) {
        onFrameRef.current(changed);
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
    };
  }, []);
}

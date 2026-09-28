import { describe, expect, it } from 'vitest';
import type { VehicleTrackPoint } from '@udm/shared';
import {
  clampIndex,
  formatDuration,
  formatSpeedKph,
  polylinePoints,
  scrubIndex,
  trackDistanceM,
  trackPointXY,
  trackSummary
} from './track';

/** 采样点工厂：只写测试关心的字段，其余给固定值（避免每个用例重复 6 个字段）。 */
function point(ts: string, x: number, y: number, speedMps = 0): VehicleTrackPoint {
  return { ts, x, y, speedMps, status: 'running', taskId: 't1' };
}

const T0 = '2026-09-28T08:00:00.000Z';

describe('trackSummary', () => {
  it('空轨迹给全 0，不返回 NaN（面板会直接显示这些数）', () => {
    expect(trackSummary([])).toEqual({
      count: 0,
      durationMs: 0,
      distanceM: 0,
      maxSpeedMps: 0,
      avgSpeedMps: 0
    });
  });

  it('单点：跨度为 0，平均速度取 0 而不是无穷', () => {
    const summary = trackSummary([point(T0, 0, 0, 2)]);
    expect(summary.count).toBe(1);
    expect(summary.durationMs).toBe(0);
    expect(summary.distanceM).toBe(0);
    expect(summary.avgSpeedMps).toBe(0);
    expect(summary.maxSpeedMps).toBe(2);
  });

  it('跨度为 0 的多个点（同一时刻）也不会把平均速度算成 Infinity', () => {
    const summary = trackSummary([point(T0, 0, 0), point(T0, 30, 40)]);
    expect(summary.durationMs).toBe(0);
    expect(summary.avgSpeedMps).toBe(0);
    expect(summary.distanceM).toBe(50);
  });

  it('里程按相邻采样点的直线距离求和；均速 = 里程 / 时间跨度', () => {
    const summary = trackSummary([
      point('2026-09-28T08:00:00.000Z', 0, 0, 1),
      point('2026-09-28T08:00:10.000Z', 30, 40, 3),
      point('2026-09-28T08:00:20.000Z', 30, 40, 0.5)
    ]);
    expect(summary.distanceM).toBe(50);
    expect(summary.durationMs).toBe(20_000);
    expect(summary.avgSpeedMps).toBeCloseTo(2.5, 6);
    expect(summary.maxSpeedMps).toBe(3);
  });

  it('坏时间戳收敛成 0 跨度，不让 NaN 传染整条轨迹', () => {
    const summary = trackSummary([point('not-a-time', 0, 0), point(T0, 10, 0)]);
    expect(summary.durationMs).toBe(0);
    expect(summary.avgSpeedMps).toBe(0);
    expect(summary.distanceM).toBe(10);
  });
});

describe('trackDistanceM', () => {
  it('不足两个点时里程为 0（单点画不出一段路）', () => {
    expect(trackDistanceM([])).toBe(0);
    expect(trackDistanceM([point(T0, 5, 5)])).toBe(0);
  });

  it('按直线距离而非曼哈顿距离（3-4-5 直角三角形 → 5）', () => {
    expect(trackDistanceM([point(T0, 0, 0), point(T0, 3, 4)])).toBe(5);
  });
});

describe('polylinePoints', () => {
  it('换算到画布坐标：按 6 px/m 缩放并翻转 y（与节点/边同一套变换）', () => {
    expect(polylinePoints([point(T0, 10, 20)])).toBe('60,-120');
  });

  it('多点按顺序连成 points 字符串', () => {
    expect(polylinePoints([point(T0, 0, 0), point(T0, 1, 2), point(T0, -3, 0)])).toBe('0,0 6,-12 -18,0');
  });

  it('`upto` 含端点：画到第 k 个采样点为止（回放靠它截断）', () => {
    const points = [point(T0, 0, 0), point(T0, 1, 0), point(T0, 2, 0), point(T0, 3, 0)];
    expect(polylinePoints(points, 1)).toBe('0,0 6,0');
    expect(polylinePoints(points, 0)).toBe('0,0');
  });

  it('`upto` 越界时夹到两端，不抛错也不画出错位的点', () => {
    const points = [point(T0, 0, 0), point(T0, 1, 0)];
    expect(polylinePoints(points, 99)).toBe('0,0 6,0');
    expect(polylinePoints(points, -5)).toBe('0,0');
  });

  it('空轨迹返回空串（<polyline> 拿到空 points 不报错）', () => {
    expect(polylinePoints([], 3)).toBe('');
  });
});

describe('scrubIndex / clampIndex', () => {
  it('进度 0 → 第一个点，进度 1 → 最后一个点', () => {
    expect(scrubIndex(5, 0)).toBe(0);
    expect(scrubIndex(5, 1)).toBe(4);
  });

  it('中间进度四舍五入到最近的采样点', () => {
    expect(scrubIndex(5, 0.5)).toBe(2);
    expect(scrubIndex(5, 0.2)).toBe(1);
    expect(scrubIndex(5, 0.3)).toBe(1);
  });

  it('没有采样点时返回 -1（调用方据此不画游标）', () => {
    expect(scrubIndex(0, 0.5)).toBe(-1);
    expect(clampIndex(0, 3)).toBe(-1);
  });

  it('进度越界 / NaN 一律夹回合法下标', () => {
    expect(scrubIndex(3, -2)).toBe(0);
    expect(scrubIndex(3, 9)).toBe(2);
    expect(scrubIndex(3, Number.NaN)).toBe(0);
    expect(clampIndex(3, 1.9)).toBe(1);
  });
});

describe('trackPointXY', () => {
  it('单点坐标与折线用的是同一套换算（游标不会画偏）', () => {
    expect(trackPointXY(point(T0, 10, 20))).toEqual({ x: 60, y: -120 });
  });
});

describe('formatDuration / formatSpeedKph', () => {
  it('跨度文案分档：秒 / 分秒 / 小时分', () => {
    expect(formatDuration(0)).toBe('0 秒');
    expect(formatDuration(45_000)).toBe('45 秒');
    expect(formatDuration(80_000)).toBe('1 分 20 秒');
    expect(formatDuration(3_661_000)).toBe('1 小时 1 分');
  });

  it('负数与 NaN 一律给「0 秒」（不出现 -1 秒这种值）', () => {
    expect(formatDuration(-5)).toBe('0 秒');
    expect(formatDuration(Number.NaN)).toBe('0 秒');
  });

  it('速度换算成 km/h（契约是 m/s，展示是人话）', () => {
    expect(formatSpeedKph(0)).toBe('0.0 km/h');
    expect(formatSpeedKph(1.5)).toBe('5.4 km/h');
    expect(formatSpeedKph(Number.NaN)).toBe('—');
  });
});

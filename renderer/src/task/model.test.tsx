import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TaskListItem } from '@udm/shared';
import {
  EMPTY_QUERY,
  TASK_COLUMNS,
  TASK_STATUS_FILTERS,
  UNFINISHED_STATUSES,
  buildPayload,
  vehicleOptionsOf
} from './model';

/**
 * 任务表格模型的单测。
 *
 * 断的是**显示口径与载荷口径**，而不是「屏幕上出现了某段文字」：
 * 状态徽标的颜色、时间窗的念法、`status` 的逗号组合都在这层，
 * 组件测试照着实现写断言时这些错一样会通过。
 */
const task: TaskListItem = {
  id: 'seed-task-demo',
  code: 'T-DEMO-0001',
  title: 'A 仓 → B 仓 演示配送',
  status: 'running',
  priority: 'urgent',
  cargoKg: 100,
  fromSiteId: 'seed-site-a',
  toSiteId: 'seed-site-b',
  fromSiteName: 'A 仓库',
  toSiteName: 'B 仓库',
  timeWindowStart: null,
  timeWindowEnd: null,
  assignedVehicleId: 'seed-veh-agv01',
  vehicleCode: 'AGV-01',
  progress: 0.42,
  createdAt: '2026-01-01T00:00:00.000Z',
  createdBy: 'seed'
};

/**
 * 把单元格渲染成 HTML 再断言。
 *
 * 不走「取元素的 props 再逐层钻」：那种写法把测试绑死在 JSX 的嵌套结构上 ——
 * 给徽标外面包一层 `<span>` 就会红，而口径其实没变。渲染成 HTML 后断的是
 * **使用者真正看到的内容**与类名，两者都是口径的一部分。
 */
function cellHtml(key: string, row: TaskListItem): string {
  const column = TASK_COLUMNS.find((item) => item.key === key);
  expect(column, `列 ${key} 不存在`).toBeDefined();
  return renderToStaticMarkup(<>{column!.cell(row)}</>);
}

/** 去掉标签后的纯文本（用于「这一列显示成什么」的断言）。 */
function cellText(key: string, row: TaskListItem): string {
  return cellHtml(key, row).replace(/<[^>]*>/g, '');
}

describe('列显示口径', () => {
  it('状态用中文徽标，颜色按状态给（running 是 ok）', () => {
    const html = cellHtml('status', task);
    expect(html).toContain('执行中');
    expect(html).toContain('udm-badge--ok');
    // 失败用危险色：一串全是中性色的列表里，只有出错的那条应当跳出来
    expect(cellHtml('status', { ...task, status: 'failed' })).toContain('udm-badge--danger');
  });

  it('优先级显示中文而不是机器值', () => {
    expect(cellText('priority', task)).toBe('紧急');
  });

  it('起终点合成一列，缺一端时显示破折号而不是空白', () => {
    expect(cellText('fromSiteName', task)).toBe('A 仓库 → B 仓库');
    expect(cellText('fromSiteName', { ...task, toSiteName: null })).toBe('A 仓库 → —');
  });

  it('无时间窗时说「不限时段」，而不是显示成破折号（那是数据缺失的样子）', () => {
    expect(cellText('timeWindowStart', task)).toBe('不限时段');
    const windowed = { ...task, timeWindowStart: '2026-09-27T08:00:00.000Z', timeWindowEnd: '2026-09-27T18:00:00.000Z' };
    expect(cellText('timeWindowStart', windowed)).toBe('2026-09-27 08:00:00 → 2026-09-27 18:00:00');
  });

  it('进度是「条 + 百分比」：只有条看不出还差多少，只有数字看不出走了多远', () => {
    const html = cellHtml('progress', task);
    expect(cellText('progress', task)).toBe('42%');
    // 进度条的宽度就是百分比本身，颜色跟随状态（执行中是 ok）
    expect(html).toContain('width:42%');
    expect(html).toContain('udm-progress--ok');
    expect(cellHtml('progress', { ...task, progress: 0 })).toContain('width:0%');
  });

  it('未指派的车辆显示成破折号', () => {
    expect(cellText('vehicleCode', task)).toBe('AGV-01');
    expect(cellText('vehicleCode', { ...task, vehicleCode: null })).toBe('—');
  });
});

describe('筛选与载荷', () => {
  it('「进行中（未结束）」是一个逗号组合，且列出的都是未结束的状态', () => {
    const filter = TASK_STATUS_FILTERS[0]!;
    expect(filter.label).toBe('进行中（未结束）');
    expect(filter.value).toBe('draft,pending,assigned,running,paused');
    expect(UNFINISHED_STATUSES).not.toContain('finished');
    expect(UNFINISHED_STATUSES).not.toContain('cancelled');
  });

  it('状态下拉覆盖全部 8 个状态，且每个取值都能被主进程解析', () => {
    const values = TASK_STATUS_FILTERS.slice(1).map((option) => option.value);
    expect(values).toEqual([
      'draft',
      'pending',
      'assigned',
      'running',
      'paused',
      'finished',
      'cancelled',
      'failed'
    ]);
  });

  it('空筛选一个字段都不发（主进程把空值当未给，见 D-40）', () => {
    expect(buildPayload(EMPTY_QUERY)).toEqual({ page: 1, pageSize: 20 });
  });

  it('关键词去空白后发送，逗号组合原样发送（解析在服务端）', () => {
    const payload = buildPayload({
      ...EMPTY_QUERY,
      keyword: '  T2026  ',
      status: UNFINISHED_STATUSES.join(','),
      priority: 'urgent',
      vehicleId: 'seed-veh-agv01'
    });
    expect(payload).toEqual({
      page: 1,
      pageSize: 20,
      keyword: 'T2026',
      status: 'draft,pending,assigned,running,paused',
      priority: 'urgent',
      vehicleId: 'seed-veh-agv01'
    });
  });

  it('纯空白的搜索不发送', () => {
    expect(buildPayload({ ...EMPTY_QUERY, keyword: '   ' })).toEqual({ page: 1, pageSize: 20 });
  });
});

describe('车辆筛选项', () => {
  it('文案里带编码与名称，避免同名车辆分不清', () => {
    expect(vehicleOptionsOf([{ id: 'v1', code: 'AGV-01', name: 'AGV 一号' }])).toEqual([
      { value: 'v1', label: 'AGV-01 · AGV 一号' }
    ]);
  });
});

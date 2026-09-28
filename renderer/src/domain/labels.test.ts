import { describe, expect, it } from 'vitest';
import {
  ALERT_LEVELS,
  ALERT_STATUSES,
  ALERT_TYPES,
  OBJECT_TYPES,
  RESTRICTION_STATUSES,
  RESTRICTION_TYPES,
  ROUTE_ALGORITHMS,
  SITE_TYPES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  VEHICLE_STATUSES,
  VEHICLE_TYPES
} from '@udm/shared';
import {
  ALERT_LEVEL_LABEL,
  ALERT_STATUS_LABEL,
  ALERT_TYPE_LABEL,
  OBJECT_TYPE_LABEL,
  RESTRICTION_STATUS_LABEL,
  RESTRICTION_TYPE_LABEL,
  ROUTE_ALGORITHM_LABEL,
  SITE_TYPE_LABEL,
  TASK_PRIORITY_LABEL,
  TASK_STATUS_LABEL,
  VEHICLE_STATUS_LABEL,
  VEHICLE_TYPE_LABEL,
  labelOf
} from './labels';

/**
 * 枚举文案完备性。
 *
 * 为什么值得一组专门的用例：界面上出现 `vehicle_offline` 这样的机器值，
 * 使用者读不懂；而漏一条文案**不会编译报错、不会抛异常**，只会静默显示英文/空白。
 * 这里用 `shared` 的枚举清单逐值断言，把「新增枚举值忘了加中文」变成一次测试失败
 * —— 这正是 `Record<枚举联合类型, string>` 在类型层面的保护之外，再补一道运行时防线
 * （类型只保护本仓库内的映射声明，不保护「枚举加了值而映射表用了 as」这类绕过）。
 */
const TABLES: Array<[string, Record<string, string>, readonly string[]]> = [
  ['VEHICLE_STATUS_LABEL', VEHICLE_STATUS_LABEL, VEHICLE_STATUSES],
  ['SITE_TYPE_LABEL', SITE_TYPE_LABEL, SITE_TYPES],
  ['TASK_STATUS_LABEL', TASK_STATUS_LABEL, TASK_STATUSES],
  ['ALERT_LEVEL_LABEL', ALERT_LEVEL_LABEL, ALERT_LEVELS],
  ['ALERT_TYPE_LABEL', ALERT_TYPE_LABEL, ALERT_TYPES],
  ['ALERT_STATUS_LABEL', ALERT_STATUS_LABEL, ALERT_STATUSES],
  ['OBJECT_TYPE_LABEL', OBJECT_TYPE_LABEL, OBJECT_TYPES],
  ['RESTRICTION_TYPE_LABEL', RESTRICTION_TYPE_LABEL, RESTRICTION_TYPES],
  ['RESTRICTION_STATUS_LABEL', RESTRICTION_STATUS_LABEL, RESTRICTION_STATUSES],
  ['TASK_PRIORITY_LABEL', TASK_PRIORITY_LABEL, TASK_PRIORITIES],
  ['VEHICLE_TYPE_LABEL', VEHICLE_TYPE_LABEL, VEHICLE_TYPES],
  ['ROUTE_ALGORITHM_LABEL', ROUTE_ALGORITHM_LABEL, ROUTE_ALGORITHMS]
];

describe('labels · 枚举文案完备性', () => {
  it.each(TABLES)('%s 覆盖全部枚举值，且没有空文案', (_name, table, values) => {
    for (const value of values) {
      expect(table[value], `${value} 缺少文案`).toBeTruthy();
    }
  });

  it('车辆 7 态全部有中文文案', () => {
    for (const status of VEHICLE_STATUSES) {
      expect(VEHICLE_STATUS_LABEL[status], `${status} 缺少文案`).toBeTruthy();
    }
  });

  it('对象类型（含地图特有的 order）全部有中文文案', () => {
    for (const [type, label] of Object.entries(OBJECT_TYPE_LABEL)) {
      expect(label, `${type} 缺少文案`).toBeTruthy();
    }
    expect(OBJECT_TYPE_LABEL.order).toBe('订单');
  });

  it('告警类型文案与 design.md §4.8 的五个类型一一对应', () => {
    expect(Object.keys(ALERT_TYPE_LABEL).sort()).toEqual([...ALERT_TYPES].sort());
    expect(ALERT_TYPE_LABEL.vehicle_offline).toBe('车辆离线');
  });

  it('labelOf 在值为 undefined 时给出「未知」而不是空白', () => {
    expect(labelOf(VEHICLE_STATUS_LABEL, undefined)).toBe('未知');
  });

  it('labelOf 对未登记的值回显原值，绝不显示空白', () => {
    // 枚举外的值（例如后端新增了一个状态而前端还没跟上）必须看得见，不能被吞掉
    expect(labelOf({} as Record<string, string>, 'brand_new' as unknown as string)).toBe('brand_new');
  });
});

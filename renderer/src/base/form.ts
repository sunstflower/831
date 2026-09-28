/**
 * 基础数据页（M2）的**表单定义**：四张表各有哪些可编辑字段、怎么取初始值。
 *
 * 通用机制（`FormField` / `emptyMeans` / 「编辑只发改过的字段」/ 字段级错误形状）
 * 见 [`domain/form.ts`](../domain/form.ts) —— 那是 M2 与 M3 共用的一份实现，
 * 本文件只保留**本模块特有的内容**：字段清单、候选清单（节点）、启停动作与行标题。
 *
 * **边界**：本文件不定义数据、不发请求、不做权限判断。字段名必须与
 * `shared/src/base-rules.ts` 读的名字一字不差（那是服务端规则的唯一作者）。
 */
import {
  FIELD_LIMITS,
  RESTRICTION_STATUSES,
  RESTRICTION_TYPES,
  SITE_TYPES,
  TASK_PRIORITIES,
  VEHICLE_TYPES,
  type NodeListItem,
  type VehicleListItem
} from '@udm/shared';
import {
  ENABLED_STATUS_LABEL,
  RESTRICTION_STATUS_LABEL,
  RESTRICTION_TYPE_LABEL,
  SITE_TYPE_LABEL,
  TASK_PRIORITY_LABEL,
  VEHICLE_TYPE_LABEL,
  labelOf
} from '../domain/labels';
import type { BaseDataRow, BaseDataTabKey } from './model';
import { buildFormPayload, emptyFormValuesOf, formValuesOf, type BuildResult, type FormSpec, type FormValues } from '../domain/form';

/** 通用写表单模型的类型从这里**转发**：既有调用点（页面 / 弹层）只 import 本模块。 */
export type { BuildResult, FormField, FormSpec, FormValues } from '../domain/form';

function enumOptions(values: readonly string[], labels: Record<string, string>): Array<{ value: string; label: string }> {
  return values.map((value) => ({ value, label: labelOf(labels, value) }));
}

/** 四张表的可编辑字段。顺序即表单里的显示顺序（按「先认人、再定量」排列）。 */
export const FORM_SPECS: Record<BaseDataTabKey, FormSpec> = {
  sites: {
    titleCreate: '新增站点',
    titleEdit: '编辑站点',
    fields: [
      { name: 'code', label: '编码', kind: 'text', emptyMeans: 'invalid', immutableOnEdit: true, maxLength: FIELD_LIMITS.code, placeholder: '如 A-01' },
      { name: 'name', label: '名称', kind: 'text', emptyMeans: 'invalid', maxLength: FIELD_LIMITS.name, placeholder: '如 A 仓库' },
      {
        name: 'type',
        label: '类型',
        kind: 'select',
        emptyMeans: 'invalid',
        options: enumOptions(SITE_TYPES, SITE_TYPE_LABEL)
      },
      {
        name: 'nodeId',
        label: '绑定节点',
        kind: 'node',
        emptyMeans: 'null',
        help: '不绑定也能建，但地图上就没有可停靠的位置'
      },
      {
        name: 'x',
        label: '坐标 x (m)',
        kind: 'number',
        emptyMeans: 'omit',
        step: 'any',
        help: '留空则跟随绑定节点坐标；编辑时留空表示这次不改坐标'
      },
      { name: 'y', label: '坐标 y (m)', kind: 'number', emptyMeans: 'omit', step: 'any' },
      { name: 'remark', label: '备注', kind: 'text', emptyMeans: 'null', maxLength: FIELD_LIMITS.remark }
    ]
  },
  vehicles: {
    titleCreate: '新增车辆',
    titleEdit: '编辑车辆',
    fields: [
      { name: 'code', label: '编码', kind: 'text', emptyMeans: 'invalid', immutableOnEdit: true, maxLength: FIELD_LIMITS.code, placeholder: '如 AGV-04' },
      { name: 'name', label: '名称', kind: 'text', emptyMeans: 'invalid', maxLength: FIELD_LIMITS.name },
      { name: 'type', label: '类型', kind: 'select', emptyMeans: 'invalid', options: enumOptions(VEHICLE_TYPES, VEHICLE_TYPE_LABEL) },
      { name: 'capacityKg', label: '额定载重 (kg)', kind: 'number', emptyMeans: 'invalid', step: 'any' },
      { name: 'maxSpeedMps', label: '最高速度 (m/s)', kind: 'number', emptyMeans: 'invalid', step: 'any' },
      { name: 'x', label: '初始 x (m)', kind: 'number', emptyMeans: 'invalid', step: 'any' },
      { name: 'y', label: '初始 y (m)', kind: 'number', emptyMeans: 'invalid', step: 'any' },
      {
        name: 'battery',
        label: '电量 (%)',
        kind: 'number',
        emptyMeans: 'omit',
        // 缺省满电：与 `base-rules.ts` 的缺省值一致（规则只有一处，这里只是**显示**它）
        defaultValue: '100',
        step: 'any',
        help: '留空 = 按满电 100% 建车；上线后由心跳维护'
      },
      { name: 'remark', label: '备注', kind: 'text', emptyMeans: 'null', maxLength: FIELD_LIMITS.remark }
    ]
  },
  nodes: {
    titleCreate: '新增路网节点',
    titleEdit: '编辑路网节点',
    fields: [
      { name: 'code', label: '编码', kind: 'text', emptyMeans: 'invalid', immutableOnEdit: true, maxLength: FIELD_LIMITS.code, placeholder: '如 N13' },
      { name: 'name', label: '名称', kind: 'text', emptyMeans: 'invalid', maxLength: FIELD_LIMITS.name },
      { name: 'x', label: '坐标 x (m)', kind: 'number', emptyMeans: 'invalid', step: 'any' },
      { name: 'y', label: '坐标 y (m)', kind: 'number', emptyMeans: 'invalid', step: 'any' },
      { name: 'remark', label: '备注', kind: 'text', emptyMeans: 'null', maxLength: FIELD_LIMITS.remark }
    ]
  },
  edges: {
    titleCreate: '新增有向边',
    titleEdit: '编辑有向边',
    fields: [
      {
        name: 'fromNodeId',
        label: '起点节点',
        kind: 'node',
        emptyMeans: 'invalid'
      },
      { name: 'toNodeId', label: '终点节点', kind: 'node', emptyMeans: 'invalid' },
      {
        name: 'lengthM',
        label: '长度 (m)',
        kind: 'number',
        emptyMeans: 'omit',
        step: 'any',
        help: '留空则按两端节点坐标自动计算'
      },
      { name: 'speedLimitMps', label: '限速 (m/s)', kind: 'number', emptyMeans: 'omit', step: 'any', help: '留空表示不限速' },
      { name: 'remark', label: '备注', kind: 'text', emptyMeans: 'null', maxLength: FIELD_LIMITS.remark }
    ]
  },
  restrictions: {
    titleCreate: '新增禁行规则',
    titleEdit: '编辑禁行规则',
    fields: [
      {
        name: 'type',
        label: '目标类型',
        kind: 'select',
        emptyMeans: 'invalid',
        options: enumOptions(RESTRICTION_TYPES, RESTRICTION_TYPE_LABEL),
        help: '切换类型后，目标下拉里的可选项会跟着变'
      },
      {
        name: 'targetId',
        label: '目标',
        kind: 'target',
        dependsOn: 'type',
        emptyMeans: 'invalid',
        help: '规则绑定在具体的一处路网对象上；目标被删除后规则会显示「目标已不存在」'
      },
      {
        name: 'startAt',
        label: '开始时间',
        kind: 'text',
        emptyMeans: 'null',
        placeholder: '2026-09-27T08:00:00.000Z',
        help: '留空 = 立即生效；必须是 ISO 8601 时间（与字典序一致，见服务端说明）'
      },
      { name: 'endAt', label: '结束时间', kind: 'text', emptyMeans: 'null', placeholder: '2026-09-27T18:00:00.000Z', help: '留空 = 长期有效；须晚于开始时间' },
      {
        name: 'vehicleType',
        label: '适用车辆类型',
        kind: 'select',
        emptyMeans: 'null',
        options: enumOptions(VEHICLE_TYPES, VEHICLE_TYPE_LABEL),
        emptyLabel: '全部车辆类型',
        help: '不选 = 对全部车辆类型生效'
      },
      { name: 'reason', label: '原因', kind: 'text', emptyMeans: 'invalid', maxLength: FIELD_LIMITS.reason, placeholder: '如 道路施工' },
      {
        name: 'status',
        label: '状态',
        kind: 'select',
        emptyMeans: 'omit',
        defaultValue: 'active',
        options: enumOptions(RESTRICTION_STATUSES, RESTRICTION_STATUS_LABEL),
        help: '置为「已失效」后规则不再参与校验，但记录仍保留（可在列表中改回）'
      }
    ]
  },
  templates: {
    titleCreate: '新增任务模板',
    titleEdit: '编辑任务模板',
    fields: [
      { name: 'code', label: '编码', kind: 'text', emptyMeans: 'invalid', immutableOnEdit: true, maxLength: FIELD_LIMITS.code, placeholder: '如 TPL-STD' },
      { name: 'name', label: '名称', kind: 'text', emptyMeans: 'invalid', maxLength: FIELD_LIMITS.name },
      {
        name: 'priority',
        label: '默认优先级',
        kind: 'select',
        emptyMeans: 'invalid',
        options: enumOptions(TASK_PRIORITIES, TASK_PRIORITY_LABEL),
        defaultValue: 'normal'
      },
      { name: 'defaultCargoKg', label: '默认载重 (kg)', kind: 'number', emptyMeans: 'null', step: 'any', help: '留空 = 不预设，创建任务时自己填' },
      { name: 'timeWindowMinutes', label: '时间窗 (分钟)', kind: 'number', emptyMeans: 'null', step: '1', help: '留空 = 不预设时间窗长度' },
      {
        name: 'fromSiteType',
        label: '起点站点类型',
        kind: 'select',
        emptyMeans: 'null',
        options: enumOptions(SITE_TYPES, SITE_TYPE_LABEL),
        emptyLabel: '不限类型',
        help: '不选 = 不限类型'
      },
      {
        name: 'toSiteType',
        label: '终点站点类型',
        kind: 'select',
        emptyMeans: 'null',
        options: enumOptions(SITE_TYPES, SITE_TYPE_LABEL),
        emptyLabel: '不限类型',
        help: '不选 = 不限类型'
      },
      { name: 'remark', label: '备注', kind: 'text', emptyMeans: 'null', maxLength: FIELD_LIMITS.remark }
    ]
  }
};

/**
 * 多态引用（`kind: 'target'`）的**只读回显**。
 *
 * `targetId` 是内部 id，直接显示成一串 UUID 使用者认不出它指向哪里；
 * 而 `targetCode` 是派生出来的可读编码。编辑时下拉若只按 id 匹配，
 * 目标不在**当前**选项列表里（分页截断、目标已删）就会静默选中第一项 —— 见
 * `BaseDataPage` 的补选项逻辑。因此这里把「目标已不存在」单独表达出来。
 */
export function targetTextOf(row: BaseDataRow): { id: string; label: string; missing: boolean } {
  const record = row as unknown as { targetId?: string; targetCode?: string | null };
  return {
    id: record.targetId ?? '',
    label: record.targetCode ?? '目标已不存在',
    missing: !record.targetCode
  };
}

/**
 * 表单值 → 提交载荷（薄包装：字段清单取自 `FORM_SPECS`，机制在 `domain/form.ts`）。
 *
 * 保留具名的 `buildWritePayload(tabKey, …)` 而不是让页面直接调通用函数：
 * 「这张表有哪些字段」是本模块的事实，页面不该同时知道它和通用机制两件事。
 */
export function buildWritePayload(
  tabKey: BaseDataTabKey,
  values: FormValues,
  mode: 'create' | 'patch',
  original: FormValues = {}
): BuildResult {
  return buildFormPayload(FORM_SPECS[tabKey].fields, values, mode, original);
}

/** 新增时的初始值（薄包装，见 `domain/form.ts` 的 `emptyFormValuesOf`）。 */
export function emptyFormValues(tabKey: BaseDataTabKey): FormValues {
  return emptyFormValuesOf(FORM_SPECS[tabKey].fields);
}

/** 编辑时的初始值（薄包装）：当前行的字段原样填进表单。 */
export function formValuesOfRow(tabKey: BaseDataTabKey, row: BaseDataRow): FormValues {
  return formValuesOf(FORM_SPECS[tabKey].fields, row);
}

/**
 * 启停动作。
 *
 * 车辆域**没有** `enabled`：启用的目标状态是 `idle`（`docs/api.md` §3.2.2）。
 * 早先车辆页签曾跟着 sites 一起用 `enabled` 筛选（ISS-036），同一个坑不踩第二次 ——
 * 这里返回的 `next` 直接就是 `PATCH .../status` 的取值。
 */
export function statusActionOf(tabKey: BaseDataTabKey, status: string): { label: string; next: 'enabled' | 'disabled' | 'idle' } {
  if (status === 'disabled') {
    return tabKey === 'vehicles' ? { label: '启用', next: 'idle' } : { label: '启用', next: 'enabled' };
  }
  return { label: '停用', next: 'disabled' };
}

/** 该行的启停按钮是否要禁用：调度占用中的车不能停用（服务端会以 `VEHICLE.STATE_CONFLICT` 拒绝）。 */
export function statusBlockedReason(tabKey: BaseDataTabKey, row: BaseDataRow): string | null {
  if (tabKey !== 'vehicles') {
    return null;
  }
  const status = (row as VehicleListItem).status;
  if (status === 'busy' || status === 'reserved') {
    return `车辆${status === 'busy' ? '正在执行任务' : '已被调度预留'}，停用会被拒绝（先释放任务）`;
  }
  return null;
}

/** 节点下拉选项：站点绑定、边的两端都用它。`label` 里带 code，避免同名的两个节点分不清。 */
export function nodeOptionsOf(nodes: NodeListItem[]): Array<{ value: string; label: string }> {
  return nodes.map((node) => ({ value: node.id, label: `${node.code} · ${node.name}` }));
}

export function rowTitleOf(row: BaseDataRow): string {
  const record = row as { code?: string; name?: string };
  return record.name ? `${record.code ?? ''} ${record.name}`.trim() : (record.code ?? '');
}

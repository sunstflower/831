/**
 * 任务页（M3）的**表单定义**：新建 / 编辑任务时有哪些字段、怎么取值、提交什么载荷。
 *
 * 通用机制（`FormField` / `emptyMeans` / 「编辑只发改过的字段」）见 `domain/form.ts`；
 * 服务端规则的唯一作者是 `shared/src/task-rules.ts`，本文件只镜像它的字段名与上限，
 * **不复述**它的判断逻辑（必填、长度、跨字段都由那份规则说了算）。
 *
 * ## 两处本模块特有的东西
 *
 * 1. **时间用 `datetime-local` 而不是让人手敲 ISO 字符串**：契约要的是 ISO 8601 瞬时，
 *    而手敲 `2026-09-27T08:00:00.000Z` 少一个 `Z`、写成空格分隔都会被拒；
 *    输入框给的是本地时间 `2026-09-27T08:00`，转换只发生在提交与回填两处。
 * 2. **跨字段预校验**：起终点不能相同、时间窗必须成对出现。这两条服务端也会判
 *    （`taskWindowError` / `taskEndpointError`），这里提前一步只是为了**立刻**给出反馈
 *    —— 判定口径与那对纯函数一致（同样的「成对」与「严格大于」）。
 */
import {
  TASK_CARGO_DESC_MAX_LENGTH,
  TASK_MAX_CARGO_KG,
  TASK_PRIORITIES,
  TASK_TITLE_MAX_LENGTH,
  type TaskDetail,
  type TaskListItem,
  type TaskTemplateListItem
} from '@udm/shared';
import { TASK_PRIORITY_LABEL, labelOf } from '../domain/labels';
import {
  buildFormPayload,
  emptyFormValuesOf,
  formValuesOf,
  type BuildResult,
  type FormField,
  type FormSpec,
  type FormValues
} from '../domain/form';

/** 优先级下拉的候选项。 */
const PRIORITY_OPTIONS = TASK_PRIORITIES.map((priority) => ({
  value: priority as string,
  label: labelOf(TASK_PRIORITY_LABEL, priority)
}));

/** 起终点站点的提交字段名（跨字段预校验要按名字取，故提成常量免得两处写错）。 */
const FROM_SITE = 'fromSiteId';
const TO_SITE = 'toSiteId';
const WINDOW_START = 'timeWindowStart';
const WINDOW_END = 'timeWindowEnd';

export const TASK_FORM: FormSpec = {
  titleCreate: '新建任务',
  titleEdit: '编辑任务',
  fields: [
    {
      name: 'title',
      label: '标题',
      kind: 'text',
      emptyMeans: 'invalid',
      maxLength: TASK_TITLE_MAX_LENGTH,
      placeholder: '如 A 仓经 B 仓转运到 C 仓'
    },
    {
      name: 'templateId',
      label: '套用模板',
      kind: 'select',
      emptyMeans: 'omit',
      // 模板只在创建时生效：它提供的是**默认值**，事后改它不会改动已填的字段，
      // 只会让「这条任务按哪个模板建的」变成一个可以随时被抹掉的事实
      immutableOnEdit: true,
      lockedLabel: '创建时指定',
      emptyLabel: '不使用模板',
      options: [],
      help: '选择模板后，优先级 / 载重 / 时间窗的缺省值由模板提供（已填的字段不会被覆盖）'
    },
    {
      name: 'priority',
      label: '优先级',
      kind: 'select',
      emptyMeans: 'omit',
      defaultValue: 'normal',
      options: PRIORITY_OPTIONS,
      help: '缺省为「普通」；调度算法按优先级加权排序'
    },
    {
      name: 'cargoKg',
      label: '载重 (kg)',
      kind: 'number',
      emptyMeans: 'invalid',
      step: 'any',
      help: `0 ~ ${TASK_MAX_CARGO_KG}；超过这个量级应当拆单（单辆车拉不动）`
    },
    {
      name: 'cargoDesc',
      label: '货物描述',
      kind: 'text',
      emptyMeans: 'null',
      maxLength: TASK_CARGO_DESC_MAX_LENGTH,
      placeholder: '如 冷藏托盘 ×2'
    },
    {
      name: FROM_SITE,
      label: '起点站点',
      kind: 'site',
      emptyMeans: 'invalid',
      emptyLabel: '（请选择起点站点）'
    },
    {
      name: TO_SITE,
      label: '终点站点',
      kind: 'site',
      emptyMeans: 'invalid',
      emptyLabel: '（请选择终点站点）'
    },
    {
      name: WINDOW_START,
      label: '时间窗开始',
      kind: 'datetime',
      emptyMeans: 'null',
      help: '留空 = 不限时间窗；填了就必须同时填结束时间'
    },
    { name: WINDOW_END, label: '时间窗结束', kind: 'datetime', emptyMeans: 'null' }
  ]
};

/** 站点下拉的候选项（`label` 里带编码，避免同名站点分不清）。 */
export function siteOptionsOf(sites: Array<{ id: string; code: string; name: string }>): Array<{ value: string; label: string }> {
  return sites.map((site) => ({ value: site.id, label: `${site.code} · ${site.name}` }));
}

/** 模板下拉的候选项（把模板的关键缺省值写在文案里，省得使用者逐个点开看）。 */
export function templateOptionsOf(templates: TaskTemplateListItem[]): Array<{ value: string; label: string }> {
  return templates.map((template) => {
    const hints: string[] = [template.code];
    if (template.defaultCargoKg !== null) {
      hints.push(`${template.defaultCargoKg} kg`);
    }
    if (template.timeWindowMinutes !== null) {
      hints.push(`时间窗 ${template.timeWindowMinutes} 分钟`);
    }
    return { value: template.id, label: `${hints.join(' · ')}` };
  });
}

/** 新建表单的初始值。 */
export function emptyTaskForm(): FormValues {
  return emptyFormValuesOf(TASK_FORM.fields);
}

/**
 * ISO 8601 → `datetime-local` 输入框的取值（本地时区）。
 *
 * 不做时区转换会显示成 UTC 时间：使用者看到 08:00、实际是 16:00（东八区），
 * 而提交时又把 08:00 当本地时间发回去 —— 时间窗整体平移 8 小时，且不报错。
 */
export function toLocalInputValue(iso: string | null): string {
  if (!iso) {
    return '';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** `datetime-local` 的取值 → ISO 8601；无法解析时返回 `null`（由调用点报「时间格式不正确」）。 */
export function toIsoValue(local: string): string | null {
  const parsed = Date.parse(local);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

/** 编辑表单的初始值：行里的字段原样填进表单，两个时间先转成本地时间。 */
export function taskFormValuesOf(row: TaskListItem | TaskDetail): FormValues {
  const values = formValuesOf(TASK_FORM.fields, row);
  values[WINDOW_START] = toLocalInputValue(row.timeWindowStart);
  values[WINDOW_END] = toLocalInputValue(row.timeWindowEnd);
  return values;
}

/**
 * 表单值 → 提交载荷（`create` 或不含状态字段的 `patch`）。
 *
 * 顺序：**跨字段预校验** → 通用载荷构造（含时间转换）。
 * 先做跨字段判断，是因为通用构造会先丢掉「没改过的字段」：
 * 只想清空结束时间时，`timeWindowEnd` 会被正确地当作一次修改发出去，
 * 但若先丢字段再校验，就看不到它与开始时间是否成对。
 */
export function buildTaskPayload(
  values: FormValues,
  mode: 'create' | 'patch',
  original: FormValues = {}
): BuildResult {
  const errors: Record<string, string> = {};
  const from = (values[FROM_SITE] ?? '').trim();
  const to = (values[TO_SITE] ?? '').trim();
  if (from && to && from === to) {
    errors[TO_SITE] = '起点与终点不能是同一个站点';
  }
  const start = (values[WINDOW_START] ?? '').trim();
  const end = (values[WINDOW_END] ?? '').trim();
  if ((start === '') !== (end === '')) {
    // 报在**空的那一个**上：错误信息要指向还没填的框，而不是已经填好的那个
    errors[start === '' ? WINDOW_START : WINDOW_END] = '时间窗必须同时给出开始与结束（或都不给）';
  }
  if (Object.keys(errors).length > 0) {
    return { ok: false, fields: errors };
  }
  return buildFormPayload(TASK_FORM.fields, values, mode, original, (field, raw) => {
    if (field.kind !== 'datetime') {
      // 「这个字段不需要特殊处理」：返回 undefined 让通用实现走默认路径（数字仍转成数字）
      return undefined;
    }
    const iso = toIsoValue(raw);
    return iso === null ? { error: '时间格式不正确' } : { value: iso };
  });
}

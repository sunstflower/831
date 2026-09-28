/**
 * **写表单模型**（各模块的编辑弹层共用，原先只有 `base/form.ts` 一份）。
 *
 * 与各模块 `model.ts` 的分工：`model.ts` 管**读**（列怎么显示、筛选怎么拼），
 * 本文件管**写**（有哪些可编辑字段、空值是什么意思、提交什么载荷）。
 * 两者都是纯函数 + 常量，可脱离组件单测；组件只负责排版与事件接线。
 *
 * ## 空值的三种含义（`emptyMeans`）—— 这是本文件最要紧的一件事
 *
 * 一个空输入框在语义上可能是完全不同的三件事，混作一谈就会出现「以为清空了、其实没改」：
 *   - `omit`：不发送该字段。创建时表示「用缺省」（如站点坐标跟随绑定节点、
 *     车辆电量缺省 100%），编辑时表示「这次没动它」；
 *   - `null`：发送 `null`，把可空列真的清空（备注、站点绑定节点）；
 *   - `invalid`：不可为空，客户端直接报「必填」。
 *
 * 因此**编辑时只提交真正改过的字段**（见 `buildFormPayload`）：这不只是省流量 ——
 * 站点的坐标在「只改了绑定节点」时要跟随新节点（`desktop/src/domain/base/site.service.ts`
 * 的 `resolveXY`），若每次编辑都把 `x`/`y` 原样带上，那个跟随逻辑永远不会触发，
 * 站点会留在旧节点的坐标上而界面看起来一切正常。
 *
 * **边界**：客户端校验只做「必填 / 是不是数字」这类**能立刻给出反馈**的判断；
 * 长度上限、数值域、枚举成员、唯一性与跨表引用一律以服务端为准
 * （规则唯一作者是 `shared/src/base-rules.ts` 与 `shared/src/task-rules.ts`，
 * 失败回来的 `detail.fields` 由页面直接标回对应输入框）。客户端**不会**比服务端更宽松 ——
 * 放宽会让使用者在界面上畅通无阻、到主进程才被拒。
 *
 * **为什么抽出来**：M3 任务表单与 M2 四张表的表单逐条同构（同样的三种空值、同样的
 * 「编辑只发改过的字段」）。抄一份的后果是「补丁只在一边生效」——例如只有一处的
 * `null` 能被真的清空，另一处的空输入框会静默变成「没改」。
 */

/** 表单里的一切都是字符串（输入框的原生形态）；类型转换只在 `buildWritePayload` 一处发生。 */
export type FormValues = Record<string, string>;

export interface FormField {
  /** 提交载荷里的字段名（与 `shared/src/base-rules.ts` 读的名字必须一字不差）。 */
  name: string;
  label: string;
  /**
   * 控件形态。
   *
   * `target` 是禁行规则专有的**多态引用选择器**：可选项取决于同一个表单里
   * 另一个字段的当前值（`type` = node 时列节点、edge 时列边）。
   * 不做成两个字段（`targetNodeId` / `targetEdgeId`）是因为契约只有一个 `targetId`，
   * 两个字段要么二选一、要么就得在提交前合并 —— 那正是「界面结构泄漏到契约」的形态。
   *
   * `datetime` 是**带时区的本地时间输入**（`<input type="datetime-local">`）：
   * 值仍是 ISO 8601 字符串（契约不变），转换只发生在提交/回填两处（见 `task/form.ts`）。
   * 为什么要它：让使用者手敲 `2026-09-27T08:00:00.000Z` 既不直观也必然出错
   * （少一个 `Z`、写成空格分隔都会被服务端拒掉，而错误提示只会说「必须是 ISO 时间」）。
   */
  kind: 'text' | 'number' | 'select' | 'node' | 'site' | 'vehicle' | 'edge' | 'target' | 'datetime';
  /** `kind: 'target'` 时决定可选项的**同表单字段名**（如 `type`）。 */
  dependsOn?: string;
  /** 空输入框的含义，见文件头。 */
  emptyMeans: 'omit' | 'null' | 'invalid';
  /** 编辑时只读（编码不可改，`base-rules.ts` 的 `assertCodeImmutable`）。 */
  immutableOnEdit?: boolean;
  /**
   * 只读时显示的角标文案（默认「创建后不可改」）。
   *
   * 为什么可配：改成只读的原因不止一种 —— 编码是「创建后不可改」，
   * 任务模板是「只在创建时生效」。同一句话套在所有字段上会误导
   * （「模板创建后不可改」听起来像模板本身不能编辑，其实说的是这条任务不再套用它）。
   */
  lockedLabel?: string;
  options?: Array<{ value: string; label: string }>;
  placeholder?: string;
  help?: string;
  maxLength?: number;
  /** 数字输入的步进（`any` 表示允许小数）。 */
  step?: string;
  /**
   * `emptyMeans: 'null'` 的**下拉框**里那一项「不选」的文案。
   *
   * 没有它就无法表达「不限」：`<select>` 的取值必须落在选项里，于是「留空」
   * 只会退回第一项 —— 界面上看起来正常，提交上去的却是一个具体的类型
   * （实测：禁行规则的「适用车辆类型」空着建出来是 `agv`，而不是「全部车辆」）。
   * 默认文案「（不限）」只用于兜底，各字段应写清它到底不限的是什么。
   */
  emptyLabel?: string;
  /**
   * 新增时的初始值。缺席时用「第一个选项」或空串。
   *
   * 为什么需要它：任务模板的优先级默认是 `normal`，而 `TASK_PRIORITIES` 的首项是 `low`
   * —— 靠「取第一项」会让新建的模板默认变成「低优先级」，而且**不报错**。
   * 默认值必须显式写出来，才和 DDL 的 `DEFAULT 'normal'` 对得上。
   */
  defaultValue?: string;
}

export interface FormSpec {
  fields: FormField[];
  /** 弹层标题：`{ name }` 会被替换成当前行的名称或编码。 */
  titleCreate: string;
  titleEdit: string;
}

/** 只读展示：数字列在表单里是字符串，`null` 显示为空输入框。 */
function numberText(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value);
}

/**
 * 新增时的初始值（枚举给出首项，避免出现「空的下拉框」这种无法提交的初始态）。
 *
 * 规则顺序即优先级：显式 `defaultValue` → 可空下拉的空串（那一项「不限」）→ 首个选项 → 空串。
 * `defaultValue` 必须显式写出来才和 DDL 的 `DEFAULT` 对得上：任务模板的优先级默认
 * `normal`，而 `TASK_PRIORITIES` 的首项是 `low`，靠「取第一项」会让新建的模板
 * 悄悄变成「低优先级」且不报错。
 */
export function emptyFormValuesOf(fields: FormField[]): FormValues {
  const values: FormValues = {};
  for (const field of fields) {
    if (field.defaultValue !== undefined) {
      values[field.name] = field.defaultValue;
      continue;
    }
    // 可空的下拉框**初始为空**，对应那一项「不限」：取首项会让「不选」这件事
    // 在界面上不可能发生（见 `emptyLabel` 的说明）
    if (field.kind === 'select' && field.emptyMeans === 'null') {
      values[field.name] = '';
      continue;
    }
    if (field.kind === 'select' && field.options && field.options.length > 0) {
      values[field.name] = field.options[0]!.value;
      continue;
    }
    values[field.name] = '';
  }
  return values;
}

/** 编辑时的初始值：当前行的字段原样填进表单。 */
export function formValuesOf(fields: FormField[], row: unknown): FormValues {
  const values: FormValues = {};
  const record = row as Record<string, unknown>;
  for (const field of fields) {
    const raw = record[field.name];
    if (raw === null || raw === undefined) {
      values[field.name] = '';
    } else if (typeof raw === 'number') {
      values[field.name] = numberText(raw);
    } else {
      values[field.name] = String(raw);
    }
  }
  return values;
}

export type BuildResult = { ok: true; payload: Record<string, unknown> } | { ok: false; fields: Record<string, string> };

/**
 * 表单值 → 提交载荷。
 *
 * `mode === 'patch'` 时**只保留与 `original` 不同的字段**：载荷里出现一个字段，
 * 就等于告诉服务端「这次就是要把它改成这个值」—— 把没动过的字段一起带上，
 * 既会让服务端做无谓的写入，也会压掉「改绑定节点时坐标跟随节点」这类派生逻辑。
 *
 * `transform` 用于**少数需要改写入参形态**的字段（目前只有 `datetime-local`
 * → ISO：输入框给的是 `2026-09-27T08:00`，契约要的是 ISO 8601 瞬时）。
 * 之所以做成一个可选回调而不是在本函数里判断 `kind`，是因为「ISO 用哪个时区解释」
 * 属于**页面/契约层面**的判断，不该由通用表单模型替使用者决定。
 *
 * ⚠️ `transform` 返回 `undefined` 表示「这个字段不需要特殊处理」，交给默认路径
 * （数字转数字、其余原样）。**不能让调用点对无关字段也返回一个值** ——
 * 实测（2026-09-26）：任务表单的回调对非时间字段返回了 `{ value: raw }`，
 * 于是载重 `"120"` 被当成字符串发出去，服务端按数字规则读不到它。
 */
export function buildFormPayload(
  fields: FormField[],
  values: FormValues,
  mode: 'create' | 'patch',
  original: FormValues = {},
  transform?: (field: FormField, raw: string) => { value: unknown } | { error: string } | undefined
): BuildResult {
  const errors: Record<string, string> = {};
  const payload: Record<string, unknown> = {};

  for (const field of fields) {
    // 编辑时编码不可改：连「原样发回去」都不发，否则服务端会以「编码创建后不可修改」拒绝
    if (mode === 'patch' && field.immutableOnEdit) {
      continue;
    }
    const raw = (values[field.name] ?? '').trim();
    const before = (original[field.name] ?? '').trim();
    if (mode === 'patch' && raw === before) {
      continue;
    }
    if (raw === '') {
      if (field.emptyMeans === 'null') {
        payload[field.name] = null;
        continue;
      }
      if (field.emptyMeans === 'omit') {
        // 创建时交给服务端取缺省；编辑时等价于「没改」，两种模式都是什么都不发
        continue;
      }
      errors[field.name] = '必填';
      continue;
    }
    const converted = transform ? transform(field, raw) : undefined;
    if (converted && 'error' in converted) {
      errors[field.name] = converted.error;
      continue;
    }
    if (converted) {
      payload[field.name] = converted.value;
      continue;
    }
    if (field.kind === 'number') {
      const numeric = Number(raw);
      if (!Number.isFinite(numeric)) {
        errors[field.name] = '必须是数字';
        continue;
      }
      payload[field.name] = numeric;
      continue;
    }
    payload[field.name] = raw;
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, fields: errors };
  }
  return { ok: true, payload };
}

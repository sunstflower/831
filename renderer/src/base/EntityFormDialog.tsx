/**
 * 基础数据的**新增 / 编辑弹层**。
 *
 * 为什么是弹层而不是独立页面：站点、车辆、节点、边四张表的表单都只有 4-8 个字段，
 * 跳走一页再回来会丢掉当前页签、搜索词与页码 —— 使用者改完一条「备注」却回到第 1 页，
 * 这种打断在数据维护里每天要发生几十次。
 *
 * 无障碍取舍（写在实现旁边，免得下次有人以为漏了）：
 *   - `role="dialog"` + `aria-modal` + `aria-labelledby` 指向标题；
 *   - 打开时把焦点移到第一个输入框，`Esc` 关闭，点遮罩关闭；
 *   - **不做**完整的焦点陷阱（Tab 仍可能跑到页面上的其它控件）；这一步需要
 *     `<dialog>` 原生元素或焦点循环实现，属于后续增强，不假装已经做到。
 */
import { useEffect, useId, useRef } from 'react';
import { IconAlert, IconClose } from '../components/icons';
import type { FormField, FormValues } from '../domain/form';

export interface EntityFormDialogProps {
  title: string;
  fields: FormField[];
  values: FormValues;
  /** 字段级错误：服务端 `detail.fields` 与客户端预校验共用同一个形状（键 = 字段名）。 */
  errors: Record<string, string>;
  /** 整表级错误（如 `BASE.CODE_EXISTS`）：没有对应字段可标红时的兜底展示。 */
  formError: string | null;
  busy: boolean;
  submitLabel: string;
  /** 编辑态：编码等不可改字段显示为只读。 */
  editing: boolean;
  /**
   * 候选清单，按 `field.kind` 取。
   *
   * 为什么是「按 kind 的映射」而不是 `nodeOptions` / `siteOptions` / … 一个个具名 prop：
   * 每加一种引用型字段（M2 是节点，M3 是站点）就要多加一个 prop 并改一次调用点，
   * 而弹层本身只关心「这个 kind 有没有候选」。`target` 是唯一的例外 ——
   * 它的候选按**同表单另一个字段的当前值**分组（见 `targetOptions`）。
   */
  candidates: Partial<Record<'node' | 'site' | 'vehicle' | 'edge', Array<{ value: string; label: string }>>>;
  /**
   * 多态引用（`kind: 'target'`）的两组候选：节点与边各一组。
   *
   * 为什么由页面传进来而不是弹层自己拉：候选清单与页面上的其它数据同源
   * （节点下拉、边选项都从 `BaseDataPage` 一次性拉取），弹层各拉一次会让
   * 「同一个下拉里出现两份来源」成为可能。弹层只负责按当前 `type` 选哪一组。
   */
  targetOptions: { node: Array<{ value: string; label: string }>; edge: Array<{ value: string; label: string }> };
  onChange: (name: string, value: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}

/** 渲染成 `<select>` 的 kind；其余（`text` / `number` / `datetime`）渲染成 `<input>`。 */
const CHOOSER_KINDS = ['select', 'node', 'site', 'vehicle', 'edge', 'target'] as const;

function isChooser(kind: FormField['kind']): boolean {
  return (CHOOSER_KINDS as readonly string[]).includes(kind);
}

/** 从调用点给的分组里取候选的那几种 kind（其余返回 `null`）。 */
function candidateKind(kind: FormField['kind']): 'node' | 'site' | 'vehicle' | 'edge' | null {
  return kind === 'node' || kind === 'site' || kind === 'vehicle' || kind === 'edge' ? kind : null;
}

/** `<input>` 的 `type`：数字与本地时间各有原生控件，其余是纯文本。 */
function inputTypeOf(kind: FormField['kind']): 'number' | 'datetime-local' | 'text' {
  if (kind === 'number') {
    return 'number';
  }
  if (kind === 'datetime') {
    return 'datetime-local';
  }
  return 'text';
}

export function EntityFormDialog(props: EntityFormDialogProps) {
  const { title, fields, values, errors, formError, busy, submitLabel, editing, candidates, targetOptions, onChange, onSubmit, onClose } = props;
  const titleId = useId();
  const firstFieldRef = useRef<HTMLInputElement | HTMLSelectElement | null>(null);

  // 打开即聚焦第一个可编辑字段：否则键盘使用者要先 Tab 穿整个页面才能进到表单里
  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busy) {
        onClose();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [busy, onClose]);

  /**
   * 按 `kind` 取该字段的候选清单。
   *
   * `select` 用字段自带的 `options`；引用型（`node` / `site` / `vehicle` / `edge`）
   * 从调用点给的分组里取；`target` 是唯一**依赖同表单另一个字段当前值**的一种，
   * 因此写在这里而不是抽成纯函数（它要读闭包里的 `values`）。
   */
  function optionsOf(field: FormField) {
    if (field.kind === 'target') {
      // 可选项取决于同表单里 `dependsOn` 指向的那个字段的**当前输入值**
      // （禁行规则里是 `type`：选「路网节点」列节点、选「有向边」列边）。
      // 用当前值而不是初始值：切换类型后下拉必须立刻跟着变，否则会提交一个
      // 「类型是 node、目标是某条边的 id」的组合 —— 服务端只能报「目标不存在」
      return (values[field.dependsOn ?? ''] ?? '') === 'edge' ? targetOptions.edge : targetOptions.node;
    }
    if (field.kind === 'select') {
      return field.options ?? [];
    }
    const kind = candidateKind(field.kind);
    return kind ? (candidates[kind] ?? []) : [];
  }

  /** 选中项不在候选里时补一个占位项（否则浏览器会静默选中第一项，见 `BaseDataPage` 的补选项说明）。 */
  function withCurrent(field: FormField, options: Array<{ value: string; label: string }>): Array<{ value: string; label: string }> {
    const current = values[field.name] ?? '';
    if (current === '' || options.some((option) => option.value === current)) {
      return options;
    }
    return [{ value: current, label: '（当前值不在候选列表中）' }, ...options];
  }

  function renderField(field: FormField) {
    const value = values[field.name] ?? '';
    const error = errors[field.name];
    const locked = editing && field.immutableOnEdit === true;
    const required = field.emptyMeans === 'invalid';
    const inputId = `${titleId}-${field.name}`;
    const errorId = `${inputId}-err`;
    const helpId = `${inputId}-help`;
    // 描述串里同时挂上帮助文字与错误：读屏器在输入框上停留时就能听到「这个框该怎么填」与「错在哪」
    const describedBy = [field.help ? helpId : null, error ? errorId : null].filter(Boolean).join(' ');
    const common = {
      id: inputId,
      required,
      'aria-required': required || undefined,
      'aria-invalid': error ? true : undefined,
      'aria-describedby': describedBy || undefined,
      disabled: busy || locked,
      onChange: (event: { target: { value: string } }) => onChange(field.name, event.target.value)
    };

    return (
      <div className="udm-field udm-form__field" key={field.name}>
        <div className="udm-form__label">
          {/* 角标放在 <label> **外面**：标签的可访问名与 `getByLabelText` 读到的都只有字段名本身 */}
          <label htmlFor={inputId}>{field.label}</label>
          {required ? <em className="udm-form__required">必填</em> : null}
          {locked ? <em className="udm-form__locked">{field.lockedLabel ?? '创建后不可改'}</em> : null}
        </div>
        {isChooser(field.kind) ? (
          <select
            {...common}
            value={value}
            ref={field === fields[0] ? (node) => { firstFieldRef.current = node; } : undefined}
            className={error ? 'is-invalid' : undefined}
          >
            {field.kind === 'node' && field.emptyMeans !== 'invalid' ? (
              <option value="">{field.emptyLabel ?? '（不绑定）'}</option>
            ) : null}
            {/*
              其它候选型字段（站点 / 车辆 / 边）始终给一个占位项：`<select>` 的取值必须落在
              选项里，缺了占位项时「留空」会显示成第一个候选项（而提交上去的是空串），
              界面看起来正常 —— 这正是 `ISS-058` 指出的那一族问题
            */}
            {field.kind === 'site' || field.kind === 'vehicle' || field.kind === 'edge' ? (
              <option value="">{field.emptyLabel ?? '（请选择）'}</option>
            ) : null}
            {/* 可空的下拉框必须有一个「不选」项：没有它，「留空」会退回第一项，
                使用者以为自己没限定类型、实际提交了一个具体类型（见 `FormField.emptyLabel`） */}
            {field.kind === 'select' && field.emptyMeans === 'null' ? (
              <option value="">{field.emptyLabel ?? '（不限）'}</option>
            ) : null}
            {/* 目标选择器**始终**有占位项：不给占位项时浏览器会自动选中第一项，
                于是「忘了选目标」会变成「规则绑到了第一个节点上」，且不会报错 */}
            {field.kind === 'target' ? <option value="">（请选择目标）</option> : null}
            {withCurrent(field, optionsOf(field)).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            {...common}
            type={inputTypeOf(field.kind)}
            step={field.step}
            maxLength={field.maxLength}
            placeholder={field.placeholder}
            value={value}
            ref={field === fields[0] ? (node) => { firstFieldRef.current = node; } : undefined}
            className={error ? 'is-invalid' : undefined}
          />
        )}
        {field.help ? <small className="udm-form__help" id={helpId}>{field.help}</small> : null}
        {error ? (
          <small className="udm-form__error" id={errorId} role="alert">
            {error}
          </small>
        ) : null}
      </div>
    );
  }

  return (
    <div className="udm-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div className="udm-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="udm-dialog__head">
          <h2 className="udm-dialog__title" id={titleId}>
            {title}
          </h2>
          <button type="button" className="udm-icon-btn" onClick={onClose} disabled={busy} aria-label="关闭">
            <IconClose size={14} />
          </button>
        </header>

        <form
          className="udm-dialog__body"
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy) {
              onSubmit();
            }
          }}
        >
          {formError ? (
            <div className="udm-alert" role="alert">
              <IconAlert size={16} />
              <span>{formError}</span>
            </div>
          ) : null}
          {fields.map(renderField)}
        </form>

        <footer className="udm-dialog__foot">
          <button type="button" className="udm-btn udm-btn--ghost" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button type="button" className="udm-btn udm-btn--primary" onClick={onSubmit} disabled={busy}>
            {busy ? '提交中…' : submitLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}

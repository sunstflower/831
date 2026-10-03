/**
 * 任务的**状态操作确认层**（M3，Req-M3-5 的「高风险操作二次确认」）。
 *
 * 一个弹层同时承担三种情况，因此这里必须说清它们的分界：
 *   - **必须写原因**（暂停 / 取消 / 重派 / 重新入池）：原因输入框是**必填**的，
 *     提交按钮在填之前一直禁用 —— 不禁用就会出现「点了提交、服务端回一句
 *     『必须提供原因』」，那本可以在界面上避免；
 *   - **只是确认**（物理删除）：没有原因可写，只有一段副作用说明；
 *   - 其余动作（提交 / 继续）不经过本弹层（`needsConfirm` 为假）。
 *
 * 副作用说明来自 `task/actions.ts` 的 `note`（唯一作者），本组件不自己编文案：
 * 「取消会回收车辆」这句话必须与真实副作用同源，否则界面上的承诺会与库里的结果不一致。
 */
import { useEffect, useId, useRef } from 'react';
import { IconAlert } from '../components/icons';

/**
 * 确认层**实际用到**的动作字段（结构类型，不绑定具体动作族）。
 *
 * 为什么不用 `TaskActionDef`：执行动作（M7 的开始执行 / 手动接管，见 `task/execution.ts`）
 * 走的是另一组接口与权限点，但「确认层需要知道的」与任务动作完全一样
 * （文案、副作用说明、是否必填原因）。绑死一个类型就得为同一套弹层写第二份，
 * 而两份文案迟早分叉（D-34）。
 */
export interface TaskActionDialogDef {
  label: string;
  /**
   * 确认按钮的样式：危险动作（取消、重派、接管）用红色，其余用主色。
   * 与任务动作的 `TaskActionDef.style` 同义 —— 这里列出来是为了让弹层不依赖某个动作族。
   */
  style: 'ghost' | 'danger';
  /** 副作用说明（唯一作者是各动作模块）。 */
  note: string;
  /** 是否必须填写原因。 */
  reasonRequired: boolean;
}

export interface TaskActionDialogProps {
  def: TaskActionDialogDef;
  /** 被操作任务的标题（`编码 · 标题`），让使用者确认自己点的是哪一条。 */
  taskLabel: string;
  reason: string;
  busy: boolean;
  /** 服务端回来的整表级失败（如 `TASK.STATE_CONFLICT`）。 */
  error: string | null;
  onReasonChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function TaskActionDialog(props: TaskActionDialogProps) {
  const { def, taskLabel, reason, busy, error, onReasonChange, onConfirm, onCancel } = props;
  const titleId = useId();
  const reasonRef = useRef<HTMLTextAreaElement | null>(null);

  // 需要写原因时把焦点直接放到原因框：使用者的唯一动作就是填它
  useEffect(() => {
    if (def.reasonRequired) {
      reasonRef.current?.focus();
    }
  }, [def.reasonRequired]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busy) {
        onCancel();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [busy, onCancel]);

  const blocked = def.reasonRequired && reason.trim() === '';

  return (
    <div className="udm-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
      <div className="udm-dialog udm-dialog--confirm" role="alertdialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="udm-dialog__head">
          <h2 className="udm-dialog__title" id={titleId}>
            确认{def.label}
          </h2>
        </header>
        <div className="udm-dialog__body udm-dialog__body--single">
          <p className="udm-task__confirm-task">
            任务：<strong>{taskLabel}</strong>
          </p>
          <p>{def.note}</p>
          {def.reasonRequired ? (
            <div className="udm-field udm-form__field udm-form__field--wide">
              <div className="udm-form__label">
                <label htmlFor={`${titleId}-reason`}>原因</label>
                <em className="udm-form__required">必填</em>
              </div>
              <textarea
                id={`${titleId}-reason`}
                ref={reasonRef}
                rows={3}
                maxLength={200}
                value={reason}
                disabled={busy}
                placeholder="如 现场临时停电，等待恢复"
                onChange={(event) => onReasonChange(event.target.value)}
              />
              <small className="udm-form__help">原因会写进任务与审计日志，是事后复盘时唯一的线索</small>
            </div>
          ) : null}
          {error ? (
            <div className="udm-alert" role="alert">
              <IconAlert size={16} />
              <span>{error}</span>
            </div>
          ) : null}
        </div>
        <footer className="udm-dialog__foot">
          <button type="button" className="udm-btn udm-btn--ghost" onClick={onCancel} disabled={busy}>
            取消
          </button>
          <button
            type="button"
            className={def.style === 'danger' ? 'udm-btn udm-btn--danger' : 'udm-btn udm-btn--primary'}
            onClick={onConfirm}
            disabled={busy || blocked}
            title={blocked ? '请先填写原因' : undefined}
          >
            {busy ? '处理中…' : `确认${def.label}`}
          </button>
        </footer>
      </div>
    </div>
  );
}

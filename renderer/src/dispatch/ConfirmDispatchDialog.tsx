/**
 * 应用派发的**二次确认**（`docs/api.md` §3.4.3：生效动作需要确认后再落库）。
 *
 * ## 为什么必须有这一步，而不是「点一下直接应用」
 *
 * 预览里的方案一旦应用就写进 `dispatch_plans` / `routes` 并把车辆置为 `reserved`，
 * 之后只能通过「重算」或「取消」回退 —— 而在那之前，使用者可能有几十秒没有再看这一屏。
 * 因此确认框的内容不是「确定吗？」，而是**那份预览的具体内容**：
 * 逐条列出「任务 → 车辆」、预计完成时刻，以及**哪些单没派出去**。
 * 最后一条尤其重要：应用派发不会管被拒的任务，使用者若只看「已派发 N 单」，
 * 很容易以为整批都派完了。
 *
 * 无障碍取舍（与 `EntityFormDialog` 同口径，写在这里免得下次以为漏了）：
 * `role="alertdialog"` + `aria-modal` + `aria-labelledby`、`Esc` 关闭、点遮罩关闭、
 * 打开时把焦点移到「确认」按钮；**不做**完整焦点陷阱。
 */
import { useEffect, useId, useRef } from 'react';

export interface ConfirmDispatchDialogProps {
  title: string;
  /** 逐条派发清单（已由 `model.ts` 的 `confirmLinesOf` 拼好人读的一行）。 */
  lines: string[];
  /** 本次**不会**被派发的任务（被拒的那些）—— 单独列出来，避免「以为全派了」。 */
  rejectLines: string[];
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDispatchDialog({ title, lines, rejectLines, busy, onConfirm, onCancel }: ConfirmDispatchDialogProps) {
  const titleId = useId();
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  return (
    <div
      className="udm-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) {
          onCancel();
        }
      }}
    >
      <div className="udm-dialog udm-dialog--confirm" role="alertdialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="udm-dialog__head">
          <h2 className="udm-dialog__title" id={titleId}>
            {title}
          </h2>
        </header>
        <div className="udm-dialog__body udm-dialog__body--single">
          <p className="udm-dispatch__hint">确认后立即落库：任务变为「已派发」、车辆被预留，并生成路线与调度日志。</p>
          <ul className="udm-dispatch__confirm-list">
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {rejectLines.length > 0 ? (
            <>
              <p className="udm-dispatch__confirm-sub">本次不派发（约束不满足）：</p>
              <ul className="udm-dispatch__confirm-list">
                {rejectLines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
        <footer className="udm-dialog__foot">
          <button type="button" className="udm-btn" onClick={onCancel} disabled={busy}>
            取消
          </button>
          <button ref={confirmRef} type="button" className="udm-btn udm-btn--primary" onClick={onConfirm} disabled={busy}>
            {busy ? '应用中…' : '确认应用派发'}
          </button>
        </footer>
      </div>
    </div>
  );
}

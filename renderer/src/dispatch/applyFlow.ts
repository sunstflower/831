/**
 * 「应用派发 → 立即开跑」的**结果汇总**（纯函数，见 D-58）。
 *
 * ## 为什么单独一份而不进 `dispatch/model.ts`
 *
 * `model.ts` 描述的是**调度内核的输出怎么展示**（预览、代价明细、拒绝原因、日志行），
 * 它的输入全部来自 `docs/api.md` §3.4 的返回体。而本文件描述的是**渲染层把两个接口
 * 串起来之后的产物**（`apply` 的返回 + 逐单 `execution/start` 的返回），
 * 服务端并不知道有这么一个东西。把它塞进 `model.ts` 会让「这里的类型从哪来」变得含糊。
 *
 * ## 为什么要逐单汇总，而不是一句话「成功 / 失败」
 *
 * apply 与 start 是两个权限点、两次事务（D-11 / D-58）。逐单启动意味着**部分成功是常态**：
 * 第 1 台车开跑了、第 2 台因为电量不足被拒。如果只给一句「部分失败」，
 * 使用者既不知道哪一单要处理，也可能误以为整批都没生效。
 * 因此结果里必须逐条给出「哪个任务、哪台车、为什么」，并把成功的部分如实算进总数。
 */

/** 一单的启动尝试结果。`start === null` 表示**没有尝试**（开关关闭或没有权限）。 */
export interface DispatchStartAttempt {
  taskId: string;
  taskCode: string;
  vehicleCode: string;
  start: { ok: boolean; message?: string } | null;
}

export interface DispatchRunSummary {
  /** 本次 apply 落库的计划数。 */
  applied: number;
  /** 其中已成功开跑的单数。 */
  started: number;
  /** 尝试过但失败的单（逐条带原因）。 */
  failed: Array<{ taskCode: string; vehicleCode: string; message: string }>;
  /** 有 `execution:start` 权限、且开关打开，但被跳过或失败的数量 = applied - started。 */
  notStarted: number;
  /** 横幅主文案。 */
  headline: string;
  /** 逐条补充说明（失败原因、去哪儿重试）。 */
  details: string[];
  /** 横幅色调：全部开跑 = ok，部分失败 = warn，全部没开跑 = dim 由调用方按 `notStarted` 决定。 */
  tone: 'ok' | 'warn';
}

/**
 * 汇总一次「派发 + 开跑」。
 *
 * `strategyLabel` 由调用方从 `dispatch/model.ts` 的 `strategyLabel` 取 ——
 * 策略名的唯一作者在那里（D-52），本文件不复制一份中文表。
 */
export function summarizeDispatchRun(
  attempts: readonly DispatchStartAttempt[],
  strategyLabel: string
): DispatchRunSummary {
  const applied = attempts.length;
  const skipped = attempts.filter((attempt) => attempt.start === null);
  const attempted = attempts.filter((attempt) => attempt.start !== null);
  const started = attempted.filter((attempt) => attempt.start?.ok === true).length;
  const failed = attempted
    .filter((attempt) => attempt.start?.ok !== true)
    .map((attempt) => ({
      taskCode: attempt.taskCode,
      vehicleCode: attempt.vehicleCode,
      message: attempt.start?.message ?? '未知原因'
    }));

  const details: string[] = [];
  for (const item of failed) {
    details.push(`“${item.taskCode}”（${item.vehicleCode}）启动失败：${item.message} —— 可在任务管理页重试`);
  }
  if (skipped.length > 0) {
    details.push(
      `${skipped.length} 单未启动执行（“派发后立即开跑”未开启，或当前角色没有 execution:start 权限）：可在任务管理页逐单「开始执行」。`
    );
  }

  if (applied === 0) {
    return { applied, started, failed, notStarted: 0, headline: '没有派发任何任务', details, tone: 'warn' };
  }
  if (attempted.length === 0) {
    return {
      applied,
      started,
      failed,
      notStarted: applied,
      headline: `已派发 ${applied} 单（${strategyLabel}），尚未启动执行`,
      details,
      tone: 'warn'
    };
  }
  if (applied - started === 0) {
    return {
      applied,
      started,
      failed,
      notStarted: 0,
      headline: `已派发 ${applied} 单（${strategyLabel}），${started} 单已开始执行`,
      details,
      tone: 'ok'
    };
  }
  return {
    applied,
    started,
    failed,
    notStarted: applied - started,
    headline: `已派发 ${applied} 单（${strategyLabel}）：${started} 单已开跑，${applied - started} 单未启动`,
    details,
    tone: 'warn'
  };
}

/**
 * 解释文案生成（`docs/module-M4-dispatch.md` §8）。
 *
 * ## 为什么文案生成在服务层而不是算法内核
 *
 * 内核的输出必须**语言无关**：它是主进程与浏览器 Mock 共用的纯函数，
 * 一旦里面冒出中文句子，那句中文就成了「算法的一部分」，改文案要动算法层。
 * §8 也明确写了这个分工：内核只产出结构化原因，人读文案在这一层翻译。
 *
 * ## 文案里必须有具体数字
 *
 * 「任务 T-1 派给 AGV-01」是对的但没用；调度员要判断的是**这次派得合不合理**，
 * 因此每条都带上「空驶多少秒、执行多少秒、什么时候完成」。拒绝同理：
 * 一句「载重超限」不告诉使用者超了多少，他只能去别处查。
 */
import { DISPATCH_STRATEGY_LABELS, isLateWindowConflict, REJECT_REASON_LABELS } from '@udm/shared';
import type { PlanPreview, RejectItem, StrategySummary, StrategyOutcome } from '@udm/shared';

/**
 * 拒绝原因 / 策略名的中文说法。
 *
 * **唯一作者是 `shared/src/constants.ts`**（D-34）：主进程、浏览器 Mock 与渲染层
 * 都要说同一个词，而「哪一份才是对的」不能靠比对三处文本判断。
 * 这里只做再导出，让本文件的调用点保持旧名字（`STRATEGY_LABEL` / `REJECT_REASON_LABEL`），
 * 不必为了搬家去改 `dispatch.service.ts` 的每一行。
 */
export const REJECT_REASON_LABEL = REJECT_REASON_LABELS;
export const STRATEGY_LABEL = DISPATCH_STRATEGY_LABELS;

function seconds(value: number): string {
  return `${Math.round(value)}s`;
}

/** 派发一条：「任务 T-1 派给 AGV-01：空驶 12s + 执行 60s，预计 08:12 完成」。 */
export function explainPlan(plan: PlanPreview, taskCode: string): string {
  const detail = plan.costDetail;
  const parts = [`任务 ${taskCode} 派给 ${plan.vehicleCode}：空驶 ${seconds(detail.deadheadTimeS)} + 执行 ${seconds(detail.executeTimeS)}`];
  if (detail.waitTimeS >= 1) {
    parts.push(`等待 ${seconds(detail.waitTimeS)}`);
  }
  if (detail.penaltyLateS >= 1) {
    parts.push(`预计晚点 ${seconds(detail.penaltyLateS)}`);
  }
  if (detail.chargeRisk > 0) {
    parts.push(`续航风险 ${detail.chargeRisk.toFixed(2)}`);
  }
  const doneAt = plan.occupiedTo.slice(11, 19);
  return `${parts.join('，')}，预计 ${doneAt} 完成`;
}

/** 拒绝一条：「任务 T-2 拒绝：载重超限（任务 200kg 超过 AGV-03 剩余 100kg）」。 */
export function explainReject(item: RejectItem, taskCode: string): string {
  const summary = rejectDetailSummary(item);
  return `任务 ${taskCode} 拒绝：${REJECT_REASON_LABEL[item.reason]}${summary ? `（${summary}）` : ''}`;
}

/**
 * 从 `detail` 里挑一句话摘要。
 *
 * 只挑**已知的**键而不是把整个 detail 拼出来：detail 是给程序看的结构化上下文，
 * 里面的键会随实现增减；直接 `JSON.stringify` 会把 `{"vehicleId":"...","cargoKg":2000}`
 * 这种原始 JSON 塞进一句中文提示里，可读性比没有摘要更差。
 */
export function rejectDetailSummary(item: RejectItem): string {
  const detail = item.detail as Record<string, unknown>;
  switch (item.reason) {
    case 'LOAD_EXCEEDED':
      return `任务 ${detail['cargoKg']}kg 超过 ${detail['vehicleCode'] ?? ''} 剩余 ${detail['remainKg']}kg`;
    case 'VEHICLE_NOT_AVAILABLE':
      return `${detail['vehicleCode'] ?? ''} 状态 ${detail['status'] ?? ''}`;
    case 'TIMEWINDOW_CONFLICT':
      // 同一个 code 覆盖两种情形（见 `docs/module-M4-dispatch.md` §5 步骤 5）：
      // ① 预计完成晚于窗口末端超过容忍；② 与该车已排班次的占用区间相交。
      // 判据用产出方显式给出的 `kind`，不再靠「detail 里有没有 lateS」反推 ——
      // 两处消费方各推一遍就会漂移（渲染层曾因此把「被占用」印成「晚点 0s」）。
      if (isLateWindowConflict(detail)) {
        return `预计晚点 ${detail['lateS']}s，超出容忍 ${detail['toleranceS']}s`;
      }
      return `已在 ${String(detail['from'] ?? '').slice(11, 16)} ~ ${String(detail['to'] ?? '').slice(11, 16)} 被占用`;
    case 'BATTERY_INSUFFICIENT':
      return `完成后剩余 ${Number(detail['remainBattery'] ?? 0).toFixed(1)}%（下限 ${detail['minBattery']}%）`;
    case 'RESTRICTION_VIOLATED':
      return '必经路段被禁行规则封住';
    case 'UNREACHABLE':
      return '当前路网下无法到达';
    case 'NO_AVAILABLE_VEHICLE':
      return `候选 ${detail['candidateCount'] ?? 0} 台`;
    default:
      return '';
  }
}

/** 策略小结：「策略 贪心 共指派 2/3，加权综合分 265.0，耗时 12ms」。 */
export function explainSummary(outcome: StrategyOutcome): string {
  return `策略 ${STRATEGY_LABEL[outcome.strategy] ?? outcome.strategy} 共指派 ${outcome.summary.assigned}/${outcome.summary.totalTasks}，加权综合分 ${outcome.summary.totalCost.toFixed(1)}，耗时 ${Math.round(outcome.summary.elapsedMs)}ms`;
}

/**
 * 一个策略的完整解释列表。
 *
 * 顺序固定：**先派发、后拒绝、最后小结**。反过来（拒绝在前）会让日志里
 * 最需要先看到的「实际上是怎么派的」被埋在后面 —— 而拒绝往往是少数几条。
 */
export function explainOutcome(outcome: StrategyOutcome, taskCodes: Map<string, string>): string[] {
  const lines: string[] = [];
  for (const plan of outcome.plans) {
    lines.push(explainPlan(plan, taskCodes.get(plan.taskId) ?? plan.taskId));
  }
  for (const item of outcome.rejected) {
    lines.push(explainReject(item, taskCodes.get(item.taskId) ?? item.taskId));
  }
  lines.push(explainSummary(outcome));
  return lines;
}

/** 汇总多个策略的结果（`strategy=all` 时日志里只留一条小结）。 */
export function summarizeOutcomes(outcomes: readonly StrategyOutcome[]): StrategySummary {
  const totalTasks = outcomes[0]?.summary.totalTasks ?? 0;
  return {
    totalTasks,
    assigned: outcomes[0]?.summary.assigned ?? 0,
    rejectedCount: outcomes[0]?.summary.rejectedCount ?? 0,
    totalCost: outcomes[0]?.summary.totalCost ?? 0,
    elapsedMs: outcomes.reduce((sum, outcome) => sum + outcome.summary.elapsedMs, 0)
  };
}

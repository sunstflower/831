/**
 * 告警**状态机**（M8，`design.md` §4.8 的状态机是设计来源，本文件是代码侧唯一作者）。
 *
 * ## 为什么放 `shared` 而不是主进程
 *
 * 这条状态机有三个使用方：主进程领域服务（`domain/alert/alert.service.ts`）、
 * 浏览器 Mock（无 SQLite 时也要能走完整闭环）与告警页（决定渲染哪些按钮）。
 * 三处各写一个数组的结果，本项目已经在任务状态机上踩过
 * （见 `task-state.ts` 文件头）：按钮能点、服务端拒绝，或者反过来更糟 ——
 * 两条路径都放行，数据进入一个没有任何模块认可的状态。
 *
 * ## 迁移表（`docs/api.md` §3.8.3）
 *
 *   - `acknowledge`：`new → acknowledged`
 *   - `resolve`：`acknowledged / processing → resolved`
 *   - `archive`：任意非 `archived` → `archived`
 *
 * `processing`（处理中）**没有 HTTP 入口**：它是执行器/人工接管的中间态，
 * 由后续模块直接写库。给它开一个 `POST …/process` 只会让使用者手工把一条
 * 「没人真的在处理」的告警标成处理中。
 *
 * 本文件是**纯函数 + 常量**：不读时间、不碰数据库、不抛异常，与 `task-state.ts` 同口径。
 */
import type { AlertStatus, AlertType } from './enums.js';

/** 告警上可执行的三个操作；顺序即 UI 上的推荐顺序。 */
export const ALERT_ACTIONS = ['acknowledge', 'resolve', 'archive'] as const;
export type AlertAction = (typeof ALERT_ACTIONS)[number];

export interface AlertTransition {
  action: AlertAction;
  from: readonly AlertStatus[];
  to: AlertStatus;
  /** 一句话说明这条迁移做什么（UI 提示与错误文案共用，避免两处各写一份）。 */
  summary: string;
}

/**
 * 全部迁移。
 *
 * `Record` 而非数组：少写一条会**编译期报错**，而数组少一条只会表现为
 * 「某个操作永远返回冲突」，要到使用时才发现（与 `TASK_TRANSITIONS` 同一判据）。
 */
export const ALERT_TRANSITIONS: Record<AlertAction, AlertTransition> = {
  acknowledge: {
    action: 'acknowledge',
    from: ['new'],
    to: 'acknowledged',
    summary: '认领告警，表示已有人接手'
  },
  resolve: {
    action: 'resolve',
    from: ['acknowledged', 'processing'],
    to: 'resolved',
    summary: '记录处置结论并关闭告警'
  },
  archive: {
    action: 'archive',
    // 「或任意态 → archived」：归档是**收纳**而不是处置，未处置的告警也要能收起来
    // （否则一条 `new` 的误报会永远留在待处理列表里，把真正的告警淹掉）
    from: ['new', 'acknowledged', 'processing', 'resolved'],
    to: 'archived',
    summary: '归档，移出待处理列表'
  }
};

export function isAlertAction(value: unknown): value is AlertAction {
  return typeof value === 'string' && (ALERT_ACTIONS as readonly string[]).includes(value);
}

export interface AlertTransitionFailure {
  action: AlertAction;
  from: AlertStatus;
  expected: readonly AlertStatus[];
  to: AlertStatus;
  message: string;
}

export type AlertTransitionCheck =
  | { ok: true; transition: AlertTransition }
  | { ok: false; failure: AlertTransitionFailure };

/**
 * 判定一次告警迁移是否合法，失败时给出**可引导**的说明。
 *
 * 文案同时给出「当前状态」与「期望状态」：只说「当前状态不允许该操作」，
 * 使用者无法知道下一步该做什么（例如在 `new` 上点「关闭」应该先认领）。
 */
export function checkAlertTransition(action: AlertAction, from: AlertStatus): AlertTransitionCheck {
  const transition = ALERT_TRANSITIONS[action];
  if (transition.from.includes(from)) {
    return { ok: true, transition };
  }
  return {
    ok: false,
    failure: {
      action,
      from,
      expected: transition.from,
      to: transition.to,
      message: `当前状态 ${from} 不能执行 ${action}（该操作只允许在 ${transition.from.join(' / ')} 时执行）`
    }
  };
}

/** 某个状态下可执行的操作（UI 据此决定渲染哪些按钮）。 */
export function alertActionsOf(from: AlertStatus): AlertAction[] {
  return ALERT_ACTIONS.filter((action) => ALERT_TRANSITIONS[action].from.includes(from));
}

/**
 * 告警类型 → 建议的下一步（`docs/api.md` §3.7.4 / §3.8.2 的 `nextSteps` / `suggestedNextSteps`）。
 *
 * 为什么是常量而不是各页面自己写：同一句建议在「手动接管返回的 `nextSteps`」与
 * 「告警详情页的建议」两个地方出现，各写一份必然分叉。
 * 这里只给**可执行的排查方向**，不假装知道现场发生了什么。
 */
export const ALERT_NEXT_STEPS: Record<AlertType, string[]> = {
  vehicle_offline: ['确认车辆电源与网络', '在基础数据中核对该车状态', '无法恢复时改用其它车辆重派'],
  task_timeout: ['查看任务当前进度与车辆位置', '确认是否被路况/禁行阻挡', '必要时暂停并改派'],
  task_failed: ['查看失败原因与车辆故障码', '处理后用「重新进入候选池」重排'],
  route_blocked: ['检查禁行规则与路网状态', '重新预览指派，选择绕行路线'],
  data_error: ['核对导入数据与地图版本', '在问题数据修正后重新导入']
};

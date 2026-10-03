/**
 * IPC 接口注册表。
 *
 * 传输层的**校验与分页**不在这里内联（`ISS-015`）：通用部分见 `./validators.js` 与 `./paging.js`，
 * 两者都是纯函数、可脱离 Router 与数据库直接测；本文件只负责「路径 → 权限 → 处理函数」的装配。
 */
import {
  ALERT_LEVELS,
  ALERT_STATUSES,
  ALERT_TYPES,
  APP_VERSION,
  DISPATCH_LOG_ACTIONS,
  DISPATCH_STRATEGY_SELECTIONS,
  DomainError,
  EDGE_STATUSES,
  OBJECT_TYPES,
  RESTRICTION_STATUSES,
  RESTRICTION_TYPES,
  ROLES,
  SETTINGS_SCHEMA,
  SITE_TYPES,
  TASK_API_ACTIONS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  USER_STATUSES,
  VEHICLE_STATUSES,
  VEHICLE_TYPES,
  isTaskAction,
  type AuditContext,
  type EdgeStatus,
  type TaskStatus,
  type VehicleStatus
} from '@udm/shared';
import { get, nowIso, type Db } from '../db/index.js';
import { getAlertDetail, listAlerts, runAlertAction } from '../domain/alert/alert.service.js';
import { alertRisks } from '../domain/alert/risk.service.js';
import { exportAuditCsv, listAuditLogs } from '../domain/audit/audit.service.js';
import type { ExecutionRunner } from '../domain/execution/executor.js';
import { MONITOR_DEFAULT_TASK_STATUSES, monitorOverview, monitorTasks, monitorVehicles } from '../domain/monitor/monitor.service.js';
import { updateSettings } from '../domain/settings/settings.service.js';
import {
  changeOwnPassword,
  createUser,
  listUserItems,
  resetUserPassword,
  setUserStatus,
  updateUser
} from '../domain/user/user.service.js';
import { getMapOverview } from '../db/repositories/map.repo.js';
import { listEdges, listNodes } from '../db/repositories/graph.repo.js';
import { listRestrictions } from '../db/repositories/restriction.repo.js';
import { listSites } from '../db/repositories/site.repo.js';
import { listTemplates } from '../db/repositories/template.repo.js';
import { findVehicleById, listVehicles } from '../db/repositories/vehicle.repo.js';
import { getTaskDetail, listTasks } from '../db/repositories/task.repo.js';
import { listTracks } from '../db/repositories/execution.repo.js';
import { getSettings, parseSettingsValues } from '../db/repositories/settings.repo.js';
import { createNode, createEdge, setEdgeStatus, setNodeStatus, updateEdge, updateNode } from '../domain/base/graph.service.js';
import { createSite, setSiteStatus, updateSite } from '../domain/base/site.service.js';
import { createTemplate, updateTemplate } from '../domain/base/template.service.js';
import { createRestriction, deleteRestriction, updateRestriction } from '../domain/base/restriction.service.js';
import { createVehicle, setVehicleStatus, updateVehicle } from '../domain/base/vehicle.service.js';
import { createTask, deleteDraftTask, operateTask, updateTask } from '../domain/task/task.service.js';
import { compareRoutes, getRoute, planRoute } from '../domain/route/route.service.js';
import {
  apply,
  listDispatchLogs,
  listStrategies,
  manualAssign,
  preview,
  recompute
} from '../domain/dispatch/dispatch.service.js';
import type { CrudContext } from '../domain/base/context.js';
import { login } from '../services/auth.js';
import { writeAudit } from '../services/audit.js';
import type { EventBus } from '../services/event-bus.js';
import type { SessionStore } from '../services/session.js';
import { parsePagination } from './paging.js';
import { optionalEnumFilter, optionalString, requireEnum, requireString } from './validators.js';
import type { Route, RouteContext } from './router.js';

export interface ApiDependencies {
  db: Db;
  sessions: SessionStore;
  bus: EventBus;
  /**
   * M7 执行器。
   *
   * 从依赖注入而不是模块级单例：`start` / `takeover` 要把请求**交到同一个正在跑的
   * 执行器**手上（它内存里持有推进状态），而测试与 CLI 场景需要拿到同一个实例。
   */
  executor: ExecutionRunner;
}

export function createApiRoutes(deps: ApiDependencies): Route[] {
  const { db, sessions, bus, executor } = deps;

  return [
    {
      path: '/api/health',
      public: true,
      handler: () => ({
        status: 'ok',
        db: Boolean(get(db, 'SELECT 1 AS ok')),
        version: APP_VERSION,
        now: nowIso()
      })
    },
    {
      path: '/api/auth/login',
      // 方法必须显式写：不写时 Router 一律按 GET 注册（`router.ts` 的兼容口径），
      // 而契约（`docs/api.md` §3.1.1）写的是 POST。实测走查时 `POST /api/auth/login`
      // 返回过 `API.ROUTE_NOT_FOUND` —— 光看这一行代码完全看不出问题（ISS-066）
      method: 'POST',
      public: true,
      handler: (payload, ctx) => {
        const username = requireString(payload, 'username');
        const password = requireString(payload, 'password');
        const result = login(db, sessions, { username, password }, ctx.traceId);
        bus.emit('map.updated', { reason: 'login' });
        return result;
      }
    },
    {
      path: '/api/auth/logout',
      // 同上：契约 §3.1.3 是 POST（ISS-066）
      method: 'POST',
      handler: (_payload, ctx) => {
        sessions.destroy(ctx.token);
        writeAudit(db, ctx.actor, { module: 'auth', action: 'logout', objectType: 'user', objectId: ctx.actor?.actorId });
        return { ok: true };
      }
    },
    {
      path: '/api/auth/session',
      handler: (_payload, ctx) => ({ user: ctx.session?.user ?? null })
    },
    {
      path: '/api/settings',
      permission: 'settings:read',
      handler: () => parseSettingsValues(getSettings(db))
    },
    {
      path: '/api/settings/schema',
      permission: 'settings:read',
      handler: () => SETTINGS_SCHEMA
    },
    {
      path: '/api/map/overview',
      permission: 'map:read',
      handler: () => getMapOverview(db)
    },
    {
      path: '/api/users',
      permission: 'user:manage',
      handler: (payload) => {
        const { page, pageSize, keyword } = parsePagination(payload);
        const role = optionalEnumFilter(payload, 'role', ROLES);
        const status = optionalEnumFilter(payload, 'status', USER_STATUSES);
        const { records, total } = listUserItems(db, { page, pageSize, keyword, role, status });
        return { records, total, page, pageSize };
      }
    },
    /*
     * ---- M2 基础数据 ----
     *
     * 读接口直接调仓库层（D-41）；**写接口一律经领域服务**（`domain/base/*`）：
     * 那里有事务、审计与跨表校验（编码唯一、节点引用、方向对唯一），
     * 而这些都是「多表业务规则」，属领域层的职责（§4）。
     *
     * 四个列表接口共用同一套分页口径（`parsePagination`，宽进）；筛选参数走
     * `optionalEnumFilter`（严出，取值非法直接报错）—— 两者的判据见该函数注释。
     * 写接口的字段级规则在 `@udm/shared` 的 `base-rules.ts`（主进程与 Mock 共用同一份）。
     */
    {
      path: '/api/sites',
      permission: 'base:read',
      handler: (payload) => {
        const { page, pageSize, keyword } = parsePagination(payload);
        const type = optionalEnumFilter(payload, 'type', SITE_TYPES);
        const status = optionalEnumFilter(payload, 'status', EDGE_STATUSES);
        const { records, total } = listSites(db, { keyword, type, status, page, pageSize });
        return { records, total, page, pageSize };
      }
    },
    {
      path: '/api/vehicles',
      permission: 'base:read',
      handler: (payload) => {
        const { page, pageSize, keyword } = parsePagination(payload);
        const status = optionalEnumFilter(payload, 'status', VEHICLE_STATUSES);
        const type = optionalEnumFilter(payload, 'type', VEHICLE_TYPES);
        const { records, total } = listVehicles(db, { keyword, status, type, page, pageSize });
        return { records, total, page, pageSize };
      }
    },
    {
      path: '/api/nodes',
      permission: 'base:read',
      handler: (payload) => {
        const { page, pageSize, keyword } = parsePagination(payload);
        const status = optionalEnumFilter(payload, 'status', EDGE_STATUSES);
        const { records, total } = listNodes(db, { keyword, status, page, pageSize });
        return { records, total, page, pageSize };
      }
    },
    {
      path: '/api/edges',
      permission: 'base:read',
      handler: (payload) => {
        const { page, pageSize } = parsePagination(payload);
        // 边没有 keyword 搜索：它的可读标识是 `code`，而 code 由两端节点 code 推导，
        // 按名称搜边在语义上不成立（`docs/api.md` §3.2.4 也只定义 code / fromNodeId / toNodeId）
        const code = optionalString(payload, 'code');
        const fromNodeId = optionalString(payload, 'fromNodeId');
        const toNodeId = optionalString(payload, 'toNodeId');
        const status = optionalEnumFilter(payload, 'status', EDGE_STATUSES);
        const { records, total } = listEdges(db, { code, fromNodeId, toNodeId, status, page, pageSize });
        return { records, total, page, pageSize };
      }
    },

    /*
     * ---- M2 写路径（`base:write`） ----
     *
     * 三个共性，写在这里而不是每个处理函数里重复：
     *   1. **参数原样传进领域服务**：字段级规则在 `shared/src/base-rules.ts`，
     *      传输层不再自己 requireString 一遍 —— 两处都判就会出现「传输层说合法、
     *      领域层说非法」这种口径分叉，而它只在某个字段的组合上显形；
     *   2. `ctx.params.id` 是路径参数（Router 解析 `:id` 段），不走 payload；
     *   3. **事件在领域服务返回之后发**：服务内部的事务已提交，
     *      此时渲染层重拉快照一定能读到新值（见 `domain/base/context.ts`）。
     */
    {
      path: '/api/sites',
      method: 'POST',
      permission: 'base:write',
      handler: (payload, ctx) => {
        const created = createSite(toCrudContext(ctx), payload);
        // 站点落在路网上，位置与形状都变了 —— 用结构类事件让地图重拉快照
        bus.emit('map.updated', { reason: 'site.created', siteId: created.id });
        return created;
      }
    },
    {
      path: '/api/sites/:id',
      method: 'PUT',
      permission: 'base:write',
      handler: (payload, ctx) => {
        const updated = updateSite(toCrudContext(ctx), ctx.params['id'] ?? '', payload);
        bus.emit('map.updated', { reason: 'site.updated', siteId: updated.id });
        return updated;
      }
    },
    {
      path: '/api/sites/:id/status',
      method: 'PATCH',
      permission: 'base:write',
      handler: (payload, ctx) => {
        const status = requireStatus(payload);
        const updated = setSiteStatus(toCrudContext(ctx), ctx.params['id'] ?? '', status);
        bus.emit('map.updated', { reason: 'site.status', siteId: updated.id, status });
        return updated;
      }
    },
    {
      path: '/api/vehicles',
      method: 'POST',
      permission: 'base:write',
      handler: (payload, ctx) => {
        const created = createVehicle(toCrudContext(ctx), payload);
        bus.emit('map.updated', { reason: 'vehicle.created', vehicleId: created.id });
        return created;
      }
    },
    {
      path: '/api/vehicles/:id',
      method: 'PUT',
      permission: 'base:write',
      handler: (payload, ctx) => {
        const updated = updateVehicle(toCrudContext(ctx), ctx.params['id'] ?? '', payload);
        bus.emit('map.updated', { reason: 'vehicle.updated', vehicleId: updated.id });
        return updated;
      }
    },
    {
      path: '/api/vehicles/:id/status',
      method: 'PATCH',
      permission: 'base:write',
      handler: (payload, ctx) => {
        const status = requireVehicleStatus(payload);
        const updated = setVehicleStatus(toCrudContext(ctx), ctx.params['id'] ?? '', status);
        bus.emit('map.updated', { reason: 'vehicle.status', vehicleId: updated.id, status });
        return updated;
      }
    },
    {
      path: '/api/nodes',
      method: 'POST',
      permission: 'base:write',
      handler: (payload, ctx) => {
        const created = createNode(toCrudContext(ctx), payload);
        bus.emit('map.updated', { reason: 'node.created', nodeId: created.id });
        return created;
      }
    },
    {
      path: '/api/nodes/:id',
      method: 'PUT',
      permission: 'base:write',
      handler: (payload, ctx) => {
        const updated = updateNode(toCrudContext(ctx), ctx.params['id'] ?? '', payload);
        bus.emit('map.updated', { reason: 'node.updated', nodeId: updated.id });
        return updated;
      }
    },
    {
      path: '/api/nodes/:id/status',
      method: 'PATCH',
      permission: 'base:write',
      handler: (payload, ctx) => {
        const status = requireStatus(payload);
        const updated = setNodeStatus(toCrudContext(ctx), ctx.params['id'] ?? '', status);
        bus.emit('map.updated', { reason: 'node.status', nodeId: updated.id, status });
        return updated;
      }
    },
    {
      path: '/api/edges',
      method: 'POST',
      permission: 'base:write',
      handler: (payload, ctx) => {
        const created = createEdge(toCrudContext(ctx), payload);
        bus.emit('map.updated', { reason: 'edge.created', edgeId: created.id });
        return created;
      }
    },
    {
      path: '/api/edges/:id',
      method: 'PUT',
      permission: 'base:write',
      handler: (payload, ctx) => {
        const updated = updateEdge(toCrudContext(ctx), ctx.params['id'] ?? '', payload);
        bus.emit('map.updated', { reason: 'edge.updated', edgeId: updated.id });
        return updated;
      }
    },
    {
      path: '/api/edges/:id/status',
      method: 'PATCH',
      permission: 'base:write',
      handler: (payload, ctx) => {
        const status = requireStatus(payload);
        const updated = setEdgeStatus(toCrudContext(ctx), ctx.params['id'] ?? '', status);
        // 封路会影响可达性：地图必须重画（`docs/api.md` §3.2.4）
        bus.emit('map.updated', { reason: 'edge.status', edgeId: updated.id, status });
        return updated;
      }
    },
    /*
     * ---- M2 禁行规则（`docs/api.md` §3.2.5）----
     *
     * 与上面四类主数据的差别只有一处：**它是唯一允许物理删除的实体**
     * （`design.md` D-07 的唯一例外）。软删的是「这条规则现在失效」，
     * 而禁行规则没有历史依赖，留一堆 `expired` 只会让「哪些规则在生效」越来越难读。
     * 因此 `DELETE` 是**真删**，行消失、痕迹只剩审计（见 `restriction.service.ts`）。
     *
     * 规则落在路网上（节点或边），改动会影响可达性 —— 与 `edge.status` 同口径，
     * 一律发 `map.updated`（结构类事件）让地图重拉快照。
     */
    {
      path: '/api/restrictions',
      permission: 'base:read',
      handler: (payload) => {
        const { page, pageSize } = parsePagination(payload);
        // 没有 `keyword`：规则的可读标识是它的目标（节点/边编码），
        // 而目标编码需要 JOIN 才能算出来 —— 按它模糊搜得把派生列接进 LIKE，
        // 语义上也不是「搜索规则」。筛选用 `type` / `status` 两项足够（§3.2.5 的 query 列）。
        const type = optionalEnumFilter(payload, 'type', RESTRICTION_TYPES);
        const status = optionalEnumFilter(payload, 'status', RESTRICTION_STATUSES);
        const { records, total } = listRestrictions(db, { type, status, page, pageSize });
        return { records, total, page, pageSize };
      }
    },
    {
      path: '/api/restrictions',
      method: 'POST',
      permission: 'base:write',
      handler: (payload, ctx) => {
        const created = createRestriction(toCrudContext(ctx), payload);
        bus.emit('map.updated', { reason: 'restriction.created', restrictionId: created.id });
        return created;
      }
    },
    {
      path: '/api/restrictions/:id',
      method: 'PUT',
      permission: 'base:write',
      handler: (payload, ctx) => {
        const updated = updateRestriction(toCrudContext(ctx), ctx.params['id'] ?? '', payload);
        bus.emit('map.updated', { reason: 'restriction.updated', restrictionId: updated.id });
        return updated;
      }
    },
    {
      path: '/api/restrictions/:id',
      method: 'DELETE',
      permission: 'base:write',
      handler: (_payload, ctx) => {
        const result = deleteRestriction(toCrudContext(ctx), ctx.params['id'] ?? '');
        bus.emit('map.updated', { reason: 'restriction.deleted', restrictionId: result.id });
        return result;
      }
    },
    /*
     * ---- M2 任务模板（`docs/api.md` §3.2.6）----
     *
     * **只有三条路由**：列表、创建、更新。没有 `DELETE`（模板可能被任务引用）、
     * 也没有「停用」（DDL 里没有 status 列）。这与另外五类的不对称是**契约决定的**，
     * 不是实现没做完 —— 因此这里不提供一条「为对称而加」的删除路由。
     *
     * 模板不影响路网，因此不发 `map.updated`。它与地图没有关系，
     * 发一条地图事件会让地图做一次无意义的重拉快照（这正是事件分类要按**影响**而非**来源**的原因）。
     */
    {
      path: '/api/task-templates',
      permission: 'base:read',
      handler: (payload) => {
        const { page, pageSize, keyword } = parsePagination(payload);
        const { records, total } = listTemplates(db, { keyword, page, pageSize });
        return { records, total, page, pageSize };
      }
    },
    {
      path: '/api/task-templates',
      method: 'POST',
      permission: 'base:write',
      handler: (payload, ctx) => createTemplate(toCrudContext(ctx), payload)
    },
    {
      path: '/api/task-templates/:id',
      method: 'PUT',
      permission: 'base:write',
      handler: (payload, ctx) => updateTemplate(toCrudContext(ctx), ctx.params['id'] ?? '', payload)
    },

    /*
     * ---- M3 任务管理（`task:read` / `task:write`） ----
     *
     * 两处与 M2 不同的口径：
     *   1. `?status=` 允许**逗号多值**（契约如此）—— 单值筛选靠重复发请求做不到，
     *      因为那样每页各算各的，翻页时会漏行；因此这里解析成数组交给 SQL 的 `IN`；
     *   2. 状态操作是**一个** `:action` 路由段而不是六条同构路由：六条只差一个字面量，
     *      分开写会让「新增一个动作要改三处」（状态机 / 路由 / 测试）成为必然。
     *      代价是动作名必须校验 —— 校验用的是状态机自己导出的 `isTaskAction`，
     *      **不另写一份允许清单**。
     *
     * `task.changed` 事件让地图与工作台重拉快照：任务状态变了，路线颜色、
     * 车辆占用、看板计数都要跟着变（`renderer/src/map/hooks/useMapOverview.ts`）。
     */
    {
      path: '/api/tasks',
      permission: 'task:read',
      handler: (payload) => {
        const { page, pageSize, keyword } = parsePagination(payload);
        const statuses = parseTaskStatusFilter(payload);
        const priority = optionalEnumFilter(payload, 'priority', TASK_PRIORITIES);
        const vehicleId = optionalString(payload, 'vehicleId');
        const from = optionalString(payload, 'from');
        const to = optionalString(payload, 'to');
        const { records, total } = listTasks(db, {
          statuses,
          priority,
          vehicleId,
          from,
          to,
          keyword,
          page,
          pageSize
        });
        return { records, total, page, pageSize };
      }
    },
    {
      path: '/api/tasks/:id',
      permission: 'task:read',
      handler: (_payload, ctx) => {
        const detail = getTaskDetail(db, ctx.params['id'] ?? '');
        if (!detail) {
          throw new DomainError('TASK.NOT_FOUND', undefined, { id: ctx.params['id'] });
        }
        return detail;
      }
    },
    {
      path: '/api/tasks',
      method: 'POST',
      permission: 'task:write',
      handler: (payload, ctx) => {
        const created = createTask(toCrudContext(ctx), payload);
        bus.emit('task.changed', { reason: 'task.created', taskId: created.id, status: created.status });
        return created;
      }
    },
    {
      path: '/api/tasks/:id',
      method: 'PUT',
      permission: 'task:write',
      handler: (payload, ctx) => {
        const updated = updateTask(toCrudContext(ctx), ctx.params['id'] ?? '', payload);
        bus.emit('task.changed', { reason: 'task.updated', taskId: updated.id, status: updated.status });
        return updated;
      }
    },
    {
      path: '/api/tasks/:id/:action',
      method: 'POST',
      permission: 'task:write',
      handler: (payload, ctx) => {
        const id = ctx.params['id'] ?? '';
        const action = ctx.params['action'] ?? '';
        if (!isTaskAction(action) || !TASK_ACTIONS_VIA_POST.includes(action)) {
          // 状态机认识这个动作、但它不属于状态操作接口时，也一律按「没有这条路」处理：
          // 给 403 会让人以为「权限不够」，而其实是不该有这个入口（`assign` / `start` 等由 M4 / M7 触发）
          throw new DomainError('API.ROUTE_NOT_FOUND', undefined, { path: `/api/tasks/${id}/${action}` });
        }
        const result = operateTask(toCrudContext(ctx), id, action, payload);
        bus.emit('task.changed', { reason: `task.${action}`, taskId: id, status: result.status });
        return result;
      }
    },
    {
      path: '/api/tasks/:id',
      method: 'DELETE',
      permission: 'task:write',
      handler: (_payload, ctx) => {
        const deleted = deleteDraftTask(toCrudContext(ctx), ctx.params['id'] ?? '');
        bus.emit('task.changed', { reason: 'task.deleted', taskId: deleted.id });
        return deleted;
      }
    },

    /*
     * ---- M5 路径规划（`route:plan`）----
     *
     * 三条路由，两条写入形态上的差异值得说明：
     *
     *   1. `plan` 与 `compare` 都是 **POST 但都不落库**：契约里它们是「预览」，
     *      用 POST 只是因为请求体带结构化参数（`viaNodeIds` 是数组，塞进 query 会很难看）。
     *      因此这里**不发任何事件** —— 没有数据变化，发 `map.updated` 会让地图白重拉一次
     *      （与模板接口不安地图事件是同一个判断）。
     *   2. `GET /api/routes/{id}` 读的是 `routes` 表，而该表只在调度 apply 时写入。
     *      因此现在（M4 未落地）它只能查到 seed 的演示路线 —— 这是**数据状态**，
     *      不是接口没做完。
     *
     * 权限统一用 `route:plan`（而不是给查询再拆一个 `route:read`）：三者是同一个能力面，
     * 拆开会让「会规划的人看不了自己刚算出的路线」。`design.md` §3.7 的权限点清单里
     * 该权限属于 dispatcher 与 admin。
     */
    {
      path: '/api/routes/plan',
      method: 'POST',
      permission: 'route:plan',
      handler: (payload, ctx) => planRoute(toCrudContext(ctx), payload)
    },
    {
      path: '/api/routes/compare',
      method: 'POST',
      permission: 'route:plan',
      handler: (payload, ctx) => compareRoutes(toCrudContext(ctx), payload)
    },
    {
      path: '/api/routes/:id',
      permission: 'route:plan',
      handler: (_payload, ctx) => getRoute(toCrudContext(ctx), ctx.params['id'] ?? '')
    },

    /*
     * ---- M4 调度（`dispatch:read` / `dispatch:preview` / `dispatch:apply`）----
     *
     * 六条路由对应「一条读清单 + 一条查询 + 三条写 + 一条预览」：
     *
     *   1. `preview` 是 **POST 但只写日志**（不改业务数据）：请求体带 `taskIds` 数组，
     *      且它**确实产生一条可追溯的记录**（`dispatch_logs`），因此与 M5 的
     *      `routes/plan`（纯计算、不落任何行）不同 —— 后者不发事件，这里也**不发事件**：
     *      事件是给「地图/看板要重拉数据」用的，而预览没有改变任何被展示的业务事实。
     *   2. 三条写路由**必须显式写 `method: 'POST'`**：不写时 Router 按 GET 注册，
     *      `POST /api/dispatch/apply` 会返回 `API.ROUTE_NOT_FOUND`（ISS-066）。
     *   3. 事件在**领域事务提交之后**发（`apply` / `manualAssign` 返回即已提交）：
     *      `task.changed`（任务状态 + 指派车辆变了）、`vehicle.changed`（车辆被占用/回收）、
     *      `map.updated`（路线高亮与占用片段要重画）。
     *   4. `apply` 与 `manual-assign` 共用 `dispatch:apply`：它们都是「让派发生效」，
     *      区别只在「谁挑的车」（系统 vs 人）。分两个权限点会让「能自动派但不能手动派」
     *      这种没有业务含义的组合变得可配置。
     */
    {
      path: '/api/dispatch/strategies',
      permission: 'dispatch:read',
      handler: () => listStrategies()
    },
    {
      path: '/api/dispatch/preview',
      method: 'POST',
      permission: 'dispatch:preview',
      handler: (payload, ctx) => preview(toCrudContext(ctx), payload)
    },
    {
      path: '/api/dispatch/apply',
      method: 'POST',
      permission: 'dispatch:apply',
      handler: (payload, ctx) => {
        const result = apply(toCrudContext(ctx), payload);
        emitDispatchEffects(bus, 'dispatch.applied', result, 'assign');
        return result;
      }
    },
    {
      path: '/api/dispatch/manual-assign',
      method: 'POST',
      permission: 'dispatch:apply',
      handler: (payload, ctx) => {
        const result = manualAssign(toCrudContext(ctx), payload);
        emitDispatchEffects(bus, 'dispatch.manual_assign', result, 'assign');
        return result;
      }
    },
    {
      path: '/api/dispatch/recompute',
      method: 'POST',
      permission: 'dispatch:apply',
      handler: (payload, ctx) => {
        const result = recompute(toCrudContext(ctx), payload);
        // 重算把车辆与任务**回收**了（不是指派），因此这里带的是任务 id、不带车辆 id：
        // 事件消费方（地图/看板）据此重拉快照，而不是去猜「哪台车被释放了」
        bus.emit('task.changed', { reason: 'dispatch.recompute', requestId: result.requestId, taskIds: result.strategies.flatMap((item) => item.plans.map((plan) => plan.taskId)) });
        bus.emit('vehicle.changed', { reason: 'dispatch.recompute', requestId: result.requestId });
        bus.emit('map.updated', { reason: 'dispatch.recompute' });
        return result;
      }
    },
    {
      path: '/api/dispatch/logs',
      permission: 'dispatch:read',
      handler: (payload, ctx) => {
        const { page, pageSize } = parsePagination(payload);
        // 筛选取值走 optionalEnumFilter（严出）：写错一个字母应该报错，而不是静默返回全部
        // —— 一份「看起来是全部」的日志会让人得出「这段时间没有调度」的错误结论
        const action = optionalEnumFilter(payload, 'action', DISPATCH_LOG_ACTIONS);
        const strategy = optionalEnumFilter(payload, 'strategy', DISPATCH_STRATEGY_SELECTIONS);
        return listDispatchLogs(toCrudContext(ctx), {
          requestId: optionalString(payload, 'requestId'),
          action,
          strategy,
          taskId: optionalString(payload, 'taskId'),
          from: optionalString(payload, 'from'),
          to: optionalString(payload, 'to'),
          page,
          pageSize
        });
      }
    },

    /* ---- M6 车辆轨迹（`GET /api/map/tracks/{vehicleId}`） ----
     *
     * 轨迹表由执行器采样写入（M7），因此这条读接口在 M7 落地后才真的有数据。
     * 只读、按时间升序返回：折线回放要求点序与时间一致。 */
    {
      path: '/api/map/tracks/:vehicleId',
      permission: 'map:read',
      handler: (payload, ctx) => {
        const vehicleId = ctx.params['vehicleId'] ?? '';
        const vehicle = findVehicleById(db, vehicleId);
        if (!vehicle) {
          throw new DomainError('VEHICLE.NOT_FOUND', undefined, { id: vehicleId });
        }
        const { points, total } = listTracks(db, {
          vehicleId,
          taskId: optionalString(payload, 'taskId'),
          from: optionalString(payload, 'from'),
          to: optionalString(payload, 'to')
        });
        return { vehicleId, points, total };
      }
    },

    /* ---- M7 运行监控（`monitor:read`） ----
     *
     * 三条读接口 + 两条执行写接口。写接口的权限点与调度分开：
     * `dispatch:apply` 决定「派给谁」，`execution:start` 决定「现在开跑」——
     * 两者在真实现场往往不是同一个人（调度室 vs 现场）。 */
    {
      path: '/api/monitor/overview',
      permission: 'monitor:read',
      handler: () => monitorOverview(db)
    },
    {
      path: '/api/monitor/tasks',
      permission: 'monitor:read',
      handler: (payload) => {
        const { page, pageSize } = parsePagination(payload);
        // 不传 status 时只看「在跑的 + 出问题的」：监控页默认显示全量任务
        // 会把待派发的草稿混进来，而那正是「工作台」而不是「监控」要回答的问题
        const statuses = parseTaskStatusFilter(payload) ?? MONITOR_DEFAULT_TASK_STATUSES;
        const { records, total } = monitorTasks(db, {
          statuses,
          keyword: optionalString(payload, 'keyword'),
          page,
          pageSize
        });
        return { records, total, page, pageSize };
      }
    },
    {
      path: '/api/monitor/vehicles',
      permission: 'monitor:read',
      handler: (payload) => {
        const { page, pageSize } = parsePagination(payload);
        const status = optionalEnumFilter(payload, 'status', VEHICLE_STATUSES);
        const type = optionalEnumFilter(payload, 'type', VEHICLE_TYPES);
        const { records, total } = monitorVehicles(db, { status, type, keyword: optionalString(payload, 'keyword'), page, pageSize });
        return { records, total, page, pageSize };
      }
    },
    {
      path: '/api/execution/tasks/:id/start',
      // 契约 §3.7.3 是 POST（ISS-066：不写方法会按 GET 注册）
      method: 'POST',
      permission: 'execution:start',
      handler: (payload, ctx) => {
        const result = executor.startTask(toAuditContext(ctx), ctx.params['id'] ?? '', payload);
        // 事件在领域写完之后发（`operateTask` 与遥测都已提交）
        bus.emit('task.changed', { reason: 'execution.start', taskId: result.taskId });
        bus.emit('vehicle.changed', { reason: 'execution.start', vehicleId: result.vehicleId });
        bus.emit('map.updated', { reason: 'execution.start' });
        return result;
      }
    },
    {
      path: '/api/execution/tasks/:id/takeover',
      method: 'POST',
      permission: 'execution:takeover',
      handler: (payload, ctx) => {
        const result = executor.takeover(toAuditContext(ctx), ctx.params['id'] ?? '', payload);
        // `alert.created` 由执行器自己发（它同时知道告警与任务两侧的事实），
        // 这里只补任务状态变化 —— 接管把任务推到了 `paused`
        bus.emit('task.changed', { reason: 'execution.takeover', taskId: result.taskId });
        bus.emit('map.updated', { reason: 'execution.takeover' });
        return result;
      }
    },

    /* ---- M8 告警（`alert:read` + 三个操作权限点） ----
     *
     * 读接口只按 `alert:read`；三个状态操作各有自己的权限点（`alert:ack` /
     * `alert:resolve` / `alert:archive`）：现场人员「认领」与主管「关闭」在
     * 真实流程里不是同一件事（`design.md` §3.7）。 */
    {
      path: '/api/alerts',
      permission: 'alert:read',
      handler: (payload) => {
        const { page, pageSize } = parsePagination(payload);
        const type = optionalEnumFilter(payload, 'type', ALERT_TYPES);
        const level = optionalEnumFilter(payload, 'level', ALERT_LEVELS);
        const status = parseCsvEnumFilter(payload, 'status', ALERT_STATUSES);
        const objectType = optionalEnumFilter(payload, 'objectType', OBJECT_TYPES);
        const { records, total } = listAlerts(db, {
          type,
          level,
          status,
          objectType,
          objectId: optionalString(payload, 'objectId'),
          from: optionalString(payload, 'from'),
          to: optionalString(payload, 'to'),
          page,
          pageSize
        });
        return { records, total, page, pageSize };
      }
    },
    /*
     * 任务风险预检（`docs/api.md` §3.8.3）。
     *
     * **不是**告警：它不读也不写 `alerts` 表、不进状态机、没有 `id`，因此**没有**
     * 认领/解决/归档这些动作 —— 一条「预计会超时」被认领掉毫无意义，等它真的超时，
     * 执行器会照常落一条 `alert.created`。这条区分写在契约里，否则使用者会以为
     * 「认领掉就不响了」。
     *
     * 权限用 `alert:read`：看得到告警的人就该看得到「接下来会出什么问题」，
     * 三个角色都有这个权限点；而它**不**要求 `dispatch:*` —— 监控员没有调度权，
     * 但恰恰最需要这份清单去提醒调度。
     *
     * 放在 `/api/alerts/:id` **之前**：虽然路由器先做字面量精确匹配（`risks` 不会被
     * `:id` 抢走），但把静态段排在动态段前面，读代码的人不必先去确认那件事。
     */
    {
      path: '/api/alerts/risks',
      permission: 'alert:read',
      handler: () => alertRisks(db)
    },
    {
      path: '/api/alerts/:id',
      permission: 'alert:read',
      handler: (_payload, ctx) => getAlertDetail(db, ctx.params['id'] ?? '')
    },
    {
      path: '/api/alerts/:id/acknowledge',
      method: 'POST',
      permission: 'alert:ack',
      handler: (payload, ctx) => {
        const result = runAlertAction(toCrudContext(ctx), ctx.params['id'] ?? '', 'acknowledge', payload);
        bus.emit('alert.updated', { alertId: result.id, status: result.status, reason: 'alert.acknowledge' });
        return result;
      }
    },
    {
      path: '/api/alerts/:id/resolve',
      method: 'POST',
      permission: 'alert:resolve',
      handler: (payload, ctx) => {
        const result = runAlertAction(toCrudContext(ctx), ctx.params['id'] ?? '', 'resolve', payload);
        bus.emit('alert.updated', { alertId: result.id, status: result.status, reason: 'alert.resolve' });
        return result;
      }
    },
    {
      path: '/api/alerts/:id/archive',
      method: 'POST',
      permission: 'alert:archive',
      handler: (payload, ctx) => {
        const result = runAlertAction(toCrudContext(ctx), ctx.params['id'] ?? '', 'archive', payload);
        bus.emit('alert.updated', { alertId: result.id, status: result.status, reason: 'alert.archive' });
        return result;
      }
    },

    /* ---- M9 审计（`audit:read`，只读 + 导出） ---- */
    {
      path: '/api/audit/logs',
      permission: 'audit:read',
      handler: (payload) => {
        const { page, pageSize } = parsePagination(payload);
        const { records, total } = listAuditLogs(db, {
          module: optionalString(payload, 'module'),
          action: optionalString(payload, 'action'),
          actorId: optionalString(payload, 'actorId'),
          objectType: optionalString(payload, 'objectType'),
          objectId: optionalString(payload, 'objectId'),
          from: optionalString(payload, 'from'),
          to: optionalString(payload, 'to'),
          page,
          pageSize
        });
        return { records, total, page, pageSize };
      }
    },
    {
      path: '/api/audit/logs/export',
      permission: 'audit:read',
      handler: (payload) =>
        exportAuditCsv(db, {
          module: optionalString(payload, 'module'),
          action: optionalString(payload, 'action'),
          actorId: optionalString(payload, 'actorId'),
          objectType: optionalString(payload, 'objectType'),
          objectId: optionalString(payload, 'objectId'),
          from: optionalString(payload, 'from'),
          to: optionalString(payload, 'to')
        })
    },

    /* ---- M10 系统设置写（`settings:write`） ----
     *
     * 与 `GET /api/settings` 同路径、不同方法。事件 `settings.changed` 让
     * 各页面按新参数重取（例如监控页的兜底轮询间隔）。 */
    {
      path: '/api/settings',
      method: 'PATCH',
      permission: 'settings:write',
      handler: (payload, ctx) => {
        const updates = payload['updates'];
        if (typeof updates !== 'object' || updates === null || Array.isArray(updates)) {
          throw new DomainError('VALIDATION.FAILED', undefined, {
            fields: { updates: '必须是 `{ 键: 值 }` 对象' }
          });
        }
        const result = updateSettings(toCrudContext(ctx), updates as Record<string, unknown>);
        bus.emit('settings.changed', { keys: result.updatedKeys, reason: 'settings.update' });
        return result;
      }
    },

    /* ---- M1 用户写 + 本人改密 ----
     *
     * `PUT /api/users/me/password` **不设权限点**：改自己的密码不该需要
     * `user:manage`（否则只有管理员能改密码，而管理员改别人密码是另一条路径）。
     * 登录态是它唯一的前置条件。 */
    {
      path: '/api/users',
      method: 'POST',
      permission: 'user:manage',
      handler: (payload, ctx) => createUser(toCrudContext(ctx), payload)
    },
    {
      path: '/api/users/me/password',
      method: 'PUT',
      handler: (payload, ctx) => {
        if (!ctx.session) {
          throw new DomainError('AUTH.REQUIRED');
        }
        return changeOwnPassword(toCrudContext(ctx), ctx.session.user, payload);
      }
    },
    {
      path: '/api/users/:id',
      method: 'PUT',
      permission: 'user:manage',
      handler: (payload, ctx) => updateUser(toCrudContext(ctx), ctx.params['id'] ?? '', payload)
    },
    {
      path: '/api/users/:id/status',
      method: 'PATCH',
      permission: 'user:manage',
      handler: (payload, ctx) => setUserStatus(toCrudContext(ctx), ctx.params['id'] ?? '', payload)
    },
    {
      path: '/api/users/:id/reset-password',
      method: 'POST',
      permission: 'user:manage',
      handler: (payload, ctx) => resetUserPassword(toCrudContext(ctx), ctx.params['id'] ?? '', payload)
    }
  ];
}

/**
 * 派发生效后的三连事件（`apply` / `manual-assign` 共用）。
 *
 * 抽成函数而不是各写三行的理由：**三条事件缺一条都会产生「界面不刷新」的问题，
 * 而那种问题只在手工点过界面时才发现**。集中一处后，新增一个写路由时不会再漏。
 *
 * `kind` 参数目前只用于区分任务 id 的来源（自动派发的任务 id 来自 `appliedPlans`）；
 * 保留它是因为重算分支的载荷形状不同（见上），未来若要按动作区分接收方，也不必改调用点。
 */
function emitDispatchEffects(
  bus: EventBus,
  reason: string,
  result: { requestId: string; appliedPlans: Array<{ taskId: string; vehicleId: string }> },
  _kind: 'assign'
): void {
  bus.emit('task.changed', {
    reason,
    requestId: result.requestId,
    taskIds: result.appliedPlans.map((plan) => plan.taskId)
  });
  bus.emit('vehicle.changed', {
    reason,
    requestId: result.requestId,
    vehicleIds: result.appliedPlans.map((plan) => plan.vehicleId)
  });
  bus.emit('map.updated', { reason });
}

/**
 * 可经 `POST /api/tasks/{id}/{action}` 触发的动作 = 状态机里的 HTTP 动作**减去 `delete`**。
 *
 * 派生自 `shared` 的 `TASK_API_ACTIONS`（那是「哪些动作属于状态操作接口」的唯一作者），
 * 这里只是把 `delete` 挪到 `DELETE` 方法上 —— 一个动作、一种方法，不重复给两个入口。
 * 由此得到一条可断言的性质：注册的 POST 动作集合 == `TASK_API_ACTIONS - {delete}`
 * （见 `api.write.test.ts`），新增动作时忘了接路由会当场红。
 */
const TASK_ACTIONS_VIA_POST: readonly string[] = TASK_API_ACTIONS.filter((action) => action !== 'delete');

/**
 * `?status=` 一类的**逗号多值**枚举解析。
 *
 * 严出（与 `optionalEnumFilter` 同口径）：取值非法直接报错，而不是静默忽略 ——
 * 忽略会让页面显示**全量**数据，而使用者以为自己在看某个子集，并据此下结论。
 * 这与 M2 的 `?status=foo` 是同一判据。
 *
 * 抽成泛型而不是给任务与告警各写一份：两份实现的差别只在于传哪个枚举，
 * 而「第二份」正是本项目反复出现的分叉起点（D-34）。
 */
function parseCsvEnumFilter<T extends string>(
  payload: Record<string, unknown>,
  field: string,
  values: readonly T[]
): T[] | undefined {
  const raw = optionalString(payload, field);
  if (raw === undefined) {
    return undefined;
  }
  const parts = raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) {
    return undefined;
  }
  const unknown = parts.filter((part) => !(values as readonly string[]).includes(part));
  if (unknown.length > 0) {
    throw new DomainError('VALIDATION.FAILED', undefined, {
      fields: { [field]: `取值必须是 ${values.join(' / ')} 之一或它们的逗号组合，收到：${unknown.join(', ')}` }
    });
  }
  return parts as T[];
}

/** 任务状态多值筛选（`docs/api.md` §3.3.1）。 */
function parseTaskStatusFilter(payload: Record<string, unknown>): TaskStatus[] | undefined {
  return parseCsvEnumFilter(payload, 'status', TASK_STATUSES);
}

/**
 * 领域层的 `CrudContext`。
 *
 * `actor` 用 `shared` 的 `AuditContext`（不是传输层的 `RouteActor`）：领域层不得
 * 反向依赖传输层。这里做的是「把请求的身份翻译成业务身份」，只此一处。
 */
function toCrudContext(ctx: RouteContext): CrudContext {
  return {
    db: ctx.db,
    actor: ctx.actor
      ? {
          actorId: ctx.actor.actorId,
          actorName: ctx.actor.actorName,
          role: ctx.actor.role,
          // traceId 也带过去：审计行与响应信封必须能对上同一个 id，
          // 否则按 traceId 查日志只查得到一半
          traceId: ctx.actor.traceId
        }
      : null
  };
}

/**
 * 传输层身份 → 领域层身份（**不含 `db`**）。
 *
 * 给执行器用：它自己持有 `db`，只需要「谁在调我」这一半。
 */
function toAuditContext(ctx: RouteContext): AuditContext | null {
  return toCrudContext(ctx).actor;
}

/**
 * 启停接口的目标状态。
 *
 * 这里**只判成形**（是不是字符串、非空），取值合法性由领域层判
 * （`sites`/`nodes`/`edges` 只允许 `enabled`/`disabled`，`vehicles` 另有一套白名单）。
 */
function requireStatus(payload: Record<string, unknown>): EdgeStatus {
  return requireEnum(payload, 'status', EDGE_STATUSES);
}

/**
 * 车辆启停的目标状态：取值集合比 `sites` / `nodes` / `edges` 小。
 *
 * 只在这里拦「明显不可能的取值」（`enabled` 不是车辆状态），
 * 更细的白名单（`idle` / `disabled`，其余五个由执行器管）在领域服务里 ——
 * 那里才知道「当前状态是什么」，能给出 `VEHICLE.STATE_CONFLICT` 这种带上下文的错误。
 */
function requireVehicleStatus(payload: Record<string, unknown>): VehicleStatus {
  return requireEnum(payload, 'status', VEHICLE_STATUSES);
}

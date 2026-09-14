import type { ApiFailure, ApiSuccess, ErrorSource } from './types.js';

export interface ErrorDefinition {
  source: ErrorSource;
  message: string;
  httpStatus: number;
}

export const ERROR_CODES = {
  'AUTH.REQUIRED': { source: 'auth', message: '未登录或会话已失效', httpStatus: 401 },
  'AUTH.INVALID_TOKEN': { source: 'auth', message: '会话令牌无效', httpStatus: 401 },
  'AUTH.FORBIDDEN': { source: 'auth', message: '当前账号无此操作权限', httpStatus: 403 },
  'AUTH.LOGIN_FAILED': { source: 'auth', message: '用户名或密码错误', httpStatus: 401 },
  'AUTH.USER_DISABLED': { source: 'auth', message: '账号已被禁用', httpStatus: 401 },
  'AUTH.ACCOUNT_LOCKED': { source: 'auth', message: '密码错误次数过多，账号已临时锁定', httpStatus: 401 },
  'AUTH.OLD_PASSWORD_WRONG': { source: 'auth', message: '原密码错误', httpStatus: 400 },
  'VALIDATION.FAILED': { source: 'validation', message: '参数校验失败', httpStatus: 400 },
  'API.ROUTE_NOT_FOUND': { source: 'validation', message: '接口不存在', httpStatus: 404 },
  'USER.NOT_FOUND': { source: 'business', message: '用户不存在', httpStatus: 404 },
  'USER.NAME_EXISTS': { source: 'business', message: '用户名已存在', httpStatus: 409 },
  'SITE.NOT_FOUND': { source: 'business', message: '站点不存在', httpStatus: 404 },
  'VEHICLE.NOT_FOUND': { source: 'business', message: '车辆不存在', httpStatus: 404 },
  'NODE.NOT_FOUND': { source: 'business', message: '路网节点不存在', httpStatus: 404 },
  'EDGE.NOT_FOUND': { source: 'business', message: '路网边不存在', httpStatus: 404 },
  'TEMPLATE.NOT_FOUND': { source: 'business', message: '任务模板不存在', httpStatus: 404 },
  'BASE.CODE_EXISTS': { source: 'business', message: '编码已存在', httpStatus: 409 },
  'BASE.NODE_IN_USE': { source: 'business', message: '节点被边或站点引用，禁止禁用或删除', httpStatus: 409 },
  'TASK.NOT_FOUND': { source: 'business', message: '任务不存在', httpStatus: 404 },
  'TASK.STATE_CONFLICT': { source: 'business', message: '当前状态不允许执行该操作', httpStatus: 409 },
  'TASK.BATCH_PARTIAL_FAIL': { source: 'business', message: '批量导入存在失败项', httpStatus: 200 },
  'VEHICLE.STATE_CONFLICT': { source: 'business', message: '车辆状态不允许该操作', httpStatus: 409 },
  'DISPATCH.REQUEST_NOT_FOUND': { source: 'business', message: '调度请求不存在或已失效', httpStatus: 404 },
  'DISPATCH.PLAN_EXPIRED': { source: 'business', message: '调度预览已过期，请重新预览', httpStatus: 409 },
  'DISPATCH.ALREADY_APPLIED': { source: 'business', message: '该调度请求已应用', httpStatus: 409 },
  'DISPATCH.NO_CANDIDATE': { source: 'business', message: '没有满足约束的候选车辆', httpStatus: 409 },
  'ROUTE.NOT_FOUND_PATH': { source: 'business', message: '起点与终点之间不存在可行路径', httpStatus: 409 },
  'GRAPH.EMPTY': { source: 'business', message: '路网为空', httpStatus: 409 },
  'GRAPH.DISCONNECTED': { source: 'business', message: '路网不连通', httpStatus: 409 },
  'GRAPH.BLOCKED': { source: 'business', message: '受禁行规则限制无法通行', httpStatus: 409 },
  'ALERT.NOT_FOUND': { source: 'business', message: '告警不存在', httpStatus: 404 },
  'ALERT.STATE_CONFLICT': { source: 'business', message: '告警当前状态不允许该操作', httpStatus: 409 },
  'SETTINGS.KEY_NOT_FOUND': { source: 'business', message: '设置项不存在', httpStatus: 404 },
  'SYS.INTERNAL': { source: 'system', message: '系统内部错误，请查看日志', httpStatus: 500 }
} as const satisfies Record<string, ErrorDefinition>;

export type ErrorCode = keyof typeof ERROR_CODES;

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly source: ErrorSource;
  readonly detail?: Record<string, unknown>;

  constructor(code: ErrorCode, message?: string, detail?: Record<string, unknown>) {
    const definition = ERROR_CODES[code];
    super(message ?? definition.message);
    this.name = 'DomainError';
    this.code = code;
    this.source = definition.source;
    this.detail = detail;
  }
}

export function ok<T>(data: T): ApiSuccess<T> {
  return { code: 0, message: 'success', data };
}

export function fail(code: ErrorCode, detail?: Record<string, unknown>, message?: string): ApiFailure {
  const definition = ERROR_CODES[code];
  return {
    code,
    message: message ?? definition.message,
    source: definition.source,
    ...(detail ? { detail } : {})
  };
}

export function fromError(error: unknown, traceId?: string): ApiFailure {
  if (error instanceof DomainError) {
    const definition = ERROR_CODES[error.code];
    return {
      code: error.code,
      message: error.message || definition.message,
      source: error.source,
      ...(error.detail ? { detail: error.detail } : {}),
      ...(traceId ? { traceId } : {})
    };
  }
  return {
    code: 'SYS.INTERNAL',
    message: ERROR_CODES['SYS.INTERNAL'].message,
    source: 'system',
    ...(traceId ? { traceId } : {})
  };
}

export function isFailure<T>(result: ApiSuccess<T> | ApiFailure): result is ApiFailure {
  return result.code !== 0;
}

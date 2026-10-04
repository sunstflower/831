/**
 * 路由表（与 `design.md` §7.1 的页面清单对齐）。
 *
 * 十个模块的页面**全部已落地**（含车辆中心），因此当前没有任何路由指向 `PlaceholderPage`。
 * 保留它与其登记表 `app/modules.ts` 的 `PLANNED_MODULES` 是为了下一个模块：
 * 先登记「将来有什么能力、依赖哪些接口」再挂占位页，不静默给空白页。
 */
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from '../components/AppLayout';
import {
  AlertsPage,
  AuditPage,
  BaseDataPage,
  DashboardPage,
  DispatchPage,
  FleetPage,
  LoginPage,
  SettingsPage,
  TasksPage,
  UsersPage
} from '../pages';
import { MapView } from '../map/MapView';
import { RequireSession } from './RequireSession';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireSession>
            <AppLayout />
          </RequireSession>
        }
      >
        <Route path="/" element={<DashboardPage />} />
        <Route path="/map" element={<MapView />} />
        {/* 车辆中心：车队运行态读模型 + 单车轨迹抽屉（Req-M2-8 / Req-M7-6，D-59） */}
        <Route path="/fleet" element={<FleetPage />} />
        {/*
         * 页面一律指向各自的组件；`PlaceholderPage` 现在**没有任何路由在用**（M1-M10
         * 十个模块的页面都已落地）。保留它的唯一作用是：新增模块时先挂占位页，
         * 而不是给一个空白页 —— `app/modules.ts` 的 `PLANNED_MODULES` 仍登记着
         * 「将来会有什么能力、依赖哪些接口」，占位页会把它渲出来。
         */}
        {/* M3 任务管理：列表 + 新建/编辑 + 状态流转 + 详情（`pages/TasksPage.tsx`） */}
        <Route path="/tasks" element={<TasksPage />} />
        {/* M4 调度引擎 + M5 路径规划：同属一页（页内如实标注尚未覆盖的部分） */}
        <Route path="/dispatch" element={<DispatchPage />} />
        {/* M2 基础数据：读取路径已落地，写路径仍是占位（页面内如实标注） */}
        <Route path="/base-data" element={<BaseDataPage />} />
        {/* M8 告警中心：闭环处置（认领 / 解决 / 归档），按钮由 `shared` 的状态机派生 */}
        <Route path="/alerts" element={<AlertsPage />} />
        {/* M9 审计日志：只读 + CSV 导出（导出按钮仅 admin 可见） */}
        <Route path="/audit" element={<AuditPage />} />
        {/* M10 系统设置：表单按 `SETTINGS_SCHEMA` 动态渲染，只提交改过的键 */}
        <Route path="/settings" element={<SettingsPage />} />
        {/* M1 用户管理：账号维护 + 改自己的密码（两条「别把自己锁在门外」的护栏在服务端） */}
        <Route path="/users" element={<UsersPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

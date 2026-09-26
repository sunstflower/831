/**
 * 路由表（与 `design.md` §7.1 的页面清单对齐）。
 * 未实现模块一律落到 `PlaceholderPage`，并写明模块编号，不静默给空白页。
 */
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from '../components/AppLayout';
import { DashboardPage, LoginPage, PlaceholderPage } from '../pages';
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
        {/*
         * 未实现模块统一落到 `PlaceholderPage`，其内容来自 `app/modules.ts` 的登记表 ——
         * 标题、模块编号、计划能力、依赖契约都只写一份，路由这里只传键。
         */}
        <Route path="/tasks" element={<PlaceholderPage moduleKey="tasks" title="任务管理" />} />
        <Route path="/dispatch" element={<PlaceholderPage moduleKey="dispatch" title="调度中心" />} />
        <Route path="/base-data" element={<PlaceholderPage moduleKey="base-data" title="基础数据" />} />
        <Route path="/alerts" element={<PlaceholderPage moduleKey="alerts" title="告警中心" />} />
        <Route path="/audit" element={<PlaceholderPage moduleKey="audit" title="审计日志" />} />
        <Route path="/settings" element={<PlaceholderPage moduleKey="settings" title="系统设置" />} />
        <Route path="/users" element={<PlaceholderPage moduleKey="users" title="用户管理" />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

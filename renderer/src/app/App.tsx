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
        <Route path="/tasks" element={<PlaceholderPage title="任务管理" module="M3" />} />
        <Route path="/dispatch" element={<PlaceholderPage title="调度中心" module="M4 / M5" />} />
        <Route path="/base-data" element={<PlaceholderPage title="基础数据" module="M2" />} />
        <Route path="/alerts" element={<PlaceholderPage title="告警中心" module="M8" />} />
        <Route path="/audit" element={<PlaceholderPage title="审计日志" module="M9" />} />
        <Route path="/settings" element={<PlaceholderPage title="系统设置" module="M10" />} />
        <Route path="/users" element={<PlaceholderPage title="用户管理" module="M1" />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

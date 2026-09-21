/**
 * 会话守卫。
 *
 * 说明：这只是**体验层**的跳转，真正的权限判定在主进程（D-08）。
 * 渲染层的守卫被绕过不会造成越权——服务端仍会拒绝未授权调用。
 */
import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useSessionStore } from '../store/session';

export function RequireSession({ children }: { children: ReactNode }) {
  const user = useSessionStore((state) => state.user);
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

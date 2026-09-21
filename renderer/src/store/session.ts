/**
 * 会话状态：token + 当前用户。
 *
 * ⚠️ 安全说明：这里把 token 放在内存里（zustand，不持久化到 localStorage）。
 * 桌面端主进程内存会话本就是进程生命周期内的（`desktop/src/services/session.ts`），
 * 渲染层持久化 token 反而扩大了暴露面，因此**故意不做持久化**。
 */
import { create } from 'zustand';
import type { SessionUser } from '@udm/shared';

interface SessionState {
  token: string | null;
  user: SessionUser | null;
  login: (token: string, user: SessionUser) => void;
  logout: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  token: null,
  user: null,
  login: (token, user) => set({ token, user }),
  logout: () => set({ token: null, user: null })
}));

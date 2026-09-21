/**
 * 渲染层入口。挂载 React 应用并统一引入样式。
 *
 * 用 `HashRouter` 而非 `BrowserRouter`：生产形态由 Electron 以 `file://` 加载
 * `renderer/dist/index.html`（`desktop/src/main.ts` 的 `loadFile`），
 * 此时 `BrowserRouter` 拿到的 pathname 是文件系统路径，路由必然匹配失败。
 * HashRouter 在 `file://` 与 dev server 下行为一致。
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { App } from './app/App';
import './styles/theme.css';
import './styles/layout.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('未找到 #root 挂载点，请检查 renderer/index.html');
}

createRoot(container).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>
);

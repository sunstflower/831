import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain } from 'electron';
import { APP_NAME } from '@udm/shared';
import { defaultDbPath, openDatabase } from './db/index.js';
import { applyMigrations } from './db/migrate.js';
import { seedDatabase } from './db/seed.js';
import { ExecutionRunner } from './domain/execution/executor.js';
import { createApiRoutes } from './ipc/api.js';
import { createRouter, type HttpMethod } from './ipc/router.js';
import { EventBus } from './services/event-bus.js';
import { SessionStore } from './services/session.js';

const here = dirname(fileURLToPath(import.meta.url));
const DEV_RENDERER_URL = process.env.UDM_RENDERER_URL ?? 'http://localhost:5173';

function bootstrapDatabase() {
  const dbPath = defaultDbPath();
  const db = openDatabase(dbPath);
  const applied = applyMigrations(db);
  const seeded = seedDatabase(db);
  console.log(`[udm] db=${dbPath}`);
  console.log(`[udm] migrations applied: ${applied.length === 0 ? 'none' : applied.join(', ')}`);
  console.log(`[udm] seed changes: ${JSON.stringify(seeded)}`);
  return db;
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 720,
    title: APP_NAME,
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: resolve(here, '..', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (app.isPackaged) {
    void window.loadFile(resolve(here, '..', '..', 'renderer', 'dist', 'index.html'));
  } else {
    void window.loadURL(DEV_RENDERER_URL);
  }
  return window;
}

app.whenReady().then(() => {
  const db = bootstrapDatabase();
  const sessions = new SessionStore();
  const bus = new EventBus(db, sessions);
  /*
   * M7 本地模拟执行器（D-10）。
   *
   * 单实例、随进程生命周期：路由把 `start` / `takeover` 交给它，定时器每 tickMs
   * 推进一帧。`adoptRunningTasks()` 把库里已处于 `running` 的任务（例如 seed 的
   * 演示任务，或**上一次进程退出时**正在跑的任务）接进内存续跑 ——
   * 少了这一步，界面上一条「执行中」的任务会永远停在原地。
   */
  const executor = new ExecutionRunner(db, bus);
  const adopted = executor.adoptRunningTasks();
  if (adopted > 0) {
    console.log(`[udm] executor resumed ${adopted} running task(s)`);
  }
  executor.startTimer();
  const router = createRouter(createApiRoutes({ db, sessions, bus, executor }), {
    db,
    sessions,
    onError: ({ path, traceId, error }) => {
      console.error(`[udm] route failed path=${path} trace=${traceId}`, error);
    }
  });

  ipcMain.handle(
    'udm:invoke',
    async (
      event,
      request: { path: string; payload?: Record<string, unknown>; token?: string; method?: HttpMethod }
    ) => {
      const result = await router.invoke(request);
      // 会话与窗口绑定：窗口在登录前创建，只有登录成功后才具备接收领域事件的权限；
      // 登出即刻降权。否则任何窗口都能收到与其角色无关的业务事件（ISS-009）。
      if (request.path === '/api/auth/login' && result.code === 0) {
        const token = (result.data as { token?: string } | undefined)?.token ?? null;
        bus.bindSession(event.sender, token);
      } else if (request.path === '/api/auth/logout') {
        bus.bindSession(event.sender, null);
      }
      return result;
    }
  );

  const window = createWindow();
  bus.attach(window.webContents);
  window.on('closed', () => bus.detach(window.webContents));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const next = createWindow();
      bus.attach(next.webContents);
      next.on('closed', () => bus.detach(next.webContents));
    }
  });
});

app.on('window-all-closed', () => {
  // 定时器已 `unref()`，但显式停一次让「退出即停推进」这件事在代码上可见
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

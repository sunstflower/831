import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain } from 'electron';
import { APP_NAME } from '@udm/shared';
import { defaultDbPath, openDatabase } from './db/index.js';
import { applyMigrations } from './db/migrate.js';
import { seedDatabase } from './db/seed.js';
import { createApiRoutes } from './ipc/api.js';
import { createRouter } from './ipc/router.js';
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
  const bus = new EventBus(db);
  const router = createRouter(createApiRoutes({ db, sessions, bus }), {
    db,
    sessions,
    onError: ({ path, traceId, error }) => {
      console.error(`[udm] route failed path=${path} trace=${traceId}`, error);
    }
  });

  ipcMain.handle('udm:invoke', (_event, request: { path: string; payload?: Record<string, unknown>; token?: string }) =>
    router.invoke(request)
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
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

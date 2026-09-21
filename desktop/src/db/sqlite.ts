import { createRequire } from 'node:module';
import type { DatabaseSync } from 'node:sqlite';

/**
 * `node:sqlite` 是 Node 22+ 的内置模块，且**只有带 `node:` 前缀这一种形式**
 * （`builtinModules` 中不存在裸名 `sqlite`）。
 *
 * 而 Vite 5 / vite-node 的内置模块白名单是在打包时固化的（其 `prefixedBuiltins`
 * 仅硬编码了 `node:test`），解析 `node:sqlite` 时会先把前缀剥成 `sqlite`，
 * 随后因查不到该名字而抛 `Failed to load url sqlite`。
 *
 * 因此这里不走静态 `import`，改用 `createRequire` 在运行时加载：
 * `node:module` 是双方都认识的内置模块，而 `require` 调用不参与 Vite 的静态解析。
 * 编译产物（tsc）与 Electron 主进程下行为一致。
 *
 * 若将来升级到能识别该内置模块的 Vite/Vitest（见 AGENTS.md 问题记录），
 * 可改回静态 import —— 但需同步验证 `npm test` 与 `npm run dev:electron`。
 */
const require = createRequire(import.meta.url);

type DatabaseSyncCtor = new (path: string) => DatabaseSync;

const sqlite = require('node:sqlite') as { DatabaseSync: DatabaseSyncCtor };

export const DatabaseSyncImpl: DatabaseSyncCtor = sqlite.DatabaseSync;
export type { DatabaseSync };

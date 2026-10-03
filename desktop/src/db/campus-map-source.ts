/**
 * `data/campus/` 的**取值层**（Node 侧）。
 *
 * 分工：解析规则在 `shared/src/campus-map.ts`（纯函数，两端共用），
 * 本文件只负责「把文件读成字符串」。渲染层有对应的 `?raw` 版本
 * （`renderer/src/api/campus-source.ts`），两者给出的**标准形态完全相同**——
 * 这正是 D-27 要求的那条不变量（Mock 与 seed 必须逐字段一致）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyObstacleImpacts, parseCampusPackage, type CampusMapPackage } from '@udm/shared';

/**
 * 数据目录：仓库根的 `data/campus`。
 *
 * 为什么按模块位置上溯而不是按 `process.cwd()`：cwd 取决于谁启动的进程
 * （`npm run dev:electron` 在仓库根、直接 `electron dist/main.js` 在 `desktop/`），
 * 而**模块位置是确定的**（`desktop/src/db/` 与 `desktop/dist/db/` 距仓库根都是三层）。
 * 用 cwd 的后果是「换个方式启动，地图就变成空的了」，且不报错。
 */
export function campusDataDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', '..', 'data', 'campus');
}

function readText(file: string): string {
  return readFileSync(file, 'utf8');
}

export interface CampusMapSource {
  dir: string;
  pkg: CampusMapPackage;
  /** 应用障碍物影响后的边集合（权重已合并、被占满的边已剔除）。 */
  edges: ReturnType<typeof applyObstacleImpacts>['edges'];
  blocked: ReturnType<typeof applyObstacleImpacts>['blocked'];
  /** 当前数据目录的文件清单（供 seed 摘要与排查打印）。 */
  files: string[];
}

/**
 * 读入并解析地图包。
 *
 * 文件缺失时**直接抛错**而不是退回一份内置路网：地图是这套系统的地基，
 * 「悄悄地用另一份路网跑起来」会让所有对不上号的排查都失去参照物。
 */
export function loadCampusMap(dir: string = campusDataDir()): CampusMapSource {
  const required = {
    nodes: resolve(dir, 'campus_nodes.csv'),
    edges: resolve(dir, 'campus_edges.csv'),
    stations: resolve(dir, 'campus_stations.csv'),
    obstacles: resolve(dir, 'campus.obstacles.rou.xml')
  };
  for (const [kind, file] of Object.entries(required)) {
    if (!existsSync(file)) {
      throw new Error(`地图包缺少 ${kind} 文件：${file}`);
    }
  }
  // 拥堵叠加层是**可选**的：删掉它就是「全网畅通」的基线（见 data/campus/README.md）
  const congestionFile = resolve(dir, 'campus_congestion.csv');
  const pkg = parseCampusPackage({
    nodesCsv: readText(required.nodes),
    edgesCsv: readText(required.edges),
    stationsCsv: readText(required.stations),
    obstaclesXml: readText(required.obstacles),
    congestionCsv: existsSync(congestionFile) ? readText(congestionFile) : undefined
  });
  const applied = applyObstacleImpacts(pkg);
  return {
    dir,
    pkg,
    edges: applied.edges,
    blocked: applied.blocked,
    files: Object.values(required).concat(existsSync(congestionFile) ? [congestionFile] : [])
  };
}

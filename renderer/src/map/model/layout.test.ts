import { describe, expect, it } from 'vitest';
import type { Node } from '@xyflow/react';
import { buildMockOverview } from '../../api/mock-data';
import { anchorOfFlow, NODE_SIZE, LAYER_OFFSET, layerCanvasOffset, toFlow } from './toFlow';
import { PIXELS_PER_METER } from './projection';
import type { LayerVisibility } from './toFlow';

/**
 * 图层布局不变量：**同一个锚点上的元素不许互相遮挡**。
 *
 * 这条断言来自 `ISS-053`：seed 的演示数据里 AGV-01 停在站点 A-01 绑定的同一个节点上，
 * 两个约 90px 宽的标签框完全重叠，默认首屏就是 `AGV-01 / 执行中 / 100%` 压住 `A-01 / A 仓库`，
 * 两块文字都读不清。同类问题此前还出现过一次（任务起终点被车辆整个盖住）。
 *
 * 两次都不是数据错误（坐标是对的），而是**排版**问题，且都只在「恰好共点」时显形 ——
 * 换一批 seed 数据就可能看不见，因此靠人工看截图 review 是不可靠的。
 * 这里把它变成不变量：**锚点重合的元素，其声明矩形必须互不相交。**
 *
 * 用「声明尺寸」而不是真实测量值：jsdom 不做布局（`measured` 恒为空），
 * 而声明尺寸恰好是 `toFlow` 自己用来喂缩略图的那份，改动它就会让本测试变红 ——
 * 这正是我们要盯的地方。真实像素另由 Electron 截图核对（见 `AGENTS.md` 验证基线）。
 */
const ALL_VISIBLE: LayerVisibility = {
  netNodes: true,
  netEdges: true,
  routeEdges: true,
  taskEndpoints: true,
  orderEndpoints: true,
  vehicles: true,
  sites: true
};

interface Box {
  id: string;
  type: string;
  /** 画布坐标下的锚点（扣除图层偏移），用来判断两个元素是否「共点」。 */
  anchor: { x: number; y: number };
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * 注意 `toFlow` 的签名是 `(overview, visibility, selection, vehiclePositions)`：
 * 本文件早先误传了一个「选项对象」当第二个参数，于是所有 `visibility.*` 都是 `undefined`、
 * 全部图层被判为隐藏 —— 不变量断言在空集上**假通过**了。
 * 因此下面每条断言都带「比较次数 / 集合非空」的前置检查，防止再次空跑。
 */
function buildFlow() {
  return toFlow(buildMockOverview(), ALL_VISIBLE);
}

/** `-0` 归一成 `0`：`Object.is(-0, 0)` 为 `false`，`toBe` 会冤枉失败。 */
const zero = (value: number) => (value === 0 ? 0 : value);

/** 按中心锚点 + 声明尺寸算出矩形（节点统一是 `nodeOrigin=[0.5,0.5]`，见 `CENTER_ORIGIN`）。 */
function boxOf(node: Node): Box {
  const size = NODE_SIZE[node.type ?? ''];
  if (!size) {
    throw new Error(`节点类型 ${node.type} 没有声明尺寸，布局不变量无法校验`);
  }
  return {
    id: node.id,
    type: node.type ?? '',
    anchor: anchorOfFlow(node),
    left: node.position.x - size.width / 2,
    right: node.position.x + size.width / 2,
    top: node.position.y - size.height / 2,
    bottom: node.position.y + size.height / 2
  };
}

function overlaps(a: Box, b: Box): boolean {
  // 边界相切不算重叠（允许刚好贴边）
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/** 锚点比较：定位量是若干次乘加的结果，不能用 `===` 比浮点（`0` 与 `-0` 也会不相等）。 */
function sameAnchor(a: Box, b: Box): boolean {
  return Math.abs(a.anchor.x - b.anchor.x) < 1e-6 && Math.abs(a.anchor.y - b.anchor.y) < 1e-6;
}

const key = (box: Box) => `${box.type}:${box.id}`;

/**
 * 找出**锚点重合且矩形相交**的组合，并返回实际比较过的跨图层对数。
 *
 * 为什么限定「锚点重合」：不同锚点的元素偶尔相交是**正常**的 ——
 * 车辆沿路段插值时会开过某个端点标记、经过别的节点的站点附近，那不是排版缺陷。
 * 只有「同一个路口的四个图层挤在一起」才是本不变量要管的事。
 *
 * 同一图层内部（路网节点之间、相邻路线分段之间）本就允许交叠，故只比跨图层。
 *
 * 同理**路网节点（`net`）不参与比较**：它只是一个 12×12 的路口圆点，没有文字也没有
 * 交互，被车辆/站点压在下面正是设计意图（否则车会「飘」在路外）。
 * 需要担心的只有**带文字标签或需要点击**的四个图层。
 */
const COVERABLE = new Set(['net']);
function inspectCollisions(boxes: Box[]): { collisions: string[]; compared: number } {
  const collisions: string[] = [];
  let compared = 0;
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      if (a.type === b.type || COVERABLE.has(a.type) || COVERABLE.has(b.type) || !sameAnchor(a, b)) {
        continue;
      }
      compared += 1;
      if (overlaps(a, b)) {
        collisions.push(`${key(a)} 与 ${key(b)}`);
      }
    }
  }
  return { collisions, compared };
}

describe('图层布局不变量（ISS-053）', () => {
  it('seed 演示数据：共点图层互不遮挡', () => {
    const graph = buildFlow();
    const boxes = graph.nodes.filter((node) => !node.hidden).map(boxOf);
    expect(boxes.length).toBeGreaterThan(0);

    const { collisions, compared } = inspectCollisions(boxes);
    // 防「空跑」：锚点若因符号写反而全部对不上，比较次数会掉到 0，本测试就变成了假通过。
    // seed 的 N01 上同时站着 站点 A-01 + 车辆 AGV-01 + 演示任务的起点，两两比较即 3 对。
    expect(compared).toBeGreaterThanOrEqual(3);
    expect(collisions).toEqual([]);
  });

  it('锚点反推自洽：站点/车辆/任务端点扣除各自偏移后落到同一个锚点', () => {
    const graph = buildFlow();
    const boxes = graph.nodes.filter((node) => !node.hidden).map(boxOf);
    const vehicle = boxes.find((box) => box.type === 'vehicle')!;
    const site = boxes.find((box) => box.type === 'site')!;
    const endpoint = boxes.find((box) => box.type === 'taskEndpoint')!;

    // 三者共点（同挂 N01）—— 这正是「必须靠偏移避让」的场景本身；
    // 若 anchorOfFlow 的符号写反，这里会失败而不是让上一条断言悄悄空跑。
    for (const box of [site, endpoint]) {
      expect(sameAnchor(vehicle, box)).toBe(true);
    }
  });

  it('共点四层（路网节点 / 站点 / 车辆 / 任务端点）的具体几何：站点在车上、端点在两侧', () => {
    const graph = buildFlow();
    // 演示数据里 AGV-01 停在配送中心，而配送中心的站点、演示任务的起点也在同一个路口上
    const vehicle = graph.nodes.find((node) => node.type === 'vehicle')!;
    const site = graph.nodes.find((node) => node.type === 'site')!;
    const endpoint = graph.nodes.find((node) => node.type === 'taskEndpoint')!;
    // 锚点是**数据坐标**（配送中心不在原点，所以不能假设 x=0）；断言用「相对锚点的偏移」
    const anchor = anchorOfFlow(vehicle);

    // 车辆**不动**：位置就是「车在哪」这个信息本身（见 LAYER_OFFSET 的说明）
    expect(zero(vehicle.position.x - anchor.x)).toBe(0);
    expect(zero(vehicle.position.y - anchor.y)).toBe(0);
    // 而站点确实被抬起来了（不是「也没动」）
    expect(zero(site.position.x - anchor.x)).toBe(0);
    expect(site.position.y).toBeCloseTo(anchor.y - LAYER_OFFSET.site.y, 3);

    // 站点抬起：底边必须高于车辆顶边，中间留出可见间隙（0 间隙也算「贴着」）
    const siteBottom = site.position.y + NODE_SIZE.site!.height / 2;
    const vehicleTop = vehicle.position.y - NODE_SIZE.vehicle!.height / 2;
    expect(zero(endpoint.position.y - anchor.y)).toBe(0);
    expect(siteBottom).toBeLessThan(vehicleTop);
    // 而且间隙要真的看得见（≥ 8px），否则文字仍有视觉粘连
    expect(vehicleTop - siteBottom).toBeGreaterThanOrEqual(8);

    // 起终点让到两侧：整个端点方块都在车辆水平范围之外
    const endpointInnerEdge =
      Math.abs(endpoint.position.x) - NODE_SIZE.taskEndpoint!.width / 2;
    expect(endpointInnerEdge).toBeGreaterThanOrEqual(NODE_SIZE.vehicle!.width / 2);
  });

  it('声明的偏移量本身：共点图层各自拿到不同锚点，且偏移是画布像素而非米', () => {
    // 站点必须向上让位，否则与车辆完全重叠（ISS-053 的成因）
    expect(LAYER_OFFSET.site.y).toBeGreaterThan(0);
    // 站点与车辆在垂直方向上必须分开
    expect(LAYER_OFFSET.site.y - NODE_SIZE.site!.height / 2).toBeGreaterThan(
      NODE_SIZE.vehicle!.height / 2
    );
    // 起终点的左右偏移必须大于车辆半宽，否则仍会压在车上
    expect(Math.abs(LAYER_OFFSET.taskEndpoint.from.x)).toBeGreaterThan(NODE_SIZE.vehicle!.width / 2);
    expect(LAYER_OFFSET.taskEndpoint.from.x).toBe(-LAYER_OFFSET.taskEndpoint.to.x);
    // 端点还必须让开**站点框**的水平范围（站点半宽 48 > 车辆半宽 42，是更严的那个约束）
    const endpointInnerEdge =
      Math.abs(LAYER_OFFSET.taskEndpoint.from.x) - NODE_SIZE.taskEndpoint!.width / 2;
    const siteOuterEdge = Math.abs(LAYER_OFFSET.site.x) + NODE_SIZE.site!.width / 2;
    expect(endpointInnerEdge).toBeGreaterThan(siteOuterEdge);
    // 订单端点与任务端点同规则
    expect(LAYER_OFFSET.orderEndpoint).toEqual(LAYER_OFFSET.taskEndpoint);
    // 偏移量以画布像素表达、由 `shiftFlow` 叠加（不再除以比例尺）：1px 的偏移不等于 1 米的位移
    expect(PIXELS_PER_METER).toBeGreaterThan(1);
    // 车辆与路网节点不参与偏移（车的位置就是坐标本身）
    expect(layerCanvasOffset('vehicle')).toEqual({ x: 0, y: 0 });
    expect(layerCanvasOffset('net')).toEqual({ x: 0, y: 0 });
    // 符号换算只做一次：屏幕向上为正 → 画布 y 取负
    expect(layerCanvasOffset('site')).toEqual({ x: LAYER_OFFSET.site.x, y: -LAYER_OFFSET.site.y });
    // 反推自洽：从落点（锚点 - 偏移）能精确还原锚点
    const probe = {
      type: 'site',
      position: { x: 120, y: -240 - LAYER_OFFSET.site.y },
      data: {}
    } as unknown as Node;
    expect(anchorOfFlow(probe)).toEqual({ x: 120, y: -240 });
  });
});

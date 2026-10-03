# 校园仿真地图包（F2 · 演示数据）

> **文档边界**：本文件只说明 `data/campus/` 里每个文件是什么、来自哪里、哪些字段被本项目改过。
> 字段级契约见 [`docs/data-interfaces.md`](../../docs/data-interfaces.md) §4；这里不复述字段清单。

## 1. 来源

`campus_*.csv` 与 `campus.obstacles.rou.xml` 复制自课程样本
`第三次课_数据准备/1_仿真地图/`（SUMO 校园路网工程），**未改动内容**：

| 文件 | 内容 |
| --- | --- |
| `campus_nodes.csv` | 30 个路网节点（5×5 主网格 + 4 个校门 + 配送中心），坐标单位米 |
| `campus_edges.csv` | 90 条**有向**边（45 对双向），含道路类型 / 车道数 / 限速 / 长度 |
| `campus_stations.csv` | 13 个站点，**边绑定 + 泊位**形态（车道、沿边起止里程、泊位长度与容量） |
| `campus.obstacles.rou.xml` | 2 处占道（施工 / 抛锚），各占一条**单车道**路的 40–50 m，时长 86400 s |

只取了这 4 个文件：样本目录里的 `campus.net.xml` / `campus.geojson` / `campus_map.png` 是
SUMO 自己的编译产物与底图，导入器不读它们（`docs/data-interfaces.md` §4.1 的「地图包」定义）。

## 2. 本项目新增的文件

| 文件 | 性质 | 为什么需要 |
| --- | --- | --- |
| `campus_congestion.csv` | **本项目编写的演示数据**（非样本） | 样本只给静态路网：长度只有 80/150/160 m 三档、限速只有 10/15/20 km/h 三档，于是**任意两点间往往只有一条时间最优路**，调度策略对比会全部打平（贪心与匈牙利给出同一批计划，界面上的「哪个更快、快多少」永远是 0）。这一层给一部分边加上通行权重（`weight`），让「近但慢」与「远但快」同时存在 |

`campus_congestion.csv` 的列：`edge_code,weight,remark`。
`weight` 语义与 `edges.weight` 完全一致（**≥ 1 的惩罚系数**，1 = 畅通），
`remark` 只用于说明这条边为什么被加重（界面不显示它，审计与排查时用）。

**它不是真实数据**：不要把它的数值当成校园的真实路况。要回到「全网畅通」的基线，
删掉这个文件即可（导入器在文件缺席时按 1 处理）。

## 3. 障碍物怎么进系统

`campus.obstacles.rou.xml` 的两处占道都发生在 **`campus_secondary`（单车道）** 路上，
因此按 `shared/src/campus-map.ts` 的 `obstacleImpacts()` 判为「整条路不可通行」，
在 seed 里落成**禁行规则**（`restrictions`，类型 `edge`，无时间窗）。
多车道道路上的占道则是通行能力减半（`weight ×2`），不封路。

判据是**车道数**而不是「有没有障碍」：封掉一条明明还能走的半幅路，使用者在地图上看不出原因。

# 第 25 轮 · 参考合并计划（2026-10-19）

> 本文件是**多轮工作的计划登记**。本轮不会完成全部内容，剩余项在下方「进度」表里逐轮更新。

## 一、用户要的六件事

| # | 需求 | 本轮处理 |
| --- | --- | --- |
| 1 | 参考/合并 `sagiridsg/AgenticCampus` 与 `David-goldenman/Shanghaitech-2026-Hackthon` | 调研 + 许可裁决（子智能体 A） |
| 2 | 参考 `map.niyiwei.com`（快递站/地下车库/食堂菜单 + 活动日程课表结合） | POI 契约扩展（子智能体 D） |
| 3 | 参考 GeekPie "better eams" → 优化教务界面与课表 | 课表 UI 优化（子智能体 E）**未定位到该仓库** |
| 4 | 抓取 Gradescope / Blackboard / ecourse / Piazza → 统一 DDL | DDL 归一化领域层（子智能体 B） |
| 5 | 补全登录方式（学校邮箱 / 统一身份认证 / 微信 / 绑定账号） | 认证盘点 + 修 P0-3（子智能体 C） |
| 6 | 补全之前遗留的问题 | P0-1（两套 port）**本轮串行，未派** |

---

## 二、⚠️ 三个必须先说清的事实

### 1. 两个参考仓库**都没有许可证**

GitHub API 确认：`license: NONE`（`spdx_id` 为空）。

**没有许可证 = 保留所有权利**。这意味着：

- ✅ **可以**：读它的 README 与源码来理解**架构与思路**，然后自己独立实现
- ❌ **不可以**：复制代码、翻译代码（Dart→TS 那种也算）、逐行改写

这条不是保守，是法律事实。`packages/contracts/src/campus-services.ts` 里已经有同类先例
（TechPie-flutter 也没有 LICENSE，当时的裁决是"只读架构，不抄代码"）。

### 2. `map.niyiwei.com` 的图片**不能抓**

他们的地下车库照片与食堂菜单照片是**同学手动拍摄**的 —— 版权归拍摄者，
与"仓库没许可证"是两个独立问题。**抓取使用 = 侵犯著作权。**

我们能做的：
- 建**空的、可录入的** POI 数据模型（`packages/contracts/src/campus-poi.ts`）
- 用**我们自己能拿到的**数据：OSM 的 186 个 POI、我们 `canteen` 模块自己的菜品库
- 留导入接口，让有授权的人自己录入

### 3. 抓 Gradescope / Blackboard / Piazza 的**正确架构**

这两件事**不一样**，不能混：

| 做法 | 评价 |
| --- | --- |
| 服务端存学生各平台密码，代登录 | ❌ **不做**。违反各平台 ToS，且我们数据库会成为高价值攻击目标 |
| 服务端逆向各平台 API 抓取 | ❌ **不做**。平台一改就失效，且同样违反 ToS |
| **浏览器扩展读取用户本机已登录的会话** | ✅ **可做**。用户主动安装 + 配对码 + 只读 + 不导出 cookie |

第三种的边界（也是 AgenticCampus 采用的）：
- 用户在自己浏览器里先手动登录各平台
- 扩展只读**课程页面 DOM**，不碰密码
- 一次性配对码绑定到用户账号
- 只读：不发邮件、不提交作业、不发帖

**我们的落地策略**：本轮只做**契约 + 归一化纯函数**（`packages/contracts/src/deadlines.ts`
+ `packages/shared/src/deadline-normalize.ts`）。采集端（扩展）是**下一轮**的独立工作，
因为它需要一个 Chrome 扩展工程，与主仓构建体系不同。

---

## 三、参考仓库的真实能力（调研结论）

### `sagiridsg/AgenticCampus`（TS / Fastify / SQLite / Capacitor，556 文件）

- **IMAP 邮件接入**：归档邮件与附件，识别讲座/会议等活动时间（需用户核对确认）
- **Blackboard / Gradescope / Piazza 采集**：靠**浏览器扩展**（Edge/Chrome），
  读用户已登录的页面，**密码与 Cookie 不导出**
- 隔离的官方浏览器会话；授权加密保存
- PDF 离线解析（WASM + CMap + 标准字体），扫描件可配 OCR
- 995 项回归测试
- 站点：`https://agenticampus.cn/`

### `David-goldenman/Shanghaitech-2026-Hackthon` = campusMate（Python，467 文件）

- 课程 / 邮件 / DDL 工作台
- **每周时间表**：课、考试、Quiz、展示、活动
- **校园地图步行路线**（据其 README：依据已收录的室外道路估算）
- **群消息**：「接入本人本机的微信与 QQ 消息」—— 具体机制待子智能体 A 核实
- AI 助手（DeepSeek Harness），PDF/PPTX 按页提取 + 引用
- 四种主题（Nord / 观星台 / 星夜手记 / PRTS）

### `map.niyiwei.com` = 「上科大一图通」（闭源 SPA）

从前端 bundle 提取到的功能词表，证实它有：

- **快递站地图**、**步行导航 / 到这去 / 出发**
- **菜单原图 / 菜单整理中 / 已售罄 / N 元以内 / N 道菜**（食堂菜单 + 照片）
- **活动 / 活动时光机 / 进行中**（活动与时间轴结合）
- **门课 / 教室 / 教师 / 星期**（课表结合）
- **发笔记 / 收藏 / 已收藏 / 回复 / 提问 / 测评 / 约伴**（UGC 社交）
- **我的今天 / 今天吃什么 / 平面总索引**（个人今日视图、楼层索引）

> 这些是**功能清单**，不是可复制的实现。我们的 POI 契约（子智能体 D）覆盖了
> 快递站 / 地下车库 / 食堂菜单 / 活动场地 / 自习空间，但**数据要自己填**。

### GeekPie "better eams" —— **未定位**

GitHub 搜索受限（API 返回空），`geekpie` 组织名不存在。
唯一线索是 **CoursePrettier**（`clarivy.github.io/posts/courseprettier/`），
但无法确认是否是用户指的那个。

**因此本轮不从"better eams"抄任何东西**，课表优化按通用 Timetable 交互自己设计。
如果用户能给出确切仓库地址，下一轮再对照。

---

## 四、本轮派出的并行子智能体（写作用域互不重叠）

| 代号 | 任务 | 写作用域 | 冲突风险 |
| --- | --- | --- | --- |
| A | 参考仓库能力 + 许可裁决 | `docs/architecture/06-prior-art-and-reuse.md` | 无（纯文档） |
| B | DDL 统一归一化 | `packages/contracts/src/deadlines.ts`、`packages/shared/src/deadline-normalize.ts` | 低 |
| C | 认证盘点 + 修 P0-3 | `services/api/src/modules/auth/**`、`.env.example`、`docs/architecture/07-auth-methods.md` | 低 |
| D | POI 契约扩展 | `packages/contracts/src/campus-poi.ts` | 低 |
| E | 课表 UI 优化 | `apps/miniapp/src/presentation/pages/schedule/**`、新建组件 | 低 |

**共同约束**：不 commit / 不 push，改动留工作区，由 Lead 统一验收后提交。

### 被**有意排除**并行的一项

**P0-1（两套 `CampusSessionPort` / 两张表）必须串行。**

理由：它要重写 `auth` 的端口与适配器，而子智能体 C 正在改 `auth/**`。
两者同时写 `auth` = 必然互相覆盖。按分派纪律：**写作用域重叠的工作不能并行**。

P0-1 排在本轮子智能体全部回收之后，由 Lead 单独做。

---

## 五、进度

| 项 | 状态 |
| --- | --- |
| 参考仓库下载与结构侦察 | ✅ 完成（tarball，共 1023 文件） |
| 一图通功能侦察 | ✅ 完成（bundle 词表提取） |
| GeekPie better eams 定位 | ❌ **失败**，需用户提供确切地址 |
| 子智能体 A–E 派发 | ✅ 已派 |
| 子智能体 A–E 回收与验收 | ⏳ 进行中 |
| P0-1 串行修复 | ⏸ 等待 A–E 完成 |
| 采集端（Chrome 扩展） | ⏸ 下一轮 |
| 快递站/车库/菜单的**真实数据** | ⏸ 需要合法来源（校方或自愿者授权） |

---

## 六、需要用户决策的

1. **GeekPie "better eams" 的确切仓库地址** —— 我搜不到。如果有链接请给。
2. **地下车库 / 食堂菜单的真实数据从哪来** —— 抓别人的照片侵权。
   合法路径：(a) 校方提供；(b) 我们自己的同学去拍并签授权；
   (c) 用校方官网已公开的地图（需确认授权范围）。选哪条？
3. **P0-1 要不要动同学的 auth 代码** —— 它挡住 `/auth/me`、`/auth/campus/overview`、
   `/schedule/sync` 三条路径。修它要重写 auth 的 port 与表，会改动同学写的东西。

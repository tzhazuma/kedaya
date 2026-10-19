# 09 · 「秦QIN」APK 逆向分析（仅架构参考，不合并代码）

> 分析对象：`Qin-widget-add-fix-preview.apk`（18 MB，另一个参赛组的作品）
> 分析日期：2026-10-19
> 结论先行：**架构先进，但我们一行代码都不能用** —— 理由见第 1 节。

---

## 1. ⚠️ 版权裁决：只学思路，不复制

这个 APK **没有附带任何许可证**。我通过 `.js.map` 源映射还原出了约 **127 个文件 / 21,695 行
原始 TypeScript**（`sourcesContent` 字段里就是他们构建前的源码）。

这带来一个必须说清的边界：

| 做法 | 判定 |
| --- | --- |
| 读它的架构、理解它的设计取舍、自己重新实现 | ✅ 合法（思想不受版权保护） |
| 把还原出的 `.ts` 复制进我们仓库 | ❌ 侵权 |
| 翻译/改名/逐行改写 | ❌ 仍然是侵权（衍生作品） |

**因此：还原出的源码只留在 `/tmp/qin-src`，永不进仓库。**
本文档只记录**可借鉴的设计模式**，以及我们**要独立实现**的东西。

> 这与 `08-reference-merge-plan.md` 对 `AgenticCampus` / `campusMate` 的裁决一致：
> 那两个仓库也是 `license: NONE`，同样是"只读架构、独立实现"。

---

## 2. 技术栈与产品形态

| 项 | 值 |
| --- | --- |
| 应用名 | 「秦QIN」 |
| appId | `dev.matrix.shell` |
| 壳 | **Capacitor**（Android WebView 容器），非 Flutter、非原生 |
| 前端 | **React 19** + Vite 构建 |
| 本地存储 | `@capacitor-community/sqlite`（WASM SQLite）+ `@capacitor/preferences` + `@aparajita/capacitor-secure-storage` |
| 自有原生插件 | `@matrix/capacitor-notify`（`dev.matrix.notify.MatrixNotifyPlugin`） |
| 桌面小组件 | `widget-sync.html` + `src/platform/android-widget.ts` + `widget-data.ts` |

**重要判断**：它是个**Web 壳应用**，不是原生。这意味着它的"能力"主要来自
WebView + Capacitor 桥；我们用 **Taro 小程序**，两者在能力边界上不可直接对标。

---

## 3. 最值得学的一件事：插件 API 的「权限 vs 信任」正交

它的 `packages/plugin-api/src/v1/` 是一套完整的插件契约（10 个文件 / 2,919 行）：

```
accounts.ts   command.ts   contract.ts   errors.ts   manifest.ts
permissions.ts  schema.ts  slot.ts       ui.ts       version.ts
```

### 3.1 核心洞见（这是我们目前缺的）

> **`capabilities`（代码能不能进来）与 `permissions`（能做什么）是正交的。**
> 授予「信任这段远程代码」**不等于**授予它「网络访问权」。

以及：

> **`permissions` 是声明，不是授予。**
> 安装时用户确认的子集才成为 `granted`，且必须满足 `granted ⊆ declared`。

这两条对我们的 **`campus-services.ts`** 有直接启发。我们现在的
`CampusServiceDescriptor` 有 `authorization` / `mode` / `wiring` / `integration`，
但**没有把"信任"与"能力"分开**。

### 3.2 另一条：校验返回 issue 列表，不抛异常

它的 manifest 校验**不 throw**，返回 `PluginResult` + `issues[]` —— 理由是
「安装页要能把问题一条条显示给用户」。一个异常只能给一句话，
一个 issue 列表能给出十条可操作的建议。

**我们的对应问题**：`validatePoiSupplement()` 返回 `CampusPoiIssue[]`（这点我们做对了），
但其他校验器不一定。

### 3.3 插件形态分类

```
PluginKind = 'declarative' | 'logic' | 'connector' | 'ui' | 'first-party'
KINDS_WITHOUT_ENTRY = ['declarative', 'first-party']
```

`KINDS_WITHOUT_ENTRY` 的理由写得很好：声明式插件没有代码，`entry` 无意义；
第一方插件编译进应用、进程内直接持有模块对象，根本不读 `entry` ——
**"要求它填一个并不存在的文件名是纯粹的谎"**。

这条对我们有警示意义：我们的契约里也有类似的"为了形状整齐而要求填一个无意义字段"的诱惑。

---

## 4. 学术采集层：三条我们**确实缺**的护栏

它把 Gradescope / Blackboard / 教务（EAMS）的采集写成三个 first-party connector，
manifest 里声明 `net.domains` / `net.methods` / `data.write` / `auth.providers`。

**真正值得学的是它的失败处理**（这是我们 DDL 目前最大的短板）：

### 4.1 空结果保护

> 只有「可靠识别出本期课程范围」之后才接受「0 条作业」。

**为什么重要**：如果平台改版或登录过期，采集会返回"0 条"。
如果我们把它当成"本期无作业"，用户的 DDL 就**凭空清空**了 —— 这比报错严重得多。
报错用户会重试；静默清空用户会**错过截止日期**。

### 4.2 丢页保护

> 抓了 N 页、只成功解析 M 页时，若 `M < N/2`，说明这次网络根本不通，
> 保留上次结果并报错，而不是用残缺数据覆盖好的数据。

**为什么重要**：这与 4.1 是同一类错误的两面 —— 都是"把失败当成功"。
它的阈值取一半，理由是"一页失败"和"大半失败"是两件事：前者可容忍（单页超时不该连坐），
后者说明整条链路断了。

### 4.3 每页累积写回

> 不是"全部抓完才写"，而是每成功一页就合并进快照，尾页超时也不丢已读到的内容。

**为什么重要**：课表类采集可能有几十页。如果第 30 页超时导致前 29 页全丢，
用户体验是灾难性的 —— 而这完全没必要。

### 4.4 增量合并保留元数据

它的 merge 逻辑在覆盖一条作业时，**刻意保留**：
- `verifiedAt`（上次核验时间）
- `needsReview`（是否需要人工复核）
- `completedAt`（完成时间，仅当状态是 submitted/graded）

**为什么重要**：重新采集不应该抹掉用户已经确认过的东西。
一个"我已经标记为已交"的状态，不能因为下次同步就被重置。

---

## 5. 它的认证方式（与我们殊途同归）

`src/core/academic-transport.ts` 里有一个 `PlatformSessionBridge`，
通过 Capacitor 原生桥拿到**平台会话**（`Capacitor.getPlatform() === 'android'`）。

也就是说：**它也不存用户密码**，而是复用设备上已登录的 WebView 会话 ——
这与我们 `webview-session` 的 **W4 方案**（用户在校园页面自己登录、我们不接触 cookie）
是同一个方向的两个实现。

**这条印证了我们的选择是对的**，不需要改。

---

## 6. 我们的行动计划（独立实现，不抄代码）

| # | 借鉴的思路 | 我们的落地 | 状态 |
| --- | --- | --- | --- |
| 1 | 空结果保护 / 丢页保护 / 每页累积写回 | 新建 `packages/contracts/src/deadline-collect.ts`（纯状态机 + 判定） | 进行中 |
| 2 | 权限 vs 信任正交 | 在 `campus-services.ts` 增加 `trust` 与 `capability` 两个正交维度 | 待排期 |
| 3 | 校验返回 issue 列表 | 复核我们的校验器是否都这样（`validatePoiSupplement` 已符合） | 待复核 |
| 4 | 桌面小组件 | 我们是小程序，用**订阅消息 + 首页卡片**替代，不做 Android widget | 已定 |

### 明确**不做**的

- ❌ 不做 Capacitor 壳：我们已有小程序 + Web + Flutter 三端，再加一个壳没有收益
- ❌ 不引入他们的插件系统：我们的 21 个模块是**内置**的，不需要运行第三方代码，
  引入插件系统会凭空扩大攻击面
- ❌ 不做 Android 桌面小组件：小程序生态里对应能力是订阅消息

---

## 7. 反编译能得到什么、不能得到什么（方法论记录）

**能得到**：
- `capacitor.config.json` / `capacitor.plugins.json` → 技术栈与插件清单
- `assets/public/assets/*.js` → 构建产物
- **`*.js.map` 的 `sourcesContent` → 构建前的原始 TypeScript**（这次的关键）

**不能得到**：
- 服务端代码（APK 里没有）
- 他们的后端接口地址（前端可能是硬编码或运行时配置）
- 任何凭据（本来就不该有）

**这条记录的意义**：以后分析任何 Cordova/Capacitor/Vite 打包的应用，
**先看有没有 `.js.map`** —— 有的话能省掉大量逆向工作。
同时也提醒我们：**我们自己的生产构建不应该带 `.js.map`**，
否则等于把源码随包分发。建议后续检查各端构建配置。

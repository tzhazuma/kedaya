# 12 · 从同学项目合并的代码（2026-10-20）

> 前置文档：[06-prior-art-and-reuse.md](./06-prior-art-and-reuse.md)（能力调研与许可裁决）、
> [08-reference-merge-plan.md](./08-reference-merge-plan.md)（合并计划）、
> [09-qin-apk-analysis.md](./09-qin-apk-analysis.md)（秦QIN 逆向分析）。
> 那三份文档的结论是「**只学架构，不复制代码**」。本文记录**授权变更之后**的合并结果。
>
> **作者**：DeepSeek Harness 子智能体（合并执行）
> **授权人**：唐志昊（项目负责人）
> **日期**：2026-10-20（Asia/Shanghai）
> **基线**：工作开始时 `main @ 4af1a6f`；工作期间并行提交推进到 `24fa29b`（见 §8.1）
> **性质**：新增文件 + 本文。未 commit / push（唯一例外见 §8.1，由并行提交带入）。

---

## 0. 一页结论

1. **授权变了**：项目负责人确认 `AgenticCampus` / `Shanghaitech-2026-Hackthon`(campusMate) /
   `秦QIN` 三个项目的同学**已同意合并**。06 文档里「不能复制、不能翻译、不能逐行改写」的
   法律约束解除，本文之后的升级路径是「可以搬，但要带出处、要过质量线」。
2. **本轮合并 6 个模块 / 2600 行源码 / 176 个新测试**，全部落在
   `packages/shared/src/deadline-*.ts`（新文件）。**零新增依赖、零 `any`、未改任何既有文件**。
3. **合并的主线是「平台页面解析」**：秦QIN 的 Gradescope / Blackboard / EAMS 解析器
   移植成我们自己的类型化、可测试、返回 `Result` 的实现；另外从 campusMate 拿了
   作业五分区判据，从 AgenticCampus 拿了回源链接清洗与只读白名单。
4. **质量线没有降**：`@kedaya/shared` 测试 **358 → 534**（+176，只增不减），
   `typecheck` 干净。别人的代码进我们仓库的第一天就有测试覆盖，而不是先合再补。
5. **有意不合并的东西写在第 5 节**，主要是：插件宿主与网络采集层（架构冲突）、
   微信/QQ 本机解密（平台规则 + 不可移植）、数据文件与素材（授权范围未覆盖）、
   以及「能跑但不值得维护」的胶水代码。

---

## 1. 授权变更之后，仍然守着的两条纪律

授权解决了**版权**问题，没有解决**工程质量**问题。所以合并时按用户给的两条纪律执行：

| 纪律 | 本轮怎么落实 | 怎么验证 |
| --- | --- | --- |
| **保留出处** | 每个文件头写「来源项目 / 上游文件 / 合并授权人 / 与上游的差异」；本文第 2、4 节逐文件登记 | `grep -l "合并声明" packages/shared/src/deadline-*.ts` 应命中 6 个文件 |
| **质量线不降** | 每个模块配同规模测试；失败走 `Result` 而不是 `throw`；类型全显式；复用已有测试过的 `parseDueText` 而不是重写时区逻辑 | `npm run typecheck -w @kedaya/shared` + `npm run test -w @kedaya/shared`（见 §6） |

另外三条本轮自己加的约束：

- **不引入新依赖**。解析器只用手写扫描 + 正则，没有 cheerio / jsdom（小程序体积敏感，
  宿主产物要能跑）。`packages/shared/package.json` 未改动。
- **不复制上游测试**。上游没有测试；我们的测试是**按行为规格重写**的，不是把 Python/TS
  里的注释翻译成断言。
- **不复制数据文件**。所有测试夹具是手工构造的**结构等价样本**，不含任何平台真实内容、
  不含课程名/学号/链接等个人信息。

> ⚠️ 授权仍然不等于「许可证转移」。06 文档 §4.1 的第 1 条事实（仓库无 LICENSE）没有变，
> 变的是**权利人给了我们许可**。建议把这份同意（哪怕是聊天记录）留档，尤其是在
> 商业化 / 上架 / 向校方批量部署之前 —— 那时需要的是可出示的授权，而不是「当时说好了」。

---

## 2. 合并清单（文件级）

### 2.1 秦QIN —— 本轮的主体

**源码从哪来**：09 文档记录的 `/tmp/qin-src` 已被系统清理。本轮从
`~/Downloads/Qin-widget-add-fix-preview.apk` 的 `.js.map`（`sourcesContent` 字段）
**重新还原**（可复现步骤见附录 B）。这次还原出 151 个来源文件（含被打包进来的第三方产物），
其中 `src/**` 下 **86 个 `.ts`**，比 09 文档记录的 127 文件/21,695 行更多（那次只统计了
`src/` 的原始 TS，这次把 map 里所有文件都解出来了）。

| 上游（秦QIN） | 我们（新增文件） | 行数 | 测试 | 说明 |
| --- | --- | --- | --- | --- |
| `src/plugins/builtin/academic/html.ts`（125 行）<br>+ `parsers.ts` 里的读取原语 | `packages/shared/src/deadline-parse-html.ts` | 839 | 63 | 可见文本、属性、链接、日期片段、日期→绝对时刻、登录页识别、提交状态、JS 字符串字面量 |
| `parsers.ts` `gradescopeCourses` / `gradescopeAssignments` | `packages/shared/src/deadline-parse-gradescope.ts` | 396 | 20 | 课程列表（学期分组 + 侧栏去重）、作业表（三段日期切分） |
| `parsers.ts` `blackboardCourses` / `blackboardModule` / `blackboardCurrentCourses` / `blackboardAssignment` / `blackboardPending` | `packages/shared/src/deadline-parse-blackboard.ts` | 434 | 27 | 门户课程模块、作业页、待完成作业模块 |
| `parsers.ts` `eamsSelection` / `eamsTimetable` | `packages/shared/src/deadline-parse-eams.ts` | 359 | 20 | 选课参数 + `TaskActivity` 脚本字面量 → 排课 |
| **小计** | 4 个源文件 | **2028** | **130** | |

上游一共 7 个 academic 文件（另有 `model.ts` / `connectors.ts` / `projection.ts` /
`simulate.ts`），我们只移植了解析相关的部分；`model.ts` 的类型被我们的类型取代，
其余部分见 §5。

### 2.2 AgenticCampus

| 上游 | 我们 | 行数 | 测试 |
| --- | --- | --- | --- |
| `implementations/real/ingest.ts` `stripSessionUrl` + `implementations/task-linking.ts` `canonicalUrl` | `packages/shared/src/deadline-source-url.ts` `sanitizeSourceUrl` | 265 | 20（与下一行共用） |
| `browser-extension/read-policy.js` `canVisit` + `providerSpecs` | 同上，`isReadOnlySourceUrl` / `READ_ONLY_POLICIES` | — | — |
| **小计** | 1 个源文件 | **265** | **20** |

这两段是本轮「投入产出比最高」的合并：上游把它们写死在采集链路里，我们抽成纯函数，
于是**采集器还没写**就已经能测、能复用（服务端落库前清洗 `sourceUrl` 也用它）。

### 2.3 campusMate

| 上游 | 我们 | 行数 | 测试 |
| --- | --- | --- | --- |
| `backend/services/campus/assignments.py`（`section` / `historical` / `availability` / `term_rank`） | `packages/shared/src/deadline-section.ts` | 307 | 26 |
| **小计** | 1 个源文件 | **307** | **26** |

### 2.4 汇总

| 项目 | 新文件 | 源码行 | 测试数 |
| --- | --- | --- | --- |
| 秦QIN | 4 | 2028 | 130 |
| AgenticCampus | 1 | 265 | 20 |
| campusMate | 1 | 307 | 26 |
| **合计** | **6** | **2600** | **176** |

测试文件同样 6 个（1727 行），与被测模块一一对应：

```
packages/shared/src/
├── deadline-parse-html.ts          839    deadline-parse-html.test.ts          405
├── deadline-parse-gradescope.ts    396    deadline-parse-gradescope.test.ts    312
├── deadline-parse-blackboard.ts    434    deadline-parse-blackboard.test.ts    356
├── deadline-parse-eams.ts          359    deadline-parse-eams.test.ts          230
├── deadline-section.ts             307    deadline-section.test.ts             225
└── deadline-source-url.ts          265    deadline-source-url.test.ts          199
```

---

## 3. 出处是怎么保留的

每个文件的**第一段注释**都是标准形状，任何人（包括法务）都能只看文件头就回答
「这代码哪来的、谁同意的、改了什么」：

```ts
/**
 * 课程 DDL · Gradescope 页面解析（三端共用）
 *
 * ## 出处（合并声明）
 *
 * 移植自 **秦QIN** 的 `src/plugins/builtin/academic/parsers.ts`
 * （`gradescopeCourses` / `gradescopeAssignments`）。来源项目：秦QIN
 * （`dev.matrix.shell`，2026 上海科技大学黑客松参赛组）。
 * 合并授权：项目负责人唐志昊确认三个参赛项目已同意合并。
 *
 * 按我们的标准重写，**不是**逐行复制： …
 */
```

每个文件末尾还有一张「与上游实现的差异」表（§4 汇总），避免后人把我们的收紧当成
上游的行为，或者反过来把上游的坑再抄回来。

**审计命令**：

```bash
grep -l "合并声明" packages/shared/src/deadline-*.ts        # 6 个文件
grep -n "合并授权" packages/shared/src/deadline-*.ts        # 授权出处
git log --follow --format='%h %s' -- packages/shared/src/deadline-parse-eams.ts
```

---

## 4. 与上游的实现差异（逐条，为什么）

### 4.1 通用

| 上游行为 | 我们的做法 | 原因 |
| --- | --- | --- |
| 失败 `throw new Error('未识别…')` | 返回 `Result<T, DeadlineParseFailure>`，带 `code` + 可上屏的 `message` | 调用方要能分辨「登录过期 / 模块没加载 / 平台改版」；一个异常只能给一句话。这也与 09 文档记录的「校验返回 issue 列表，不抛异常」一致 |
| 无类型 / 隐式 `any` | 全显式类型、`readonly` 结构、`noUncheckedIndexedAccess` 下通过 | 仓库 tsconfig 就是 strict |
| 自己实现 `localDate()`（Intl 往返迭代） | 复用 `deadline-normalize` 的 `parseDueText`（44 条测试） | 时区/DST 逻辑只留一份。我们只负责把平台原文**规范化**成它认得的写法 |
| 页面结构靠 `[...html.matchAll()]` 一把梭 | 抽出 `scanTag` / `collectAnchors` 显式扫描，属性读取支持无引号、引号内 `>` | 上游 `attr()` 在 `title="a>b"` 上会截断 |
| `text()` 不处理缺分号实体 | 读取层放宽（`&#160`、`&amp` 也认），粘贴层保持严格 | 平台页面真实存在缺分号实体；粘贴解析不能因此变松 |
| 同位置多条规则命中取先到的 | 取**最长**的 | `2026-10-20 23:59` 同时命中「机器时间」和「纯日期」，取短的会丢时间 |
| 中文时段只认 `上午/下午` | 认 `上午/早上/凌晨/中午/下午/晚上`，12 点按 AM/PM 规则归零 | `晚上 8:00` 是真实写法；`上午 12:30` 是 00:30 不是 12:30 |

### 4.2 Gradescope

| 上游 | 我们 | 原因 |
| --- | --- | --- |
| 迟交日期用 `times[1]` 兜底 | **只有页面明确写了 `Late Due Date`** 才给 `lateDueAtIso` | 第三个 `datetime` 可能是别的字段，会把迟交日期算错 |
| 课程去重 `if(!rows.has(id)||term)`（有学期就覆盖） | 按 **学期 2 分 + 卡片结构 1 分** 打分，高分留下 | 侧栏纯文本链接会「继承」上一个学期标题，按上游规则会把 Dashboard 卡片的课程名冲成侧栏短名（本轮测试发现的真实回归） |
| 截止取 `dueTag ?? times[0] ?? 单元格文本` | `dueTag` → 切掉迟交段后**最后一个**日期 → 最后一个非 `releaseDate` 机器时间 → `null` | `times[0]` 常是**发布**日期，取错会早好几天 |
| 标题 `slice(0,200)` | 同样截断，但空标题退化成 `Assignment <id>` | 避免空标题行 |

### 4.3 Blackboard

| 上游 | 我们 | 原因 |
| --- | --- | --- |
| 用 `try/catch` 判断「课程列表解析失败 → 是否为空列表」 | 显式三态：`module-missing` / `module-loading` / 空数组 | 异常既区分不了三种情况，也会吞掉真正的 bug |
| `blackboardAssignment` 返回 `null` 表示「不是作业页」 | 保留，但文档写成三态（作业 / 不是作业页 / 解析失败） | 调用方会遍历整站内容，非作业页是常态 |
| 标题取「第一个非隐藏 h1/h2」 | 先取 `id="pageTitleHeader"`，再取第一个可见 h1/h2 | 内容区的小标题会抢在前面（测试覆盖） |

### 4.4 EAMS

| 上游 | 我们 | 原因 |
| --- | --- | --- |
| `jsStrings` 正则读字面量 | 改为显式字符扫描，支持 `\uXXXX` / `\xXX` / 常见转义，遇未闭合**丢弃**该条 | 正则版在转义引号上会错位；半截源码不能当数据 |
| 块级 `throw` 直接中断 | 任何一处结构不符 → 整体失败（仍不返回部分结果） | 半张课表比旧课表危险：学生会以为那门课取消了 |
| `weeks.includes(0)` 判「基准不明」 | 保留，并补注释说明为什么首字符为 `1` 就整体拒绝 | 周次错位一周 = 按错的周去上课 |
| 星期坐标不校验 | 越界（`>7`）即失败 | 静默丢弃会少一节课 |

### 4.5 campusMate（五分区）

| 上游 | 我们 | 原因 |
| --- | --- | --- |
| `availability` 缺失归一成 `unknown`，`unknown != open` → `ended` | **调用方不给 `availability` 时不拿它判**，按截止时间判 | 我们的契约没有这个字段；照搬会让**所有**条目落进 `ended` |
| `semester()` 查它自己的学分制元数据 | 只解析 `Fall 2026` / `2026-fall` / `2026-秋` 这类标签，认不出返回 `null` | 不引入它那套元数据依赖；认不出就不排名，退化为学期起始日判据 |
| 服务端函数、依赖 Store | 纯函数，`now` 必传 | 可测、三端共用 |
| `filter_issues` / 手动覆盖读写 | 不移植 | 与我们契约的手动覆盖设计不同，见 §5 |

### 4.6 AgenticCampus（链接清洗 / 只读白名单）

| 上游 | 我们 | 原因 |
| --- | --- | --- |
| `stripSessionUrl` 不安全就 `throw ApiError(422)` | 返回 `null` | 一条脏链接不该让整批入库失败 |
| 主机白名单写死在扩展里 | 默认策略表 + 可注入（`isReadOnlySourceUrl(url, platform?)`） | 测试、校内镜像、将来别的学校都要能换 |
| BB 查询参数**逐条白名单**（`myGrades` / `streamViewer` / `uploadAssignment`） | 只做「动作参数 + 危险词 + 路径形状」，**不**做逐参数白名单 | 逐条白名单太紧，门户改一次参数名就把正常页面全挡掉；等采集器落地、有实测抓包再收紧（文件末尾已记 TODO） |

---

## 5. 有意**不**合并的部分

### 5.1 分类

| 类别 | 含义 |
| --- | --- |
| **授权范围外** | 不在三个同意合并的项目里，且许可不明确（如 `/tmp` 里的 NextDDL） |
| **架构冲突** | 合并进来要改我们的构建/运行时，或与「小程序 + 纯函数共享层」的形态冲突 |
| **平台/合规** | 违反平台规则、涉及他人内容、或需要不可审计的本机权限 |
| **质量不达标** | 无类型、无测试、且改写成本高于自己写 |
| **依赖代价** | 需要引入新依赖，而收益不匹配 |

### 5.2 秦QIN 没合并的

| 上游 | 类别 | 原因 |
| --- | --- | --- |
| `src/plugins/builtin/academic/connectors.ts`（135 行） | 架构冲突 | 它把「打开平台页面 + 取 HTML」绑在 Capacitor WebView 上；我们的采集端是浏览器扩展（08 文档 D2 裁决）。真正要复用的是**解析**，不是取数 |
| `academic/model.ts`（117 行） | 架构冲突 | 它的 `AcademicCourse` / `Assignment` 是插件内部的 wire 类型；我们用 `@kedaya/contracts` 的 `DeadlineItem` + 平台行类型，避免第三套模型 |
| `academic/projection.ts` / `simulate.ts`（277 行） | 质量不达标 | 演示数据生成器，与产品无关 |
| `src/core/plugin-host.ts` / `external-plugins.ts` / `sandbox-runtime.ts` / `slot-resolver.ts` …（`src/core` 20+ 文件） | 架构冲突 | 这是一整套**第三方插件宿主**（权限、沙箱、槽位、审计）。09 文档认为它的「权限 vs 信任正交」值得学，但落地它要改我们的模块表与构建链，属于独立立项，不是这一轮 |
| `src/plugins/builtin/importer-ics/` | 重复 | 我们已有 `deadline-ics.ts`（14 条测试，含时区与转义） |
| `src/platform/android-widget.ts` / `widget-data.ts` / `widget-sync.html` | 架构冲突 | 安卓桌面小组件；我们是 Taro 小程序，没有对应宿主 |
| `src/platform/academic-reminders.ts` | 架构冲突 | 依赖它自己的通知插件（`@matrix/capacitor-notify`） |
| `src/core/academic-service.ts` / `academic-transport.ts` / `app/academic-term.ts` | 架构冲突 | 插件宿主的装配层；我们的编排在 `services/api` 与 `apps/*`，不重复造 |

> 秦QIN 的**插件契约**（09 文档记录的 `packages/plugin-api/src/v1/`，10 文件 / 2919 行）
> 这次还原出来的 map 里**没有**（它被打进了另一个 chunk，本次 11 个 map 中不含）。
> 即便有，本轮也不合并 —— 理由同上：那是插件系统，不是解析器。

### 5.3 AgenticCampus 没合并的

| 上游 | 类别 | 原因 |
| --- | --- | --- |
| `browser-extension/`（MV3 扩展全套：`background.js` / `collector.js` / `identity-collector.js` / `popup.*`） | 架构冲突 | 08 文档 D2 已裁决「本轮不做扩展」；它是独立工程（有自己的构建、存储、权限模型）。我们先把**策略函数**拿过来，扩展落地时直接用 |
| `implementations/server-browser.ts` + `campus-web-auth.ts`（服务端隔离 Chromium 代登录） | 平台/合规 | 06 文档 §2.4.4 的结论不变：服务端会见到明文密码、保存可重放的登录态。授权变了，**架构判断没变** |
| IMAP 全量归档（`imap-connection.ts` / `mail-archive.ts` / `mail-read-writer.ts`） | 依赖代价 + 平台/合规 | 需要 `imapflow` + `mailparser`；且它默认写回 `\Seen`，还全量归档所有文件夹 —— 隐私与存储责任我们没准备好 |
| 凭据库（`credential-vault.ts`，AES-256-GCM） | 依赖代价 | 只在「服务端存凭据」的前提下需要，前提已被否掉 |
| `implementations/assignment-policy.ts` / `task-linking.ts` 的冲突合并 | 架构冲突 | 它有 `dueConflicts` / `submissionConflicts` / alias 合并的完整模型；我们的契约是 `submitted: boolean`，要先改冻结契约才能承载。本轮只在 `deadline-section` 里落了「冲突不静默选边」的**精神**（分区分开 + 未知不催交），不搬模型 |
| `android/` / `Dockerfile` / `deploy/` | 架构冲突 | 部署形态不同 |
| 995 项回归测试 | 质量不达标（对我们而言） | 测试它自己的实现，不覆盖我们重写后的行为 |

### 5.4 campusMate 没合并的

| 上游 | 类别 | 原因 |
| --- | --- | --- |
| `modules/group-messages/server/native/`（微信 SQLCipher 解密、进程内存抓密钥；QQ/NapCat） | 平台/合规 | 06 文档 §3.3 的结论不变：读群内他人内容、绑定 Windows 与客户端版本、很可能违反平台规则。授权解决版权，不解决平台规则与 PIPL |
| `data/places.json` / `data/walking-network.json` / `doctoral-footprints-source.json` | 授权范围外 | 数据文件的授权与代码授权是两件事（OSM ODbL、校方地图未确认）。我们已有的 OSM 链路（`b6fe7b2`）继续用 |
| `backend/`（FastAPI 服务端、IDS/CAS 登录、ELRC/ecourse 抓取） | 架构冲突 | 我们是 NestJS + Taro 小程序；它的服务端形态（本机单用户）与我们多端不一致 |
| `web/`（前端主题、vendor 资源） | 架构冲突 | 设计语言不同；vendor 资源各自有许可，没必要搬 |
| `modules/deadlines/`（DeepSeek Harness 插件：只做排序） | 重复 | 我们有 `sortByUrgency` |
| `checks/` / `scripts/`（它自己的验收脚本） | 质量不达标 | 绑死在它的目录结构上 |

### 5.5 `/tmp` 里另外两份 tarball：评估了，没合并

工作期间在 `/tmp` 发现两个与 DDL 相关的压缩包（不是本次授权的三个项目）：

| 包 | 事实 | 裁决 |
| --- | --- | --- |
| `NextDDL.tgz`（`NextDDL-main`） | Next.js + PostgreSQL 的 DDL 聚合站；**无 `LICENSE` 文件、`package.json` 无 `license` 字段**，只有 README 里写了一句「License MIT」 | **不合并**。不在授权范围，且「README 自称 MIT」不等于有效许可（缺许可证正文与版权声明）。如要用，先向作者确认并补 LICENSE |
| `EAMS-Course-Scraper.tgz` | `console.js`（174 行），MIT，版权人 **Geek Pie Association @ ShanghaiTech University**；在 EAMS 选课页控制台里翻页抓课程列表并导出 JSON | **本轮不合并**，但许可清晰、可用。它的形态是「粘贴到控制台跑的 DOM 脚本」，与我们「纯函数解析 HTML」的架构不同；它解决的「翻页」属于采集器（下一轮）。记录在此，避免重复调研 |

---

## 6. 质量线证据（真实输出）

### 6.1 类型检查

```console
$ npm run typecheck -w @kedaya/contracts
> @kedaya/contracts@0.1.0 typecheck
> tsc --noEmit -p tsconfig.json
（无输出 = 通过）

$ npm run typecheck -w @kedaya/shared
> @kedaya/shared@0.1.0 typecheck
> tsc --noEmit -p tsconfig.json
（无输出 = 通过）
```

### 6.2 测试

```console
$ npm run test -w @kedaya/shared
 ✓ src/deadline-parse-html.test.ts (63 tests)
 ✓ src/deadline-parse-gradescope.test.ts (20 tests)
 ✓ src/deadline-parse-blackboard.test.ts (27 tests)
 ✓ src/deadline-parse-eams.test.ts (20 tests)
 ✓ src/deadline-section.test.ts (26 tests)
 ✓ src/deadline-source-url.test.ts (20 tests)
 …（既有 13 个测试文件全部通过）
 Test Files  19 passed (19)
      Tests  534 passed (534)
```

```console
$ npm run test -w @kedaya/contracts
 Test Files  11 passed (11)
      Tests  196 passed (196)
```

| 包 | 合并前 | 合并后 | 变化 |
| --- | --- | --- | --- |
| `@kedaya/shared` | 358 | **534** | **+176**（全部来自本轮新增的 6 个测试文件） |
| `@kedaya/contracts` | 195 | **196** | +1（**不是本轮**：并行工作的 `campus-poi.test.ts` 在 `24fa29b` 里加的） |

> 测试数只增不减，没有任何既有测试被删改。`git diff` 里也没有对
> `packages/shared/src/deadline-{normalize,paste,html,ics}*.ts` 的任何改动。

### 6.3 没有做的事（诚实清单）

- **没有对真实平台验证**。三家平台都需要登录，本轮不抓取、不带凭据。
  所有夹具是**手工构造**的结构等价样本。因此这些解析器对真实页面结构的匹配度
  **仍是未确认的**（见 §8）。
- **没有跑 lint**：`packages/shared` 没有 `lint` 脚本（`turbo run lint` 不覆盖它），
  所以「lint 通过」这句话对本包不成立；可替代的质量证据是 `tsc --strict` + 176 条测试。
- **没有改 `packages/shared/src/index.ts` / `package.json`**：写作用域限定为「新增
  `deadline-*.ts`，别改已有的」。接线方式见 §7.1（3 行代码，留给 Lead 或下一轮）。

---

## 7. 接线：下一步要做的三件事

### 7.1 包入口（必须，否则外部包拿不到）

`packages/shared/package.json` 的 `main` 指向 `src/index.ts`，所以只在 `index.ts` 追加：

```ts
export * from './deadline-parse-html';
export * from './deadline-parse-gradescope';
export * from './deadline-parse-blackboard';
export * from './deadline-parse-eams';
export * from './deadline-section';
export * from './deadline-source-url';
```

> 注意重名风险：`deadline-parse-html` 导出 `htmlText`、`readSubmissionState`、
> `SUBMISSION_STATES`，与既有模块**没有**重名（已检查）。若将来出现重名，
> 改为具名导出而不是 `export *`。

### 7.2 契约缺口（下一轮再定，本轮不动冻结契约）

新的分区/判据用到了契约里没有的三个字段：

| 字段 | 缺它的后果 | 建议 |
| --- | --- | --- |
| `availability: 'open' \| 'scheduled' \| 'closed' \| 'unknown'` | 无法区分「来源已关闭」与「只是过了截止」 | 加进 `DeadlineItem`（可选）；`deadline-section` 已经支持，缺省时不判 |
| `score: number \| null` | 无法区分「已提交待出分」与「已评分」 | 同上 |
| `submissionEvidence` / `checkedAt` | 无法给用户看「这条是怎么判的」 | 采集器落地时一起定 |

本轮**不**改 `packages/contracts/src/deadlines.ts`：它是 00-FROZEN-CONTRACT 的一部分，
改它要单独评审。`deadline-section` 用结构类型（`DeadlineSectionInput`）接收，
`DeadlineItem` 可以直接传进来 —— 契约不加字段也能用，只是少一个信号。

### 7.3 采集器落地时

- 打开页面前先过 `isReadOnlySourceUrl(url, platform)`；不通过就跳过并记 `reason`；
- 入库前用 `sanitizeSourceUrl(item.sourceUrl)` 清洗（服务端也做一次，别只信客户端）；
- 解析结果喂给 `mergeDeadlines` → `classifyDeadlineSection` / `partitionDeadlines`；
- 抓取失败时**保留上次结果**并标 `stale`，不要用空数组覆盖（契约已要求）。

---

## 8. 风险与未确认

### 8.1 提交状态（必须让 Lead 知道）

本轮**没有** commit / push。但工作期间有并行提交推进 HEAD：

```
4af1a6f  （本轮开始时的 main）
f6c5d49  feat(auth): 真实统一身份认证（CAS）…
24fa29b  feat(poi): 合并「上科大一图通」授权照片…   ← 该提交用了 git add -A
```

`24fa29b` 的 `git show --stat` 里包含了本轮的 5 个文件
（`deadline-parse-html.ts` / `.test.ts` / `-blackboard.ts` / `-eams.ts` /
`-gradescope.ts`），也就是**并行伙伴的提交把我的文件一起带进去了**。
其余 7 个文件（`deadline-section*`、`deadline-source-url*`、
`deadline-parse-{blackboard,eams,gradescope}.test.ts`）以及
`deadline-parse-gradescope.ts` 的后续修改仍在工作区未提交。

这不是我的提交行为，但会影响 review 的范围 —— 请 Lead 按「§2.4 的 6+6 文件」核对，
而不是只看 `git status`。

### 8.2 技术风险

| 风险 | 说明 | 缓解 |
| --- | --- | --- |
| **真实页面未验证** | 三个平台的解析器都只跑过手工夹具。平台改版、灰度、AB 实验都可能让选择器失效 | 解析失败一律「保留上次数据」+ 显式 `code`，不会静默清空；上线后按 `code` 统计失败率 |
| **秦QIN 源码是逆向还原的** | 来自 APK 的 `sourcesContent`，可能与作者最终版本有差异（构建裁剪、压缩变量名等）。本次还原的 `parsers.ts` 与我们 09 文档引用的结构一致，但**无法证明**是最新 | 只把它当「行为参考 + 已授权的表达」；真正的正确性由我们自己的测试定义 |
| **EAMS 周次编码** | `weekBits` 首字符为 `1` 时我们整体拒绝。若学校换了编码（0 起 vs 1 起），会**持续失败**而不是错位 | 宁可失败也不猜错位 —— 这是刻意的取舍 |
| **`ecourse` 白名单** | 路径形状没有实测样本，授权范围也未确认 | 文件里标了 TODO；落地前必须复核 |
| **Gradescope 课程去重规则** | 我们用「学期 + 卡片结构」打分，与上游不同（上游会让侧栏覆盖 Dashboard） | 有测试锁定；若真实页面里卡片没有 `<h*>`/`courseName` 类名，会退化成侧栏名 |
| **授权留档** | 目前是项目负责人确认（口头/消息）。06 文档 §4.1 的事实没变：仓库无 LICENSE | 建议把同意留成书面记录；商用/上架前让法务复核 |

### 8.3 未确认项（需要人回答）

1. 秦QIN 三位作者是否知道「APK 被逆向还原」这件事本身？同意合并是否覆盖「逆向产物」？
2. AgenticCampus 的 `read-policy.js` 里的 BB 逐参数白名单，是否需要在一轮实测后补回来？
3. `DeadlineItem` 是否加 `availability` / `score`（§7.2）—— 这会动冻结契约，需要负责人拍板。
4. 校方对「浏览器扩展读取已登录页面」的态度（08 文档 D2 的遗留问题，本轮没推进）。

---

## 附录 A · 文件 → 上游 → 测试对照

| 我们的文件 | 上游文件 | 上游行数 | 我们行数 | 测试 |
| --- | --- | --- | --- | --- |
| `deadline-parse-html.ts` | 秦QIN `academic/html.ts` + `parsers.ts` 片段 | 125 + ~80 | 839 | 63 |
| `deadline-parse-gradescope.ts` | 秦QIN `academic/parsers.ts`（`gradescope*`） | ~52 | 396 | 20 |
| `deadline-parse-blackboard.ts` | 秦QIN `academic/parsers.ts`（`blackboard*`） | ~68 | 434 | 27 |
| `deadline-parse-eams.ts` | 秦QIN `academic/parsers.ts`（`eams*`） | ~50 | 359 | 20 |
| `deadline-section.ts` | campusMate `backend/services/campus/assignments.py` | 93 | 307 | 26 |
| `deadline-source-url.ts` | AgenticCampus `real/ingest.ts` + `browser-extension/read-policy.js` | ~10 + 35 | 265 | 20 |

> 上游行数按「相关函数」估算，不是文件总行数：秦QIN 的 `parsers.ts` 是 174 行、
> 含 6 个平台函数。

## 附录 B · 复现 `/tmp/qin-src`（下次别再从零开始）

`/tmp` 会被系统清理。还原脚本（只读 APK，不联网）：

```bash
mkdir -p /tmp/qin-apk && unzip -o -q ~/Downloads/Qin-widget-add-fix-preview.apk 'assets/*' -d /tmp/qin-apk
python3 - <<'PY'
import json, os
for m in ["/tmp/qin-apk/assets/public/assets/app-DJHogtSa.js.map"]:   # 3.2 MB，主要 chunk
    d = json.load(open(m))
    for src, content in zip(d.get("sources") or [], d.get("sourcesContent") or []):
        if not content: continue
        p = os.path.join("/tmp/qin-src", src.lstrip("/").replace("..", "_"))
        os.makedirs(os.path.dirname(p), exist_ok=True)
        open(p, "w").write(content)
PY
find /tmp/qin-src -name '*.ts' | wc -l   # 本轮：86（src/**）
```

> APK 位置：`~/Downloads/Qin-widget-add-fix-preview.apk`（18 MB）。
> 若已不存在，秦QIN 部分只能按 09 文档的**设计描述**重做，不能按源码合并。

## 附录 C · 本轮没有碰的东西（自查）

```
apps/**                                       未改
services/api/src/modules/auth/**              未改
apps/miniapp/src/presentation/content/legal.ts 未改
packages/contracts/src/**                     未改（新增也没有，见 §7.2）
packages/shared/src/index.ts                  未改（见 §7.1）
packages/shared/package.json                  未改（零新增依赖）
packages/shared/src/deadline-{normalize,paste,html,ics}*  未改
```

`git status` 里出现 `apps/` 与 `services/` 的改动来自并行工作，不是本轮产物。

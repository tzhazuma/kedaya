# 06 · 先例调研与可复用性裁决

> 调研对象：
> `sagiridsg/AgenticCampus`（下称 **AC**）、
> `David-goldenman/Shanghaitech-2026-Hackthon` / campusMate（下称 **CM**）、
> `https://map.niyiwei.com`「上科大一图通」（下称 **一图通**）。
>
> 调研日期：**2026-10-19**（Asia/Shanghai）。
> 调研基线：任务下发时 `main @ 54dc95a`；写作时工作区 HEAD 为 `6bf7316`
> （并行工作只多了一个 DDL 契约提交，未改本文结论）。
> 性质：**只读调研 + 文档产出**。未改 `apps/`、`services/`、`packages/`；
> 未从 `/tmp/kdy-ref` 复制任何代码、数据文件或素材；未 commit / push。
> 结论文件：本文。配套的轮流计划见
> [08-reference-merge-plan.md](./08-reference-merge-plan.md)。
>
> **免责声明**：许可是法律问题，本文是工程裁决，不是法律意见。
> 商业化、上架应用商店、或向校方批量部署前，请法务复核。

---

## 0. 一页结论

### 0.1 三句话

1. **两个仓库都能“读”，但都不能“抄”。**
   GitHub 公开可见 ≠ 开源；**没有 LICENSE = 保留所有权利**。
   代码不能复制、不能翻译、不能逐行改写，数据文件、UI 文案、素材同样不能。
2. **真正值得学的是“边界设计”，不是功能清单。**
   AC 的「身份绑定 + 只读路由白名单 + 配对令牌 + 密文会话」，
   CM 的「每源统一快照 + 证据字段 + 不猜日期 + 冲突不静默选边」，
   都是可以**独立重新实现**的架构思路。
3. **我们的落地顺序**：
   DDL 契约/归一化（已起步）→ 手动/粘贴/导入 → 官方机器人 →
   条件性浏览器扩展 → 邮件转发/IMAP。
   **不做**服务端代登录、不做微信数据库解密、不抓一图通照片。

### 0.2 四个立刻能执行的裁决

| # | 问题 | 裁决 | 一句话理由 |
| --- | --- | --- | --- |
| D1 | DDL 聚合做成新模块，还是挂 `schedule`？ | **非用户可见的基础设施模块 `/deadlines`**（仿 `group-bot`），不新增第 21 个契约模块 | 不动冻结的 20 模块表；DDL 是跨平台能力，不是课表子域；本地数据不能被 `CampusBindingGuard` 卡住 |
| D2 | 浏览器扩展采集要不要做？ | **本轮不做**；要做也只做“用户主动安装 + 配对码 + 只读 + 不导出 Cookie”的单页导入，不做自动全量同步 | 成本/收益不匹配；ToS 与商店审核未确认；现有手动导入能覆盖早期需求 |
| D3 | 邮件接入走 IMAP 还是转发到我们的地址？ | **优先转发**（若校方支持）；IMAP 只作为显式 opt-in 的备份路径 | 转发不托管学生邮箱密码；IMAP 一旦做，必须是专用密码 + 加密 + 只读 + 有界保留，绝不存校园密码 |
| D4 | 群消息能不能学 CM 的本机微信/QQ？ | **不能**。保留并扩展现有「粘贴解析」+ 官方 QQ / 企业微信机器人 | CM 是 Windows 本机读进程内存 + SQLCipher 解密；服务端不可移植，且违反平台规则、触碰他人通信内容 |

### 0.3 本文回答的四个问题

| 问题 | 对应章节 |
| --- | --- |
| 两个仓库各自实现了什么？ | §2（AC）、§3（CM） |
| 许可与可复用性怎么裁？ | §4（含结论表 §4.5） |
| 我们的架构怎么吸收？ | §5 |
| 哪些看起来诱人但不该做？ | §6；未确认项见 §7 |

---

## 1. 调研范围、方法与边界

### 1.1 读了什么

| 对象 | 读法 | 规模/事实 |
| --- | --- | --- |
| AC 源码 | 只读 `/tmp/kdy-ref/AgenticCampus`，按目录读入口、路由、采集、加密、扩展、数据模型 | **556 个文件**（不含 `.git`）；TypeScript / Fastify / `node:sqlite` / React / Capacitor |
| CM 源码 | 只读 `/tmp/kdy-ref/Shanghaitech-2026-Hackthon`，按模块读 README、server、checks | **467 个文件**；Python 3.12 / FastAPI / 本地 Web / Windows 优先 |
| 一图通 | 浏览器只读访问首页与「美食」页，确认可达、功能词与署名 | 标题「上科大一图通」；页面显示 5 处餐饮、1133 道菜；底部署名校方地图 + OSM |
| 许可证 | GitHub API `repos/{owner}/{repo}` 的 `license` 字段 + 仓库内 `LICENSE*` 实际存在性 | 两个仓库 `spdx_id: None`；无根 `LICENSE` 文件 |
| 依赖许可 | 仓库内随附的许可文件 + npm registry 的 `license` 字段 | 见 §4.3 |

### 1.2 没做什么

- **没有**从 `/tmp/kdy-ref` 复制任何代码、注释、数据文件、图片或 UI 文案。
- **没有**对 Blackboard / Gradescope / Piazza / 学校邮箱发过真实请求。
- **没有**运行两个参考仓库的测试或构建（只读代码与文档）。
- **没有**验证 CM 的微信/QQ 路径在真实课程群、真实 QQ 上的效果；
  CM 自己也写明「尚未在真实课程群验收」。
- **没有**改我们的功能代码；本文的“建议”不是已实现。

### 1.3 证据等级

本文把证据分成三档，正文里尽量标明：

| 档 | 含义 | 例子 |
| --- | --- | --- |
| **A** | 直接读源码/配置文件得到的确定事实 | `browser-extension/manifest.json` 没有 `cookies` 权限 |
| **B** | 仓库 README / 文档的自述，未独立复现 | 「995 项回归测试」 |
| **C** | 外部站点观察或推断，可能变化 | 一图通首页显示 1133 道菜 |
| **未确认** | 没有证据，不猜 | 校方是否允许邮件自动转发 |

### 1.4 基线漂移说明

任务下发时 `main @ 54dc95a`。写作期间并行工作提交了 `6bf7316`
（DDL 契约 + 归一化纯函数 + 测试）。本文引用的我们仓库文件以**写作时工作区**为准；
如果后续文件移动，以 `git ls-files` 的结果为准，不把本文当 API 文档。

---

## 2. AgenticCampus（AC）：能力清单

### 2.1 总览

| 维度 | 事实 |
| --- | --- |
| 形态 | 个人校园工作台：邮件、课程资料、作业/日程、检索、AI 助手；Web + Android（Capacitor） |
| 技术栈 | TypeScript、Fastify、`node:sqlite`（`DatabaseSync`）、React 19 + Vite、Capacitor 8、Playwright、`imapflow`、`mailparser`、`pdfjs-dist`、`tesseract.js`、`chrono-node` |
| 数据来源 | 学校 IMAP（`imap.shanghaitech.edu.cn:993`）、Blackboard（`elearning.shanghaitech.edu.cn:8443`）、Gradescope、Piazza、学校 Coremail 官网 |
| 采集路径 | **三条**：① 浏览器扩展桥（本地/桌面）；② 服务端隔离 Chromium + 远程画面（生产默认）；③ 外部浏览器手动导入 |
| 存储 | SQLite 元数据 + 文件存储（邮件原件 `.eml`、附件、哈希）；加密凭据/会话表 |
| 外部依赖 | 见 §2.2 与 §4.3；关键依赖的许可见 §4.3 |
| 明确边界 | 不绕过验证码/MFA/TLS；不提交作业、不发邮件、不发帖；覆盖率受平台权限、页面结构、附件类型影响 |

### 2.2 模块逐个

> 这里的“模块”按**能力域**分，不等同于 AC 的 `src/modules/*` 文件；
> 后者只是路由/装配入口，真正的实现多在 `implementations/`。

| 能力域 | 实现了什么 | 技术/数据来源 | 外部依赖 | 证据 |
| --- | --- | --- | --- | --- |
| 身份与登录 | 校园邮箱身份；官网登录（密码/验证码/扫码）；账号资料页核对邮箱；会话隔离 | Playwright；Coremail 官网；`mail.shanghaitech.edu.cn` | Playwright + Chromium | `implementations/campus-web-auth.ts`、`docs/DEPLOYMENT.md` |
| 邮件接入 | IMAP 全量归档；文件夹遍历；原始邮件 + 附件；已读状态同步；活动时间识别 | `imap.shanghaitech.edu.cn:993` TLS；`imapflow` + `mailparser` | `imapflow`（MIT）、`mailparser`（MIT）、`chrono-node` | `implementations/imap-connection.ts`、`implementations/real/mail.ts` |
| 平台采集 | Blackboard / Gradescope / Piazza 的课程、公告、作业、资料、讨论 | 用户已登录页面 / 服务端 Chromium | Playwright；扩展的 `scripting`/`storage` | `implementations/server-browser.ts`、`browser-extension/` |
| 统一条目 | `Item`（email/announcement/assignment/slide/discussion）+ `Course` + `Task` + `CalendarEvent` | 本地 SQLite；跨来源 stable id / alias | 无额外服务 | `contracts/types.ts`、`implementations/real/ingest.ts` |
| 作业/日程 | 作业截止、提交状态三态、跨源冲突、任务提醒、日程/课表 | 采集结果 + 规则/时间解析 | `chrono-node` | `implementations/assignment-policy.ts`、`implementations/task-linking.ts` |
| 资料/知识库 | 附件归档、PDF 全页文字、OCR（可选）、关键词/嵌入检索 | `pdfjs-dist`、`tesseract.js`、SQLite FTS/自定义索引 | `pdfjs-dist`（Apache-2.0）、`tesseract.js`（Apache-2.0） | `implementations/real/mail-archive.ts`、`implementations/knowledge.ts` |
| 助手 | 检索 + 引用 + 教学式对话；模型功能默认关闭 | 可选 LLM（`LLM_*`）；未配置时规则回答 | 模型服务（未指定） | `docs/PERSONAL.md`、`docs/CAPABILITIES.md` |
| 客户端 | React SPA；Android 离线 PDF；本地/服务端两种部署 | Vite、Capacitor | React、Capacitor | `package.json`、`docs/ANDROID_BUILD.md` |

### 2.3 深挖 1：IMAP 邮件接入

#### 2.3.1 怎么连

- 固定 host：`imap.shanghaitech.edu.cn`，端口 `993`，`secure: true`，
  `rejectUnauthorized: true`，最低 TLS 1.2；连接/问候/套接字超时分别为 8s/8s/45s。
  （A：`implementations/imap-connection.ts`）
- 认证用**客户端专用密码**，不是校园日常密码。
  AC 的“自动配置”路径是：在官方 Coremail 设置页里点击「客户端专用密码」→ 生成 →
  只从生成结果对话框里读取一次明文；读不到就返回 `null`，不猜、不重试生成。
  （A：`implementations/campus-web-auth.ts` 的 `provisionImapCredential`）
- 也支持手动路径：用户自己在官网生成专用密码，通过邮件授权接口提交；
  服务端用一次 IMAP 登录验证后才算连接成功。
  （A：`implementations/server-auth.ts` 的 `/auth/mail-grant`）
- 失败语义清楚：认证失败 → `needs_auth`；网络/超时 → 有界重试（指数退避 + 抖动，
  上限 5 分钟）；解析失败 → `partial`，已归档原件保留。
  （A：`implementations/real/mail.ts`）

#### 2.3.2 怎么存

- 遍历所有可读文件夹（或仅 INBOX），按 `UIDVALIDITY + UID + 邮箱 + 文件夹` 组成
  `externalId`，避免 UID 复用导致错配。
- **原件优先**：先把完整 `.eml` 流式写入文件存储并计算 SHA-256，再解析正文/附件；
  解析失败也保留原件，后续重试。
- SQLite 存：`mail_messages`（定位、原件哈希、正文、HTML、头、message-id）、
  `archive_attachments`（附件哈希、MIME、disposition）、`mail_folders`（每文件夹进度）、
  `mail_failures`（可重试失败）。
- 已读状态：AC 不只读，它会把本地“已读/未读”写回 IMAP 的 `\Seen` 标志；
  写入前校验 `UIDVALIDITY`、消息仍存在、`PERMANENTFLAGS` 允许 `\Seen`，
  写入后再次 fetch 确认。（A：`implementations/real/mail-read-writer.ts`）
  → **这不是纯只读邮箱集成**，它会改邮箱状态；我们若做，应默认不写。

#### 2.3.3 怎么加密授权

- 算法：**AES-256-GCM**；每条记录随机 12 字节 IV；AAD 绑定 `userId`；
  密文、IV、auth tag 存 SQLite。会话（浏览器 `storageState`）同样处理，AAD 绑定
  `userId + provider`。（A：`implementations/real/credential-vault.ts`、
  `implementations/server-session-vault.ts`）
- 密钥：32 字节 base64；优先 `CREDENTIAL_ENCRYPTION_KEY` 环境变量；
  本机模式下可生成同目录 `.credential-key`（权限 `0600`）；
  服务端模式没有密钥就**拒绝保存**（503），不降级成明文。
- “记住我”是显式选择：不记住时只放内存，不落库；记住时才写 `encrypted_credentials`。
- 这不是“哈希密码”，而是**可逆加密**——IMAP 必须能取回明文去登录；
  这也意味着密钥泄漏 = 邮件授权泄漏，所以密钥必须与数据库分离备份。

#### 2.3.4 值得学 / 不值得学

| 值得学（思路） | 不值得学（实现/边界） |
| --- | --- |
| 只从官方生成结果读一次专用密码；读不到就失败，不猜 | 用 Playwright 自动点学校“安全设置”生成专用密码——脆弱、敏感、等于自动化账号安全设置 |
| 原件先落盘、再解析；解析失败保留原件 | 服务端**全量归档所有文件夹全部历史**——对我们是无底洞的隐私与存储责任 |
| `UIDVALIDITY + UID` 定位，写入后二次确认 | 默认写回 `\Seen`；我们应默认只读 |
| AES-GCM + 每用户 AAD + 密钥缺失 fail closed | 把“密码不保存”当成“密码不经过服务器”（见 §2.4） |

### 2.4 深挖 2：Blackboard / Gradescope / Piazza 采集

#### 2.4.1 先纠正一个流行误解：它不是“只有一个浏览器扩展”

AC 有三种采集模式（A：`implementations/external-browser.ts`、
`implementations/server-browser.ts`、`implementations/real/routes.ts`）：

| 模式 | 触发 | 登录态在哪 | 服务端见到密码？ | 服务端存 Cookie/会话？ | 说明 |
| --- | --- | --- | --- | --- | --- |
| **浏览器扩展桥** | `PLATFORM_SYNC_MODE=extension`（且没有服务端采集器） | 用户自己的浏览器 | **否** | **否**（只收页面提取物/附件字节） | 适合本机/桌面；生产默认不是它 |
| **服务端远程浏览器** | `SOURCE_LOGIN_MODE=remote-browser`（**生产默认**） | 服务端隔离 Chromium | **是**（用户把密码输入到服务端页面；进程内存可见） | **是**，AES-GCM 加密的 `storageState` | 官网页面流式传给用户；不保存日常密码 ≠ 不经过服务端 |
| **服务端密码代登录** | `SOURCE_LOGIN_MODE=server-password` + 配置允许的平台 | 服务端 Chromium | **是**（API 收密码，代填） | **是**，加密 | 只对显式允许的平台；风险最高 |
| **外部浏览器手动导入** | `SOURCE_LOGIN_MODE=external` | 用户自己的浏览器 | 否 | 否 | 最低风险，但 UX 最差 |

> 因此，回答“它读的是用户的 Cookie 还是服务端重放密码？”——
> **扩展路径两者都不是**：它不读 Cookie，也不收密码，只是在用户已登录的标签页里执行脚本；
> **生产默认路径是服务端实时登录**：用户在服务端浏览器里输入密码，服务端必然在内存里处理明文，
> 然后加密保存会话 Cookie；**server-password 路径才是真正的“服务端代填密码”**。

#### 2.4.2 `browser-extension/` 到底怎么工作

**权限（A：`browser-extension/manifest.json`）**

- `permissions`: `storage`、`scripting`、`alarms`。
- **没有** `cookies`、`webRequest`、`tabs`、`history`、`downloads`。
- `host_permissions` 只有 `http://127.0.0.1:7310/*`。
- `optional_host_permissions` 列出了三个平台，还额外写了 `https://*/*`；
  但 popup 实际只请求三个平台的精确 origin（A：`browser-extension/popup.js`）。
  → 这是一个值得警惕的“宽 optional 声明”，我们若做应删掉 `https://*/*`。

**同步循环（A：`browser-extension/background.js`）**

1. 从 `chrome.storage.local` 取 `token` / `serverOrigin` / `expectedEmail`。
2. 每 15 分钟（`chrome.alarms`）跑一轮；每轮最多 3 个平台轮转，单平台最多 60 页（可配 10–120），
   单轮 50 秒上限；失败保留 frontier（队列/已访问），下次继续。
3. 为平台开一个**后台标签页**，先跳到“本人账号资料页”，执行 `collectIdentity`，
   从资料页读出邮箱，和 `expectedEmail` 比对；不一致直接 `ACCOUNT_MISMATCH`，**不采集本页**。
4. 再按 `read-policy.js` 的白名单遍历课程页面；每页 `collectPage` 提取文本/标题/链接/附件候选。
5. 每次上传前**再次**核对资料页邮箱，防止采集途中切换账号；上传的是提取物，不是 Cookie。
6. 附件通过 `chrome.scripting.executeScript` 在页面上下文里 fetch（浏览器自动带 Cookie），
   转成 base64 上传；单附件 ≤ 3 MB，只收 PDF/TXT/MD/CSV/IPYNB/PPTX/DOCX/ZIP 等。
7. `captureBatches` 每 100 条一批；`/bridge/batch` 落库并记录 `platform_receipts`；
   `/bridge/status` 回报 `syncing/connected/needs_auth/error`。

**只读白名单（A：`browser-extension/read-policy.js`）**

- 只允许 https、精确 host；Blackboard 额外允许 8443。
- 拒绝 `logout/signout/delete/remove/create/submit/submissions/grading/gradebook/roster/manage/edit/settings/password/reset/...`。
- Blackboard 只放行课程页、公告、内容页、My Grades 等已知只读视图；
  TA/instructor 角色的课程直接不采。
- Gradescope 只放行 `/courses/:id`、`/assignments/:id`、`/account`；
  Piazza 只放行 `/class`、`/class_profile`、`/resources`，并单独禁止 `get_resource` 直链。
- 这些是**按 URL 形状的 allowlist**，不是“读到什么算什么”。这是最值得学的部分。

**身份绑定（A：`browser-extension/identity-collector.js`）**

- 只在“本人账号资料页”读邮箱；不读邮件正文、不读登录输入框、不读课程正文里的邮箱。
- 支持 `primary` / `account-email` 两类证据；多个候选就不选（`null`），不猜。
- Blackboard 还检查会话过期、重新登录错误页；Piazza 检查登录弹窗。
- 资料页邮箱与目标邮箱不一致 → 停止；同一页采集前后各核对一次。

**配对码机制（A：`implementations/real/routes.ts`）**

```
用户在网页「设置 → 来源连接」点“生成配对码”
  → POST /api/v1/personal/browser/pairing
  → 服务端删掉该用户旧 pairing
  → 生成 24 字节随机 code（base64url，192 bit）
  → 只存 SHA-256(code)，TTL 10 分钟
  → 返回 code + expiresAt

扩展 popup 填 code + 服务器首页 URL
  → POST /api/v1/bridge/pair { code }
  → 服务端按 SHA-256(code) 查 pairing，校验未过期
  → 生成 32 字节 token（256 bit），只存 SHA-256(token)，TTL 30 天
  → 删除 pairing（一次性）
  → 返回 token + expectedEmail + accountId + identityRequired:true

之后每个 /bridge/* 请求：
  Authorization: Bearer <token>
  → 服务端按 token 哈希查 bridge_sessions，得到 userId
  → /bridge/commands 再返回 expectedEmail，扩展核对“配对账号没变”
  → 撤销：删除 bridge_sessions + bridge_pairings
```

- 安全性质：码短寿命、一次性、只存哈希；token 长寿命、可撤销、绑定用户；
  扩展必须在配对响应里拿到 `expectedEmail` 和 `identityRequired:true`，否则拒绝启用。
- 弱点：token 存在 `chrome.storage.local`（不是系统钥匙串）；30 天有效期偏长；
  扩展一旦被恶意代码/供应链攻破，token 可被用来持续导入数据（但只能导入，不能反向控制平台）。
- 服务端还检查每个 batch 的 `identity`（`checkPlatformIdentity`），并写
  `platform_receipts`（哪个邮箱、何时观察、对应 item）。这是“导入可追溯”的关键。

#### 2.4.3 它抓什么、不抓什么

| 抓 | 不抓 |
| --- | --- |
| 课程页/公告/作业列表/资料页/讨论帖的**可见文本** | 密码输入框、Cookie、`localStorage`、页面 JS 状态 |
| 标题、正文、链接、附件候选 | 提交作业、发帖、发邮件、改设置、改成绩 |
| 本人资料页的邮箱（仅用于身份核对） | 课程正文里的邮箱（防止误认） |
| 已发现入口里的附件字节（≤3 MB） | 未发现入口、跨站附件、未登录/无权限内容 |

#### 2.4.4 生产路径的额外风险（我们要引以为戒）

- 服务端 Chromium 的 `storageState` 就是**可重放的登录态**；加密只解决“静态泄漏”，
  不解决“服务端被攻破/内部人读取”。AC 用 AAD、按用户隔离、密钥分离来降低影响，
  但风险等级仍高于扩展路径。
- 服务端要能访问学校/平台；网络出口、代理、验证码、MFA 都会成为运营问题。
- `PIAZZA_PROXY_URL` 说明 Piazza 可能需要代理；代理本身也是信任边界。
- 所以：**AC 的扩展路径可以学，AC 的服务端路径不要学。**

### 2.5 统一条目、去重与时间处理（值得学的数据模型）

AC 的 `contracts/types.ts` 把“来源证据”和“可执行任务”分开：

- `Item`：平台上的原始条目（email/announcement/assignment/slide/discussion），
  带 `sourceExternalId`、`sourceUrl`、`publishedAt`、`attachmentLinks`、`bodyText`。
- `Task`：可执行的截止事项，带 `dueAt`、`timezone`、`submittedState`（三态）、
  `sourceItemIds[]`、`dueConflicts[]`、`requiresAction`。
- `CalendarEvent`：日程/课表；截止事项是 Task 的投影，不重复造 Event。
- `Connection`：每个来源的 `status`（pending/connected/syncing/needs_auth/error）、
  `lastSyncedAt`、`syncScope`、`errorMessage`。

值得学的具体做法：

1. **稳定 ID + alias**：来源 ID 不是永远稳定（BB 的 content id 与 grade id 可能是两条记录），
   用显式 alias 合并，不靠标题猜。
2. **提交状态冲突不静默选边**：两个平台一个说已交、一个说未交 → 状态置 `unknown`，
   把冲突双方和观察时间都留下。
3. **提交状态未知时不要催交**：`requiresAction` 只有在“开放 + 明确未提交/未知规则允许”时才为真；
   不确定就不打扰。
4. **due 冲突保留**：`dueConflicts` 记录另一个来源给的截止时刻，不覆盖主值。
5. **URL 去会话参数**：入库前剥掉 `sid/session/token/auth/ticket/secret/code` 等 query/hash，
   避免把登录态写进数据库。
6. **低质量捕获拒绝**：`unreliableCapture` 在入库前拦截残缺/导航页/错误页，避免污染。
7. **来源回执**：`platform_receipts` 记录“哪个邮箱在何时看到这条”，用于审计与增量。

### 2.6 AC 的明确局限

- 没有 Blackboard 官方 REST 3LO（需要学校注册应用/管理员启用），走的是页面适配器；
  平台改版就会失效。
- 覆盖率受权限、分页、跨站附件、会话过期影响；它自己也不宣称“平台全量备份”。
- 模型功能默认关闭；OCR 需要额外语言资源；扫描件不保证可读。
- 服务端路径需要 Linux Chromium 运行环境；Docker/公网部署在它的文档里仍标注未验收。

---

## 3. campusMate（CM）：能力清单

### 3.1 总览

| 维度 | 事实 |
| --- | --- |
| 形态 | **本地**校园工作台（Windows 优先）；FastAPI 本地 Web；模块化插件；AI 助手 |
| 技术栈 | Python 3.12、FastAPI、httpx、BeautifulSoup、Pydantic、cryptography、zstandard、defusedxml、pypdf/pypdfium2、DeepSeek Harness SDK |
| 数据来源 | 学校 IDS/CAS、Blackboard、Gradescope、Piazza、EAMS 教务、ELRC、E 云课堂、学校邮箱、校园地图、本机微信/QQ |
| 模块 | **19 个**（`modules/`）：academic-assistant、assignments、assistant、blackboard、campus-agent、campus-map、courses、dashboard、deadlines、eams、ecourse、education、elrc、gradescope、group-messages、mail、notifications、piazza、timetable |
| 存储 | 本地 Store + `vault.dpapi`（Windows DPAPI 保护）；不上云 |
| 外部依赖 | 见 §4.3；关键：`shanghaitech-ids-passkey`（MIT）、OSM（ODbL）、Font Awesome/Markdown-it |
| 明确边界 | 本机、单用户、Windows 优先；校园地图是估算；群消息只读本机已下载数据 |

### 3.2 模块逐个

| 模块 | 能力 | 数据来源 | 技术/依赖 | 证据 |
| --- | --- | --- | --- | --- |
| `auth`（框架） | IDS 登录、服务连接、设备凭据、会话恢复 | 学校 IDS/CAS | `shanghaitech-ids-passkey`、httpx、Playwright（验证窗口） | `backend/services/auth/` |
| `blackboard` | 课程、内容树、资料、作业、成绩、公告 | Blackboard REST + 门户 HTML | httpx + BeautifulSoup | `modules/blackboard/server/reader.py` |
| `gradescope` | 课程、作业、题目、提交状态/评分 | Gradescope HTML | httpx + BeautifulSoup | `modules/gradescope/server/reader.py` |
| `piazza` | 课程发现、帖子/回复、资源目录 | Piazza JSON/HTML | httpx + 页面 JSON 解析 | `modules/piazza/` |
| `eams` | 考试、培养方案、课程目录、教学大纲 | 教务系统 | IDS 会话 + HTML | `modules/eams/` |
| `elrc` / `ecourse` / `education` | 虚拟教学社区、E 云课堂、培养方案 | 学校平台 | IDS 会话 | `modules/elrc/`、`ecourse/`、`education/` |
| `mail` | 邮件分类、正文、日/周总结、IMAP 收信 | 学校 IMAP / 网页会话 | imaplib、`BODY.PEEK` | `modules/mail/`、`backend/services/auth/imap.py` |
| `courses` | 跨平台课程合并、内容分类、`/context` 给 AI | 各模块公开快照 | FastAPI | `modules/courses/server/catalog.py` |
| `assignments` | 作业统一状态、五分区、截止/提交证据 | Gradescope/Blackboard/ecourse | Python | `modules/assignments/`、`backend/services/campus/assignments.py` |
| `dashboard` | 首页统计、近期截止、通知 | 各模块快照 | Python | `modules/dashboard/server/__init__.py` |
| `deadlines` | **只是 AI 排序插件**（`order_deadlines`） | 调用方传入的 items | DeepSeek Harness 插件 | `modules/deadlines/README.md` |
| `campus-map` | 建筑图、步行路线、当天安排、通行维护 | OSM + 校方地图 + 用户反馈 | 浏览器内路由 | `modules/campus-map/` |
| `group-messages` | 本机微信/QQ 群消息 → 事项候选 | Windows 微信 4 本地库；NapCat/OneBot | ctypes、SQLCipher、zstandard | `modules/group-messages/` |
| `assistant` / `academic-assistant` / `campus-agent` / `notifications` | AI 问答、引用、后台建议、通知 | 各模块公开 API | DeepSeek Harness SDK | `modules/assistant/` 等 |

### 3.3 深挖 3：微信 / QQ 群消息接入

#### 3.3.1 结论先说

CM 的“接入本人本机的微信与 QQ 消息”是真的**本机读取**，不是云端 API，也不是群机器人：

- **微信**：Windows + 微信 4 客户端，读取本机 `db_storage` 里的加密 SQLite；
  从**当前用户运行的 `Weixin.exe` 进程内存**里捕获 SQLCipher 密钥；
  把 DB + 已提交 WAL 复制到私有目录，逐页解密成快照，再按群读取文本。
- **QQ**：要求用户自己安装并登录 **NapCat / OneBot HTTP 服务**；
  CM 只连 `127.0.0.1` 的 HTTP 接口，用 Access Token 认证，只调读取接口。

两者都**不是**官方开放 API；都要求用户先在本机登录客户端。

#### 3.3.2 微信：具体做了什么

| 步骤 | 事实 | 证据 |
| --- | --- | --- |
| 平台 | **仅 Windows**（`os.name == 'nt'`，64 位）；非 Windows 直接拒绝 | `server/native/process.py` |
| 发现 | 扫 `Documents/xwechat_files/*/db_storage`、`APPDATA/Tencent/xwechat/config/*.ini`；只保留当前用户可打开的真实主实例 | `discover_folders`、`discover_processes` |
| 进程校验 | 必须 `Weixin.exe`，必须是当前用户 SID（`OpenProcessToken` + `EqualSid`）；过滤带 `--type` 的 OCR/播放器等辅助进程 | `open_weixin`、`same_user` |
| 密钥捕获 | `ReadProcessMemory` 扫可读内存区，找 `com.Tencent.WCDB.Config.Cipher` 的 `x'…'` 字面量；用 DB 第一页 HMAC 验证候选密钥；**不注入、不调试、不写进程、不提权** | `capture_keys`、`candidates` |
| 解密 | AES-CBC（Windows CNG），逐页校验 HMAC；只接受已提交的 WAL 帧；解密到私有临时目录 | `server/native/crypto.py` |
| 读取 | 只读快照；按 `Name2Id` 找群；只读 `message_*.db` 的已知表；支持 zstd 压缩正文 | `server/native/reader.py` |
| 范围 | 只选用户勾选的群；7/30 天；每群 ≤ 20000 条；单分片 + WAL ≤ 8 GiB；快照 ≤ 512 MiB；每条 ≤ 64000 字符 | `README.md`、`snapshot.py` |
| 版本 | 记录设备版本 **4.1.15.13**；版本变化先暂停，人工确认后恢复；定时器不重新捕获密钥 | `server/native/version.py` |
| 内容 | 文字、引用回复、文件/链接标题；**不读**图片、语音、视频、链接目标、附件正文 | `README.md`、`reader.py` |

**它没有 hook，也没有注入**：它做的是“进程内存读密钥 + 离线解密副本”。
这比注入温和，但仍然：

- 需要微信客户端正在运行、且是当前用户；
- 依赖微信 4 的内部数据库结构/密钥布局，客户端更新就可能失效；
- 读取的是**群内其他成员的通信内容**；
- 很可能违反微信个人账号使用规范（具体条款与执法尺度**未确认**，需法务判断）。

#### 3.3.3 QQ：具体做了什么

- 不直接连 QQ 协议；要求用户自己按 NapCat 文档启动一个本机 HTTP 服务，
  在 NapCat 里登录本人 QQ，设置 Access Token。
- CM 只调用：登录信息、群列表、群历史（最近 100 条/群）。
- 只处理文本、@、回复、文件标题；图片/语音等标记为“未读取”。
- 每轮最多 100 条/群，**没有反向分页补齐**；如果窗口没覆盖上次进度，会保留“可能有缺口”的提示。
- 不发送消息、不安装/启动 QQ 适配器。

#### 3.3.4 真实边界

| 边界 | 说明 |
| --- | --- |
| **平台** | 微信仅 Windows；QQ 需要 NapCat（Windows 为主） |
| **部署** | 只能本机运行；不能放到我们的多用户服务端 |
| **前置条件** | 用户必须已在本机登录微信/QQ；微信还必须能读到进程内存 |
| **稳定性** | 微信版本强绑定（4.1.15.13）；QQ 依赖第三方 NapCat/OneBot 实现 |
| **内容** | 只读已下载到本机的数据；不读媒体；不读未同步历史 |
| **合规** | 微信 DB 解密、读取他人消息、第三方 QQ 客户端，都有平台规则与个人信息风险 |
| **许可** | CM 仓库无 LICENSE；其 native 代码改编自 QJQ，QQ 部分复用 WYT 的代码；`WCDB_LICENSE.txt` 是上游 key-tool 的 MIT 许可，**不覆盖** CM/QJQ 的 native 移植代码 |

> **结论**：CM 的微信/QQ 路径**不可移植到我们的服务端**，也**不建议**做成桌面伴侣；
> 我们只学它“把群消息变成有原文引用的事项、且默认不自动应用”的产品边界，
> 不学它的数据获取方式。

### 3.4 深挖 4：校园地图步行路线

#### 3.4.1 路网数据从哪来

- **OSM**：`data/walking-network.json` 明确写 `source: OpenStreetMap`、
  `license: ODbL-1.0`、`attribution: © OpenStreetMap contributors`；
  原始数据通过 OSM API 的 bbox 下载（`121.5835,31.1745,121.5968,31.1835`，2026-10-17）；
  校园边界取 OSM relation `5390610`；保留真实 OSM node ID；
  WGS84 在离线导入时转 GCJ-02 → BD-09（`coordtransform 2.1.2`，MIT）。
- **建筑轮廓**：`data/places.json` 的 65 个地点（建筑/校门/边界）主要取学校官方地图
  `map.shanghaitech.edu.cn` 的公开数据（BD-09）；博士公寓 11/12/13 号楼另用
  浦东新区 2024-10-24 公示的二期工程 PDF 轮廓，`doctoral-footprints-source.json`
  保存链接、原始顶点、12 个配准点与仿射矩阵（RMS ≈ 0.92 m，仅表示局部吻合，
  不是测绘精度）。
- **电梯**：图书馆/创艺学院 3 条位置说明，来自校方网页，标注“未现场核验”。
- **通行维护**：用户/公告/邮件产生的封路线索，先进入“待核实”，人工确认后才参与避让。

#### 3.4.2 路由怎么算

- 完全在浏览器里算（`web/routing.js`），不发外部请求。
- 只连共享节点；排除校外道路、地下/室内道路、非步行主干道、明确禁止步行路段；
  高架层只保留标记为桥梁的道路。
- 距离最短路径；按 **80 米/分钟**估算时间；不计入进楼与等候；
  路网缺失/断开/地点 60 米内无可用道路时明确提示，**不补画直线**。
- 起点默认取上一项安排，不假设 GPS/当前位置；课程终点保留日期、时间、教室原文；
  跨日期清除课程终点。
- 体育馆按用户反馈把到达/出发限制在西侧，不虚构两个门的坐标。

#### 3.4.3 值得学 / 不能做

| 值得学 | 不能做 |
| --- | --- |
| 用 OSM 真实节点建图，不把底图交叉线当路口 | 直接复制 `walking-network.json` 当我们的数据（即使它标了 ODbL，也应从 OSM 重新抽取并履行 ODbL） |
| 路线只在浏览器算，不上传地点/课程 | 复制 `places.json`（校方地图数据授权**未确认**） |
| 不可达就提示，不画直线；不假设 GPS | 把建筑中心当入口/电梯精确坐标 |
| 通行维护先待核实、后生效 | 抓取一图通的地下车库照片/食堂菜单照片（见 §4.4） |

### 3.5 深挖 5：DDL 聚合——CM 是怎么归一的

#### 3.5.1 关键事实：CM 的 `deadlines` 模块**不是**聚合器

`modules/deadlines/` 只是一个 DeepSeek Harness 插件：输入 `items:[{id,title,due_at}]`，
输出按截止时间排序的 JSON。真正的聚合在：

1. **每个来源模块**把平台数据归一成同一套 `assignments` 记录；
2. **`courses` 模块**把各来源快照合并成课程/内容目录；
3. **`assignments` 模块**做提交状态、分区、默认截止、手动覆盖；
4. **`dashboard`/`notifications`/`assistant`** 消费统一结果。

这是“**每源归一 + 聚合层只读快照**”，不是“一个大爬虫”。

#### 3.5.2 统一记录的关键字段

| 字段 | 含义 | 归一规则 |
| --- | --- | --- |
| `id` | 稳定 ID | `source:平台内部ID`；没有稳定 ID 时用 `digest(title+released_at)`，但不伪造来源 ID |
| `source` | 来源 | `blackboard/gradescope/piazza/ecourse/eams/...` |
| `course_id` | 课程 | 优先平台课程 ID；与聚合课程通过 `course_ids` 关联 |
| `title` / `body_text` | 标题/正文 | HTML 清洗成纯文本；保留原文入口 |
| `due_at` | 截止时刻 | 统一转带时区 ISO；只有日期时不猜午夜 |
| `due_at_evidence` | 截止证据 | `gradebook` / `submission_history` / `manual` / `default` 等 |
| `release_at` | 发布时间 | 平台给才填 |
| `availability` | 开放状态 | `open/scheduled/closed/unknown`，**不用截止时间反推** |
| `actionable` | 是否可行动 | 平台明确可提交/可进入才 true；未知不硬判 |
| `submitted` | 是否已提交 | **三态**：true / false / null |
| `submission_status` | 七态 | `not_submitted/draft/submitted/needs_grading/graded/exempt/unknown` |
| `submission_evidence` | 提交证据 | `gradebook/activity/submission_history/cached/unavailable` |
| `submission_reason` | 判定理由 | 给人看的一句话 |
| `score` / `max_score` | 分数 | 0 分有效；空/破折号不是成绩 |
| `exempt` | 豁免 | 不列入待办 |
| `stale` | 缓存/过期 | 读取失败保留上次结果并标记 |
| `checked_at` | 本次核查时间 | 与 `stale` 一起判断可信度 |

#### 3.5.3 分区与“不猜”

`backend/services/campus/assignments.py` 把每条作业分到五区：

| 区 | 条件 |
| --- | --- |
| `pending` | 本学期、来源开放、未提交/草稿、未过截止 |
| `late` | 本学期、来源开放、未提交、已过截止 |
| `graded` | 已提交且有数值成绩（0 分也算） |
| `completed` | 已提交但无成绩 |
| `ended` | 历史学期，或来源已关闭/未开放/未知 |

关键细节：

- **历史学期优先于来源的“开放”**：旧学期即使来源还显示 open，也归 `ended`，不再提醒。
- **来源关闭/未知 → 不进入待办**；开放但提交状态未知 → 仍可行动，但页面标“待核实”。
- **没有截止时间**：若作业仍开放且可行动，用“第 18 教学周周日 23:59（北京时间）”
  作为**估计**截止，并写 `due_default=true`、`due_source="default"`；
  页面显示“待完成 · 时间待定”，不把它伪装成来源日期。
- **手动覆盖**：`PUT /deadline` 按账号版本保存 `assignment-due:<账号>`，
  返回 `due_source="manual"`；原来源快照不被改写；可恢复默认。
- **跨平台课程合并**：先规范课程代码（空格/横线/大小写），再按代码 + 学期；
  没有代码时，只有“规范化名称 + 学期”唯一对应一个已知代码才自动关联；
  多候选保留独立，交用户手动选择。

#### 3.5.4 值得学 / 不能做

| 值得学 | 不能做 |
| --- | --- |
| 每源统一记录 + 聚合层只读快照 | 复制它的字段表/解析代码；我们要自己定义 wire 契约 |
| 三态提交 + 七态细分 + 证据字段 | 把 `unknown` 当 `false` 去催交 |
| `availability` 与 `due_at` 分离 | 用截止时间推断“已关闭” |
| 历史学期优先 `ended` | 只按 `actionable` 判断，忽略学期 |
| 缺失截止 → 明确标记 estimated/default | 把估计值写成平台日期 |
| 跨平台按课程代码 + 学期合并 | 只按标题合并不同课程 |
| 读取失败保留缓存 + `stale` | 网络失败就显示“已完成/无作业” |

---

## 4. 许可与可复用性裁决（最重要）

### 4.1 法律前提（工程版）

1. **公开仓库 ≠ 开源。**
   GitHub 的 “public” 只表示可访问；没有 LICENSE 时，默认适用著作权法：
   **保留所有权利**。别人不能复制、修改、分发、再许可，也不能做衍生作品。
2. **“代码”包括的不只是 `.ts`/`.py`。**
   注释、命名、目录结构、测试、配置、SQL、UI 文案、图标、图片、数据文件、
   甚至“选择与编排”（selection & arrangement）都可能有著作权。
3. **翻译、转写、逐行改写都是衍生作品。**
   Dart→TS、Python→TS、React→Vue、换变量名但保留结构，法律上都不是“独立实现”。
4. **“我读了，然后自己写”** 通常是可行的，但要有**独立实现过程**：
   先写行为规格（输入/输出/边界/错误），再在不看源码的情况下实现；
   保留设计记录，证明没有复制表达。这就是 clean-room 的基本姿势。
5. **数据库/数据文件可能另有权利。**
   OSM 是 ODbL；校方地图授权未确认；别人整理的菜单/照片是摄影作品 + 数据库。
6. **平台规则与个人信息是第三层。**
   即使版权上能做，读微信本地库、代登录平台、抓群消息，还可能违反平台 ToS、
   《个人信息保护法》/《数据安全法》。这三层要分别过。

> 本节不是法律意见；它给出的是**保守到足以安全开工**的工程边界。

### 4.2 两个仓库的许可证事实

| 仓库 | GitHub API `license` | 根 `LICENSE` | 结论 |
| --- | --- | --- | --- |
| `sagiridsg/AgenticCampus` | `None`（`spdx_id` 为空） | **不存在** | 保留所有权利 |
| `David-goldenman/Shanghaitech-2026-Hackthon` | `None` | **不存在** | 保留所有权利 |

补充事实：

- AC 的 `MANIFEST.json` 只是文件哈希清单，**不是**许可证。
- AC 的 `licenses/whale-maid-CC-BY-NC-SA.txt` 明确说：10 张立绘与派生横幅
  **不适用 MIT**，而用 **CC BY-NC-SA 4.0**。
  这证明作者**知道怎么单独许可素材**；但它**不能反推代码是 MIT**。
  没有代码 LICENSE 就是没有授权。
- CM 的 `web/vendor/fontawesome/LICENSE.txt`、`web/vendor/markdown-it/LICENSE`、
  `modules/group-messages/server/native/WCDB_LICENSE.txt` 都是**第三方组件**的许可，
  不是 CM 自己的代码许可。
- CM 的 `modules/group-messages/README.md` 自述 native 代码改编自团队 QJQ，
  QQ 部分复用团队 WYT 的 `message-hub/source_api.py`。
  即使 QJQ/WYT 口头同意，**CM 仓库本身仍无 LICENSE**；我们无法从 CM 获得再许可。

### 4.3 第三方依赖 vs 仓库自身：把三张 LICENSE 放回原位

| 文件 | 覆盖什么 | 许可 | **不**覆盖什么 |
| --- | --- | --- | --- |
| `deploy/PLAYWRIGHT-LICENSE` + `deploy/PLAYWRIGHT-NOTICE` | 随包分发的 Playwright/Chromium（含 Puppeteer 派生代码） | Apache-2.0 + NOTICE | AC 自己的采集代码、扩展、服务端逻辑 |
| `apps/mobile/public/ocr/LICENSE` + `worker.LICENSE.txt` | Tesseract.js worker/core + `chi_sim`/`eng` traineddata | Apache-2.0（worker 里还含 MIT 的 buffer 代码） | AC 的 OCR 调用/预处理/UI 代码 |
| `test/fixtures/pdfjs/LICENSE` | 测试夹具里的 pdfjs | Apache-2.0 | AC 的 PDF 解析集成代码 |
| `licenses/whale-maid-CC-BY-NC-SA.txt` | `assets/pet/` 的 10 张立绘及 docs 派生图 | CC BY-NC-SA 4.0 | 代码；且**禁止商业使用**、要求署名 + 相同方式共享 |
| CM `web/vendor/fontawesome/LICENSE.txt` | Font Awesome Free | 图标 CC BY 4.0；字体 SIL OFL 1.1；代码 MIT | CM 的前端代码/页面设计 |
| CM `web/vendor/markdown-it/LICENSE` | markdown-it | MIT | CM 的 Markdown 集成/渲染逻辑 |
| CM `modules/group-messages/server/native/WCDB_LICENSE.txt` | `TANGandXUE/wcdb-key-tool` 的常量/布局 | MIT | **CM/QJQ 的 native 代码**，也不覆盖 Windows 移植部分 |
| AC npm 依赖 | `imapflow` MIT、`mailparser` MIT、`fastify` MIT、`pdfjs-dist` Apache-2.0、`tesseract.js` Apache-2.0、`playwright` Apache-2.0 | 各自许可 | AC 的胶水代码/业务逻辑 |
| CM Python 依赖 | `shanghaitech-ids-passkey` MIT；OSM 数据 ODbL-1.0；`coordtransform` MIT | 各自许可 | CM 的模块代码/数据编排 |
| NapCat（CM 的 QQ 依赖） | GitHub API 返回 `NOASSERTION`（自定义/不明确） | **未确认** | 不能假定可自由再分发；接入前必须读它的实际条款 |

**一句话**：
> 这些 LICENSE 是“他们用了别人的东西，别人给的许可”，
> **不是“他们给自己的代码发了许可”**。
> 我们可以从**上游**按同样许可使用 Playwright/Tesseract/pdfjs/OSM，
> 但不能因此认为 AC/CM 的代码可复用。

### 4.4 数据与素材：另一种权利

#### 4.4.1 一图通（`map.niyiwei.com`）

- 站点是闭源 SPA；首页标题「上科大一图通」；
  页面底部署名「底图 © 上海科技大学校园地图 · 部分道路 © OpenStreetMap contributors」。
- 「美食」页显示 5 处餐饮、1133 道菜、按食堂/窗口/价格/口味筛选；
  文案写「菜单、价格和照片为已收录的记录」。
- **没有**在页面上看到对用户照片/菜单数据的开放许可或复用声明。
- 据委托方说明：地下车库照片、食堂菜单照片是**同学手动拍摄**的，著作权归拍摄者。

**裁决（明确写死）**：

> **不得抓取、镜像、转存、二次分发一图通的照片与菜单数据。**
> 拍摄者未授予我们许可；站点也没有给出可再许可的 LICENSE。
> 即使照片是“公开可访问”，也不等于“可复制使用”。
> 同样，不要抓它的底图瓦片：底图本身来自校方 GIS，一图通无权转许可。

**我们怎么做**：

- 用 `packages/contracts/src/campus-poi.ts` 的**空模型 + 录入闸门**：
  `photoUrls` 默认空；有照片必须 `photoCredit`；禁止 `map.niyiwei.com` 来源
  （该契约已内置 `forbiddenOrigins`）。
- 食堂菜单走我们自己的 `canteen` 菜品库；没有照片就显示文字，不拿别人的图凑。
- 快递站/车库入口等 POI，先用 OSM/校方公开数据建空点，再等**有授权的自愿者**录入。

#### 4.4.2 OSM 与校方地图

| 数据 | 许可 | 我们能做什么 | 必须做什么 |
| --- | --- | --- | --- |
| OSM 衍生路网（CM `walking-network.json`） | 文件自述 **ODbL-1.0** | 可以自己从 OSM 重新抽取；理论上也可复用该库并遵守 ODbL | 署名 © OpenStreetMap contributors；衍生数据库以 ODbL 相同方式共享；保留来源/日期 |
| CM `places.json` 的校方建筑轮廓 | **未确认**（校方地图公开数据，不等于开放许可） | 先按我们已有的校方 GIS 授权路径使用；不要复制 CM 的文件 | 取得校方书面授权/明确范围后再用 |
| CM `doctoral-footprints-source.json`（浦东 gov PDF 配准） | **未确认**（政府公示图的使用范围） | 只学“保留原始顶点 + 配准点 + 残差”的方法 | 不要复制坐标/配准结果；要自己从公示图重做并记录来源 |
| 一图通底图/照片/菜单 | 无开放许可；照片归拍摄者 | 只学功能与交互 | 不抓取、不镜像、不二次分发 |

> 注意：**“数据文件有 ODbL” 不等于 “整个仓库可以抄”**。
> ODbL 只覆盖数据库内容；仓库里的代码、UI、编排仍是保留所有权利。
> 最稳妥的做法：**代码不抄，数据自己从上游重建**。

### 4.5 结论表（要求的那张表）

| 来源 | 能学什么（想法/架构/交互） | 不能做什么 | 理由 |
| --- | --- | --- | --- |
| **AC 代码**（无 LICENSE） | ① 配对码换 Bearer token 的引导流程；② 采集前/后双次身份核对；③ 只读 URL allowlist；④ 每用户 AAD 的 AES-GCM 凭据/会话库；⑤ `needs_auth/syncing/error` 状态机；⑥ Item/Task 分离、`dueConflicts`、来源回执；⑦ 原件先落盘再解析 | 复制/翻译/逐行改写任何 `.ts`/`.js`；复制注释、常量、目录结构；把它的扩展或服务端采集器 vendor 进我们仓库；复用它的立绘/横幅 | 无 LICENSE = 保留所有权利；翻译与改写是衍生作品；素材另有 CC BY-NC-SA |
| **CM 代码**（无 LICENSE） | ① 每源统一快照 + 聚合层只读；② 三态提交 + 七态细分 + 证据字段；③ `availability` 与 `due_at` 分离；④ 历史学期优先 `ended`；⑤ 缺失截止用 estimated 明确标注；⑥ 手动覆盖不改来源；⑦ 浏览器内路网 + 80 m/min + 不画直线；⑧ DPAPI 本机保管的思路 | 复制/翻译/逐行改写任何 `.py`/`.js`；复制 `native/` 微信解密代码；复制 `places.json`/`walking-network.json`；复用 Font Awesome 之外的 UI 素材；把 QJQ/WYT 的代码当可再许可 | 仓库无 LICENSE；native 代码来源本身也不清晰；ODbL 只覆盖 OSM 数据；校方地图授权未确认 |
| **AC 的第三方依赖** | 直接从**上游**用 Playwright/Tesseract/pdfjs/imapflow/mailparser，按各自许可 | 把 `deploy/PLAYWRIGHT-LICENSE` 当成 AC 代码许可；复制 AC 的 Chromium 打包/配置 | Apache-2.0/MIT 只覆盖对应组件；NOTICE 义务要遵守 |
| **CM 的第三方依赖** | 从上游用 markdown-it/Font Awesome/ids-passkey；OSM 按 ODbL | 假定 NapCat 可自由再分发（NOASSERTION）；把 Font Awesome 图标当 CM 原创 | 各组件许可独立；NapCat 条款未确认 |
| **一图通** | 功能清单、交互组织（地图 + 日程 + 菜单 + 快递站）、POI 分类 | 抓取/镜像/转存照片与菜单数据；抓底图瓦片；复制前端 bundle/设计资产 | 闭源、无许可；照片著作权归拍摄者；底图属于校方 GIS |
| **校方 GIS / 教务 / 平台内容** | 在**已获授权**的范围内使用；学习其数据形态 | 把“公开可访问”当“可自由使用”；批量转存课程资料/试题 | 校方授权范围未确认；平台内容有版权；学生个人信息受 PIPL 约束 |
| **微信 / QQ 平台数据** | 只学“为什么不这么做”的边界；学事项抽取的产品形态 | 解密微信 DB、读进程内存、hook、用 NapCat 做产品功能、读群成员消息 | 平台 ToS + 个人信息 + 版本脆弱；CM 自己也不保证真实群验收 |

### 4.6 允许的“学习姿势”清单

给后续实现者的硬规则（建议写进 PR 模板）：

- [ ] **先规格后代码**：把要学的行为写成 `docs/` 里的输入/输出/错误/边界；
      实现时不再打开参考仓库对照。
- [ ] **不复制表达**：不粘贴代码、注释、SQL、常量表、目录树；变量/函数/文件名用自己的命名。
- [ ] **不复制数据**：不把 `places.json`、`walking-network.json`、菜单、照片、
      测试夹具放进我们仓库；需要数据就自己从上游抓/申请。
- [ ] **不复制 UI**：不抄文案、配色、图标、布局细节；交互模式可以学，视觉表达要自己做。
- [ ] **依赖从上游来**：Playwright/Tesseract/pdfjs 用 npm 官方包，不从参考仓库的
      `deploy/`、`public/ocr/`、`test/fixtures/` 拷贝。
- [ ] **保留出处**：本文、ADR、PR 描述里写清“参考了哪个思路、没有复制哪段代码”。
- [ ] **有疑问就停**：不确定是否构成衍生作品时，先问法务，不先合并。

---

## 5. 我们的架构该怎么吸收（不抄代码）

### 5.1 现状盘点（写作时）

| 层 | 现状 | 与本任务的关系 |
| --- | --- | --- |
| 模块表 | `packages/contracts/src/modules.ts` 冻结 20 个用户可见模块 | DDL 不应轻易新增第 21 个 |
| 课表 | `services/api/src/modules/schedule/`：本地 `ScheduleCourse`；`POST /sync` 才要求 campus binding | DDL 不要挂在这个绑定门下 |
| 已有 DDL 契约 | `packages/contracts/src/deadlines.ts`（`DeadlineItem` / `DeadlineSummary` / 时区/去重常量） | 已起步，本文在其上给形状 |
| 已有 DDL 纯函数 | `packages/contracts/src/deadline-normalize.ts`（并行工作刚从 `packages/shared` 迁来；以 `git ls-files` 为准） | 解析/排序/汇总可复用 |
| 群消息 | `packages/shared/src/group-import.ts`（粘贴解析）+ `services/api/src/modules/group-bot/`（官方 QQ 机器人 webhook + 管理员草稿） | 群消息的合法路径已有骨架 |
| 地图 | `packages/contracts/src/campus-map.ts`（校方 GIS 底图/投影）+ `campus-poi.ts`（空 POI + 照片闸门） | 不复制 CM 的 map 数据 |
| 通知 | `services/api/src/modules/notifications/` + `common/notifications/notification.port.ts` | DDL 的提醒应走这个端口，不在 DDL 里造推送 |
| 扩展 / IMAP | **没有** | 本文给“条件性做”的边界 |

### 5.2 DDL 聚合应该做成什么形状

#### 5.2.1 位置：非用户可见的基础设施模块

| 方案 | 优点 | 代价 | 裁决 |
| --- | --- | --- | --- |
| 挂在 `schedule` 下（`/schedule/deadlines`） | 复用课表 UI/学期 | schedule 的绑定门、课表模型（weekday/slot/term）会污染 DDL；DDL 跨平台、无课表也能用 | ❌ |
| 新增第 21 个用户可见模块 | 独立导航/首页入口 | 要改冻结契约、三端导航/权限/测试；DDL 是能力不是场景 | ❌（现阶段） |
| **非模块基础设施**：`services/api/src/modules/deadlines/`，路由 `/deadlines`，不进 `MODULES` | 独立域/端口/测试；不动 20 模块表；UI 可嵌 schedule/home | 需要明确“它不是用户可见模块”，并补路由/权限/文档 | ✅ |

**先例**：`group-bot` 就是这么做的——它有独立路由、独立 module，但注释明确写
“不是契约 §4 的 20 个用户可见模块之一，而是基础设施”。DDL 同理。

**UI 放哪**：

- 课表页的「今天/本周」旁边加一个 DDL 面板；
- 首页加「今天要交」卡片（数据来自 `/deadlines/summary`）；
- 不新增底部 tab；如以后产品坚持要独立页，再走契约变更 + ADR。

#### 5.2.2 分层

```
packages/contracts/src/deadlines.ts        ← wire 类型（已有，按需扩展）
packages/contracts/src/deadline-normalize.ts ← 纯函数（已有，时区/排序/汇总）
services/api/src/modules/deadlines/
  deadlines.module.ts
  deadlines.controller.ts                  ← GET /deadlines, GET /deadlines/summary,
                                              POST /deadlines/ingest, POST /deadlines/:id/override
  deadlines.service.ts                     ← 合并/去重/冲突/过期
  domain/deadline.domain.ts                ← 领域模型、错误、状态机
  domain/deadline-source.port.ts           ← 来源端口；P0 只实现 manual
  data/deadline.repository.ts              ← Prisma
  data/manual-source.adapter.ts            ← 手动/粘贴/导入
```

**关键原则：只进不出（inbound ingest），不在 API 里出站爬取。**

- P0：用户手动添加、粘贴、上传；
- P1：浏览器扩展/导入器把**已提取的记录** POST 到 `/deadlines/ingest`；
- P2：如果拿到校方/平台正式 API，再做服务端 adapter；
- **永远不**在 API 进程里存平台密码、开无头浏览器代登录。

#### 5.2.3 数据模型（建议）

| 表/模型 | 作用 | 关键字段 |
| --- | --- | --- |
| `Deadline` | 可展示/可提醒的投影 | `userId`, `source`, `sourceId`, `courseCode`, `courseName`, `term`, `kind`, `title`, `dueAt`, `dueAtRaw`, `duePrecision`, `dueSource`, `availability`, `submitted`, `submissionStatus`, `exempt`, `weightPercent`, `sourceUrl`, `fetchedAt`, `stale`, `checksum` |
| `DeadlineEvidence` | 每次来源观察的原始证据 | `deadlineId`, `source`, `sourceId`, `observedAt`, `rawDueText`, `rawTitle`, `url`, `identityEmailHash`, `checksum` |
| `DeadlineSourceState` | 每个来源的连接/同步状态 | `userId`, `source`, `status`（not_connected/connected/syncing/needs_auth/error）, `lastSyncedAt`, `message` |
| `DeadlineOverride` | 用户手动覆盖 | `deadlineId`, `dueAt?`, `submitted?`, `dismissed?`, `note`, `updatedAt` |
| `DeadlineIngestReceipt` | 幂等/审计 | `userId`, `source`, `batchId`, `receivedAt`, `recordCount`, `payloadHash` |

**不存**：平台密码、Cookie、session、IMAP 密码、群成员身份、原始 HTML。
**可选存**：`dueAtRaw`（原文，给用户核对）、`sourceUrl`（剥掉 session 参数）。

#### 5.2.4 字段归一规则

| 字段 | 规则 | 缺失/冲突时 |
| --- | --- | --- |
| `source` | 枚举：`blackboard/gradescope/piazza/ecourse/eams/manual/bridge` | 未知来源拒绝入库 |
| `sourceId` | 平台稳定 ID；没有就用 `sha256(source + course + title + rawDue)`，不伪造 | 冲突时保留多条证据 |
| `courseCode` | 大写、去空格/横线；如 `CS 101` → `CS101` | 无代码 → null，不按标题猜课程 |
| `courseName` | 平台原文；用于展示 | 与 code 不一致时保留两者 |
| `term` | `YYYY-fall/spring/summer`；能识别中文季节/学年 | 未知 → null；不默认当前学期 |
| `kind` | `assignment/quiz/exam/project/reading/other` | 未知 → `other` |
| `title` | 去首尾空白、压缩连续空白；保留原文到 evidence | 空标题拒绝 |
| `dueAt` | 绝对时刻 ISO 8601，**必须带偏移**；按 `Asia/Shanghai` 解释字面时间 | 无法解析 → null，`duePrecision='unknown'` |
| `dueAtRaw` | 平台原文（如 `Oct 20, 2026 11:59 PM`） | 必须保留，供 UI 显示“以原站为准” |
| `duePrecision` | `instant/date/relative/unknown` | `date` 不猜 23:59；`relative` 记录解析基准 `fetchedAt` |
| `dueSource` | `platform/manual/estimated` | `estimated` 必须显式标注，且不参与逾期/提醒 |
| `availability` | `open/scheduled/closed/unknown` | 不用 `dueAt` 反推 |
| `submitted` | `true/false/null` | null 显示“待核实”，不催交 |
| `submissionStatus` | `not_submitted/draft/submitted/needs_grading/graded/exempt/unknown` | 未知不归类为未提交 |
| `exempt` | 布尔 | true 不进待办 |
| `stale` | 上次同步失败/超阈值 | 保留旧值 + 标 stale，不删除 |
| `sourceUrl` | 剥掉 `sid/session/token/auth/ticket/secret/code`；只允许 http(s) | 无效 → 省略 |

**时区是硬规则**：所有字面时间按 `Asia/Shanghai` 解释，再转绝对时刻；
不能依赖服务器/浏览器本地时区。现有的 `deadline-normalize` 已经按这个原则写，
后续 adapter 不许绕开它。

#### 5.2.5 合并、去重、冲突

1. **先按来源内 stable id upsert**：同一来源重复 ingest 是幂等的。
2. **跨来源合并**：
   - 先看显式 alias（如果来源提供 `courseCode + sourceId + dueAt` 的映射）；
   - 再看 `courseCode`（规范化后）+ `title`（规范化后）+ `dueAt` 在 ±5 分钟内；
   - 只有标题相同、课程/时间不同 → **不合并**。
3. **冲突处理**：
   - `dueAt` 冲突超过容差 → `dueConflicts[]` 保留双方，UI 标“来源冲突”，
     暂不触发提醒，等用户选择；
   - `submitted` 冲突 → `submitted=null` + `submissionConflict=true`，
     显示“两个平台说法不一致”，不催交；
   - 绝不做“按平台优先级静默选一个”。
4. **新值覆盖旧值**：只有 `fetchedAt` 更新且 `stale=false` 的观察能覆盖；
   缓存/过期数据只能补空，不能覆盖新鲜数据。
5. **删除**：来源明确撤回才删；读取失败只标 stale，不删。

#### 5.2.6 API 形状

| 方法/路径 | 用途 | 备注 |
| --- | --- | --- |
| `GET /api/v1/deadlines` | 列表（时间窗/状态/课程/来源过滤） | `AuthGuard`；本地数据不要求 campus binding |
| `GET /api/v1/deadlines/summary` | 首页汇总 | overdue/dueToday/dueThisWeek/total；已提交不计 |
| `POST /api/v1/deadlines` | 手动创建 | `source='manual'` |
| `PATCH /api/v1/deadlines/:id` | 修改标题/截止/状态 | 写入 `DeadlineOverride`，不改 evidence |
| `DELETE /api/v1/deadlines/:id` | 删除/隐藏 | 软删；保留 evidence 供审计 |
| `POST /api/v1/deadlines/ingest` | 扩展/导入器批量写入 | Bearer + 配对校验；批量 ≤ 100 条/1 MB；幂等 |
| `POST /api/v1/deadlines/sources/:source/refresh` | 触发来源刷新 | P0 没有 connector 时返回 409/501 + 诚实提示，不假装在同步 |

`ingest` 的 body 形状（我们自己的契约，不是抄的）：

```jsonc
{
  "source": "bridge:blackboard",
  "identity": { "emailHash": "…", "observedAt": "…" },
  "complete": true,
  "warnings": ["…"],
  "records": [
    {
      "sourceId": "…",
      "courseCode": "CS101",
      "courseName": "…",
      "kind": "assignment",
      "title": "…",
      "dueAt": "2026-10-20T23:59:00+08:00",
      "dueAtRaw": "Oct 20, 2026 11:59 PM",
      "duePrecision": "instant",
      "availability": "open",
      "submitted": false,
      "submissionStatus": "not_submitted",
      "sourceUrl": "https://…"
    }
  ]
}
```

服务端要校验来源白名单、字段长度、URL scheme、批量大小、`sourceId` 唯一性；
不接受 HTML/脚本；不把 `identity.emailHash` 当登录凭据。

#### 5.2.7 测试清单

- 时区：上海字面时间在 UTC/伦敦/东京运行环境下解析一致；
- 只有日期、无时间：`duePrecision='date'`，不生成 23:59；
- 相对时间：`Due in 3 days` 以 `fetchedAt` 为基准，跨 DST 不适用（上海无 DST）；
- 空截止：`dueAt=null`，排序最后，不进今日汇总；
- 冲突：BB 10/20 23:59 vs Piazza 10/21 00:00 → `dueConflicts`，不提醒；
- 提交冲突：true vs false → `null` + 不催交；
- 幂等：同一 batch 重放两次，计数不变；
- 旧数据：`stale=true` 不覆盖新数据；
- 手动覆盖：改 due 后，来源刷新不覆盖；恢复默认后回到来源值；
- URL 清洗：`?sid=…&token=…` 被剥掉；
- 课程合并：同 code 同学期合并；同 title 不同 code 不合并。

### 5.3 浏览器扩展采集：可行性、边界与裁决

#### 5.3.1 裁决

**本轮不做。** 理由不是“技术上不行”，而是**成本/收益/合规**：

| 维度 | 现实 |
| --- | --- |
| 工程量 | 独立 MV3 扩展工程 + 构建/发布 + 版本兼容 + 三平台页面适配 + 身份核对 + 配对服务 + 测试 |
| 分发 | 需要 Chrome/Edge 商店审核，或让用户“加载解压缩扩展”；我们目前没有这个渠道 |
| 维护 | BB/GS/Piazza 页面一改就坏；每个平台都要回归 |
| 合规 | 平台 ToS、学校网络/账号政策、商店政策；read-only 降低但不消除风险（**未确认**） |
| 收益 | 早期用户量下，手动导入/粘贴能覆盖大部分 DDL 需求 |

**如果要做，做的不是“自动同步一切”，而是“单页导入”**：
用户在课程页点扩展 → 预览将发送的字段 → 确认 → 只导入当前页的作业/公告。
这比“后台每 15 分钟遍历 60 页”更容易解释、更容易审核、更容易撤权。

#### 5.3.2 可接受的边界（硬约束）

1. **用户主动安装**：不预装、不静默下发、不通过小程序诱导。
2. **配对码**：
   - 128-bit 以上随机码；只存 SHA-256；TTL ≤ 10 分钟；一次性；绑定 `userId`；
   - 换取 256-bit token；只存哈希；TTL ≤ 30 天；可撤销；每设备一条；
   - 配对响应必须包含 `expectedEmail` + `identityRequired:true`，否则扩展拒绝启用。
3. **只读**：
   - 只读 DOM 文本/链接/作业表；不读密码框、Cookie、`localStorage`、`document.cookie`；
   - 不发 POST/PUT/DELETE；不点提交/删除/发帖/设置按钮；
   - URL allowlist（课程/作业/资料/公告），拒绝 submit/upload/edit/delete/admin/messages。
4. **身份绑定**：
   - 只从“本人账号资料页”读邮箱；与配对邮箱不一致就停；
   - 每次上传前再核对一次；不一致不导入。
5. **最小权限**：
   - `permissions` 只留 `storage` + `scripting`（需要时）；
   - `host_permissions` 只写精确平台域名；**不要** `https://*/*`；
   - 不使用 `cookies`、`webRequest`、`tabs`（除非确有必要）。
6. **最小数据**：
   - 只传归一字段 + `dueAtRaw` + `sourceUrl`（剥 session）；不传整页 HTML；
   - v1 不传附件；如要传，用户点击 + 单文件 ≤ 3 MB + 类型白名单。
7. **默认不自动**：
   - 默认手动触发；自动同步必须是用户显式开关，且只在浏览器运行时；
   - 不做服务端发起的“远程抓取”。
8. **可解释**：
   - 首次同步前展示“将发送哪些字段/到哪个服务器”；
   - 每个来源有状态（connected/needs_auth/error）和撤销按钮。

#### 5.3.3 协议草图（我们自己的设计）

```
Web: POST /api/v1/deadline-bridge/pairing
  → { code, expiresAt }             // code 只显示一次，服务端只存 hash

Extension: POST /api/v1/deadline-bridge/pair { code }
  → { token, expiresAt, expectedEmail, identityRequired: true }

Extension: POST /api/v1/deadlines/ingest
  Authorization: Bearer <token>
  → { batchId, records, identity, warnings }

Web: POST /api/v1/deadline-bridge/revoke
  → 删除该用户所有 bridge sessions
```

服务端要做：token 哈希查找、过期校验、用户状态校验、来源 allowlist、
批量大小/字段校验、速率限制、审计（谁在何时导入了多少条）、撤销即失效。

#### 5.3.4 更便宜的三条替代路径（建议先试）

| 路径 | 成本 | 体验 | 风险 |
| --- | --- | --- | --- |
| 手动添加/粘贴（P0） | 最低 | 用户要动手 | 无 |
| “保存网页 → 上传 HTML/JSON”导入 | 低 | 比扩展差，但无需安装 | 解析脆弱；要清洗 |
| Bookmarklet（书签脚本） | 低 | 在课程页一键提取，POST 到 API | 仍需 token；页面结构变化会坏；但比扩展轻 |

先验证“用户是否真的愿意为 DDL 装扩展”。如果答案是否，就不要投入扩展工程。

### 5.4 邮件接入：IMAP 直连 vs 转发到我们的地址

#### 5.4.1 对比

| 维度 | IMAP 直连 | 转发到我们的地址 |
| --- | --- | --- |
| 凭据 | 需要客户端专用密码；服务端必须能取回明文去登录 | 不需要邮箱密码；只需用户加一条转发规则 |
| 设置 | 用户在官网生成专用密码，填到我们这里 | 用户在邮箱设置里填我们的地址 |
| 覆盖 | 可读历史/文件夹/附件 | 只覆盖**新转发**的邮件；历史没有 |
| 隐私 | 服务端能读整个邮箱（取决于 scope） | 服务端只看到用户选择转发的子集 |
| 运维 | IMAP 连接池、TLS、超时、重试、UIDVALIDITY | MX/收信、反垃圾/反伪造、投递率、地址管理 |
| 失败模式 | 认证失败/网络/限流/文件夹权限 | 学校禁转发/转发丢失/被当垃圾邮件 |
| 合规 | 托管学生邮箱凭据，责任最大 | 仍托管邮件内容，但范围小得多 |
| 适合 | 必须全量、实时、含附件 | 只要 DDL/通知，能接受“只覆盖新邮件” |

#### 5.4.2 我们的裁决

**优先转发**，前提是校方允许自动转发（**未确认**，需要问信息办/邮箱管理员）。
理由：

- 不托管学生邮箱密码，攻击面小一个数量级；
- DDL/通知只需要“新邮件里的截止/活动”，不需要全量归档；
- 转发地址可以按用户生成、可撤销、可审计；
- 即使被转发的是垃圾邮件，也只影响该用户。

**如果转发不可用，再做 IMAP，但必须是“有界只读”**：

| 约束 | 具体要求 |
| --- | --- |
| 凭据 | **只用客户端专用密码**；绝不收校园日常密码；不自动生成专用密码（不做 Playwright 点安全设置） |
| 加密 | AES-256-GCM，每用户 AAD；密钥与 DB 分离；无密钥 fail closed |
| 读取 | `EXAMINE`/`BODY.PEEK`；**不写 `\Seen`**；只读最近 N 封（如 100）或指定文件夹 |
| 范围 | 只取 DDL/通知需要的头与正文片段；不下载附件；不归档全部历史 |
| 保留 | 正文 ≤ 7/30 天；提取完即删原文；只留结构化字段与来源链接 |
| 频率 | 15 分钟轮询 + 用户手动刷新；有界退避 |
| 撤销 | 一键删除凭据 + 缓存；下次同步立即失败 |
| 审计 | 记录“何时读了哪个文件夹的多少封”，不记录正文 |

**明确不做**：

- 不做 AC 式的“所有文件夹全部历史 + 原件永久归档”；
- 不做服务端官网登录（remote-browser）拿邮件；
- 不把 IMAP 密码写进日志/错误消息/模型上下文。

#### 5.4.3 和两个参考仓库的对比

| 维度 | AC | CM | 我们 |
| --- | --- | --- | --- |
| 部署 | 服务端/本机 | 本机 | 多用户服务端 |
| 凭据 | 专用密码，AES-GCM，可选记住 | 专用密码，DPAPI 本机 | 转发优先；IMAP 仅 opt-in |
| 范围 | 所有文件夹全部历史 | 收件箱最近 100 封 | 只取 DDL/通知所需 |
| 已读状态 | 会写回 `\Seen` | `BODY.PEEK` 不写 | **不写** |
| 保留 | 原件永久 | 缓存正文 | 短期，提取后删 |

> 学 CM 的“有界 + 不写已读 + 本机保管”，不学 AC 的“全量归档 + 服务端托管”。

### 5.5 群消息接入：CM 的做法能不能学？

#### 5.5.1 不能学的部分

| CM 的做法 | 为什么不能学 |
| --- | --- |
| 读 Windows 微信进程内存拿 SQLCipher 密钥 | 平台 ToS + 个人信息 + 版本脆弱；服务端不可移植 |
| 解密整个 `db_storage` 到快照 | 读的是群内其他成员的通信内容；存储责任巨大 |
| 用 NapCat/OneBot 作为产品依赖 | 第三方 NTQQ 实现，许可 NOASSERTION，ToS 风险；需要用户装额外客户端 |
| 自动轮询群消息并 AI 提取 | 未经群成员同意；误提取会变成“平台替他们发通知” |

#### 5.5.2 我们已经有什么

- `packages/shared/src/group-import.ts`：**粘贴解析**，纯函数、无网络、带 evidence；
  目前面向跳蚤/拼单/跑腿（sell/buy/groupbuy/errand），不是课程通知。
- `services/api/src/modules/group-bot/`：**官方 QQ 机器人 webhook**（Ed25519 验签）+
  管理员草稿；已经调用 `parseGroupImport`，但只落草稿，不自动发布。
- 这条路径的合法性来自：**群管理员显式把机器人拉进群**，平台按官方 API 推送；
  不是偷读，也不是冒充用户。

#### 5.5.3 够不够？

| 需求 | 粘贴解析够不够 | 说明 |
| --- | --- | --- |
| 跳蚤/拼单/跑腿信息 | **够** | 用户主动转发一条消息，解析成候选，逐条确认 |
| 课程群 DDL/调课通知 | **部分够** | 一次性转发可以；持续同步不够；需要新的通知解析器 + 人工确认 |
| “自动同步我的微信群” | **不够，也不该做** | 没有合法、稳定、可多用户的通道 |

#### 5.5.4 建议的演进

1. **P0**：保留粘贴解析；给课程通知加一个 `parseGroupNotice`（或 AI + 引用），
   输出 `Finding` 候选（类型/标题/时间/地点/引用），**必须用户确认**才进 DDL。
2. **P1**：把 `group-bot` 从“商品草稿”扩到“课程通知草稿”：
   官方机器人 + 管理员确认 + 只创建本地 DDL，不改学校提交状态。
3. **P2**：如果学校/学院愿意开官方通知渠道（邮件列表、公众号、企业微信），
   优先接官方渠道，而不是读个人群。
4. **永远不做**：本机微信 DB 解密、NapCat 产品化、冒充用户读群。

### 5.6 地图/POI（一句话版）

- 我们已有校方 GIS 底图 + `campus-map` 投影；**不要**复制 CM 的 `places.json`
  （校方授权未确认）或 `walking-network.json`（ODbL 数据，应该自己从 OSM 重建）。
- 需要步行路线时：自己从 OSM 抽 bbox、保留 node ID、只连共享节点、排除地下/室内、
  80 m/min、不可达不画直线；署名 © OpenStreetMap contributors，衍生库按 ODbL 共享。
- POI 照片遵守 `campus-poi.ts`：默认空、有授权才填、`photoCredit` 必填、
  禁止 `map.niyiwei.com`。

### 5.7 分期路线（建议）

| 期 | 做什么 | 不做什么 | 验收 |
| --- | --- | --- | --- |
| **P0（本轮/下轮）** | DDL 契约补齐 + `/deadlines` 基础设施模块 + 手动/粘贴 + 测试 | 扩展、IMAP、群自动同步 | 手动添加/导入的 DDL 能按上海时区正确显示/排序/汇总 |
| **P1** | 单页导入（bookmarklet 或“上传 HTML/JSON”）+ 来源状态 + 手动覆盖 | 自动全量、服务端代登录 | 用户能在课程页一键导入当前页，预览后确认 |
| **P2** | 邮件转发（若校方支持）+ 官方机器人通知草稿 | IMAP 全量归档、微信解密 | 转发邮件 → DDL 候选 → 用户确认；机器人草稿可审计 |
| **P3（条件性）** | 浏览器扩展（单页导入，严格边界） | 后台自动遍历、`<all_urls>`、Cookie 导出 | 安全评审 + 法务/学校确认 + 商店/分发方案 |

---

## 6. 诚实的不推荐清单

> 这些不是“技术上做不到”，而是“做了会出事/不值得”。

| # | 看起来诱人 | 为什么不该做 | 替代 |
| --- | --- | --- | --- |
| N1 | 服务端存学生 BB/GS/Piazza 密码，代登录 | 违反平台 ToS；DB 变成高价值目标；验证码/MFA 不可持续 | 用户主动导入 / 条件性只读扩展 |
| N2 | 服务端 Playwright 用学生密码自动登录（即使加密） | 密码必须明文进进程；平台会风控；责任最大 | 不做；如必须，做“用户自己在官方页面登录”的远程浏览器也要慎之又慎 |
| N3 | 复制/翻译 AC 或 CM 的代码 | 无 LICENSE；翻译/改写是衍生作品；会污染整个仓库的许可 | 读思路 → 写规格 → 独立实现 |
| N4 | 把 CM 的 `native/` 微信解密代码搬过来 | 平台 ToS + 他人通信内容 + 版本脆弱 + 来源本身无许可 | 粘贴/官方机器人 |
| N5 | 用 NapCat/OneBot 做产品级 QQ 接入 | 第三方 NTQQ 实现；许可 NOASSERTION；需要用户装客户端；随时失效 | 官方 QQ 机器人 webhook（已有 `group-bot`） |
| N6 | 抓一图通的地下车库/食堂照片 | 照片著作权归拍摄者；站点无许可；二次分发侵权 | 自己的 canteen 菜品库；有授权的自愿者拍摄 |
| N7 | 镜像一图通/校方 GIS 的底图瓦片 | 底图属于校方 GIS；一图通无权转许可 | 用我们已有的校方 GIS 授权路径 |
| N8 | 复制 CM 的 `places.json` / `walking-network.json` | 前者校方授权未确认；后者虽 ODbL，但应自己从 OSM 重建 | 自己抽 OSM + 署名 + ODbL |
| N9 | 默认全量归档学生邮箱 | 隐私/存储/泄露责任；我们只需要 DDL | 转发 + 短期保留；IMAP 只读有界 |
| N10 | 用 Playwright 自动点学校“生成专用密码” | 自动化账号安全设置；页面一变就坏；等于把敏感操作脚本化 | 用户手动生成，我们只验证 |
| N11 | 扩展默认后台遍历 + `<all_urls>` + 自动同步 | 权限过大、行为不可解释、商店审核/用户信任都会崩 | 单页导入 + 精确域名 + 手动触发 |
| N12 | 把缺失的截止日期猜成 23:59 / 第 18 周 | 会产生假逾期/假提醒；用户会失去信任 | `null` + “时间待定”；如要估计，明确标 `estimated` |
| N13 | 两个平台提交状态冲突时按“平台优先级”选一个 | 会误催交/误判已完成 | 置 `unknown` + 展示冲突 + 让用户核对 |
| N14 | 把群消息 AI 提取结果自动发布/自动改课表 | 群消息可能过期/反讽/不完整；责任错位 | 只落草稿；用户/管理员确认 |
| N15 | 在 UI 里复用 AC 的立绘/CM 的主题/文案 | 素材 CC BY-NC-SA（禁商）或仓库无许可 | 用我们自己的「校园贴纸簿」视觉体系 |

---

## 7. 未确认事项（不猜）

| # | 未确认 | 影响 | 怎么确认 |
| --- | --- | --- | --- |
| U1 | 校方是否允许学生邮箱自动转发到校外地址 | 决定邮件路线 | 问信息办/邮箱管理员，拿书面答复 |
| U2 | 校方校园 GIS 的授权范围（底图/建筑/POI/再分发） | 决定地图数据能否用/怎么署名 | 查 `docs/features/campus-map-data.md` + 校方书面确认 |
| U3 | BB/Gradescope/Piazza 的 ToS 是否允许“用户主动安装的只读扩展” | 决定扩展能否做 | 读各平台 ToS + 法务意见；不把“技术上只读”当许可 |
| U4 | Chrome/Edge 商店对“校园数据采集”扩展的审核口径 | 决定分发方式 | 提交前查政策/预审；必要时只做“加载解压缩扩展” |
| U5 | NapCat/OneBot 的实际许可条款 | 决定能否依赖 | 读其仓库 LICENSE/用户协议；NOASSERTION 不等于可自由使用 |
| U6 | 微信个人账号规范对“读本地数据库”的具体条款与执法尺度 | 决定 CM 路径的风险等级 | 法务意见；本文按“不可做”处理 |
| U7 | 一图通的照片/菜单数据是否有任何书面授权 | 决定能否引用 | 联系作者；没有书面授权就默认不能 |
| U8 | CM 的微信路径在 4.1.15.13 之外是否可用 | 只影响“是否能学”，不影响“是否该做” | 不验证；按不可移植处理 |
| U9 | 学校 IMAP 是否对所有学生开放专用密码 | 决定 IMAP 备份路径 | 查学校邮箱帮助/问信息办 |
| U10 | 我们的用户是否真的需要“自动同步”而不是“手动导入” | 决定是否值得做扩展 | 用户访谈/埋点；先做手动导入验证 |

---

## 8. 证据索引

### 8.1 AC（`/tmp/kdy-ref/AgenticCampus`）

| 主题 | 文件 |
| --- | --- |
| 依赖/脚本 | `package.json` |
| 生产模式与安全自述 | `docs/DEPLOYMENT.md`、`docs/IMPLEMENTED.md`、`docs/CAPABILITIES.md` |
| IMAP 连接 | `implementations/imap-connection.ts` |
| 邮件同步/归档 | `implementations/real/mail.ts`、`implementations/real/mail-archive.ts`、`implementations/real/mail-read-writer.ts` |
| 专用密码生成 | `implementations/campus-web-auth.ts`（`provisionImapCredential`） |
| 凭据/会话加密 | `implementations/real/credential-vault.ts`、`implementations/server-session-vault.ts` |
| 服务端采集 | `implementations/server-browser.ts`、`implementations/server-platform-policy.ts` |
| 模式判定 | `implementations/external-browser.ts` |
| 配对/桥接口 | `implementations/real/routes.ts`（`/personal/browser/pairing`、`/bridge/pair`、`/bridge/batch`） |
| 扩展 | `browser-extension/manifest.json`、`background.js`、`collector.js`、`identity-collector.js`、`read-policy.js`、`identity-policy.js`、`popup.js` |
| 数据模型 | `contracts/types.ts` |
| 入库/去重 | `implementations/real/ingest.ts`、`implementations/assignment-policy.ts`、`implementations/task-linking.ts` |
| 依赖许可 | `deploy/PLAYWRIGHT-LICENSE`、`deploy/PLAYWRIGHT-NOTICE`、`apps/mobile/public/ocr/LICENSE`、`test/fixtures/pdfjs/LICENSE`、`licenses/whale-maid-CC-BY-NC-SA.txt` |

### 8.2 CM（`/tmp/kdy-ref/Shanghaitech-2026-Hackthon`）

| 主题 | 文件 |
| --- | --- |
| 技术栈/依赖 | `pyproject.toml` |
| 产品自述 | `README.md`、`docs/PROJECT_GUIDE.md` |
| 微信原生 | `modules/group-messages/server/native/{process,crypto,snapshot,reader,version,paths}.py` |
| 微信编排 | `modules/group-messages/server/wechat.py` |
| QQ | `modules/group-messages/server/{qq,qq_client}.py` |
| 群消息边界 | `modules/group-messages/README.md` |
| 第三方许可 | `modules/group-messages/server/native/WCDB_LICENSE.txt` |
| 地图 | `modules/campus-map/README.md`、`data/walking-network.json`、`data/places.json`、`data/osm-basemap.json`、`web/routing.js` |
| DDL 归一 | `backend/services/campus/data.py`、`backend/services/campus/assignments.py`、`modules/courses/server/catalog.py` |
| 来源读取 | `modules/blackboard/server/reader.py`、`modules/gradescope/server/reader.py`、`modules/piazza/`、`modules/ecourse/server/reader.py` |
| 邮件 | `modules/mail/README.md`、`backend/services/auth/imap.py`、`backend/core/vault.py` |
| 模块边界 | `modules/deadlines/README.md`、`modules/assignments/README.md`、`modules/courses/README.md` |
| 前端第三方 | `web/vendor/fontawesome/LICENSE.txt`、`web/vendor/markdown-it/LICENSE` |

### 8.3 我们仓库

| 主题 | 文件 |
| --- | --- |
| 模块表 | `packages/contracts/src/modules.ts` |
| 课表 | `services/api/src/modules/schedule/` |
| DDL 契约 | `packages/contracts/src/deadlines.ts` |
| DDL 纯函数 | `packages/contracts/src/deadline-normalize.ts`（并行工作从 `packages/shared` 迁来，以 `git ls-files` 为准） |
| 群消息粘贴解析 | `packages/shared/src/group-import.ts` |
| 官方机器人 | `services/api/src/modules/group-bot/`、`packages/contracts/src/group-bot.ts` |
| 校园地图 | `packages/contracts/src/campus-map.ts`、`campus-map-data.json` |
| POI 照片闸门 | `packages/contracts/src/campus-poi.ts` |
| 通知 | `services/api/src/modules/notifications/`、`services/api/src/common/notifications/notification.port.ts` |
| 安全立场 | `docs/architecture/05-security-privacy.md` |
| 并行计划 | `docs/architecture/08-reference-merge-plan.md` |

### 8.4 外部 URL

- AC：<https://github.com/sagiridsg/AgenticCampus>
- CM：<https://github.com/David-goldenman/Shanghaitech-2026-Hackthon>
- 一图通：<https://map.niyiwei.com>
- 校方地图：<https://map.shanghaitech.edu.cn>
- OSM 版权：<https://www.openstreetmap.org/copyright>
- GitHub license API 示例：<https://api.github.com/repos/sagiridsg/AgenticCampus>

### 8.5 复现本文几个事实的命令

```bash
# 许可证（应输出 None）
curl -sL https://api.github.com/repos/sagiridsg/AgenticCampus \
  | python3 -c 'import json,sys; print(json.load(sys.stdin).get("license"))'

# 文件数
find /tmp/kdy-ref/AgenticCampus -type f -not -path '*/.git/*' | wc -l   # 556
find /tmp/kdy-ref/Shanghaitech-2026-Hackthon -type f -not -path '*/.git/*' | wc -l  # 467

# 扩展没有 cookies 权限（应无输出）
grep -n '"cookies"' /tmp/kdy-ref/AgenticCampus/browser-extension/manifest.json || true

# CM 路网自述 ODbL
python3 -c 'import json;d=json.load(open("/tmp/kdy-ref/Shanghaitech-2026-Hackthon/modules/campus-map/data/walking-network.json"));print(d["source"],d["license"],d["attribution"])'
```

---

## 9. 版本

| 版本 | 日期 | 变更 |
| --- | --- | --- |
| v1 | 2026-10-19 | 首版：两个仓库能力清单、许可裁决、DDL/扩展/邮件/群消息建议、不推荐清单 |

> 下一步：把 §5.2 的 DDL 形状落成契约/模块设计（另开实现任务），
> 把 §4.5 的裁决同步进 `packages/contracts/src/deadlines.ts` 和
> `packages/contracts/src/campus-poi.ts` 的头注释；本文只负责“证据 + 裁决”。

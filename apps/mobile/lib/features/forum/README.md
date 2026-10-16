# feature: `forum`（论坛）

契约 §4.1 的 `forum`（敏感级：**中**，支持匿名）。领域模型照
`docs/architecture/02-domain-model.md` §2.4 实现：版块 / 主题 / 回复 / 举报 +
状态机 + 治理规则。

## 该模块的 ports

| 端口 | 位置 | 说明 |
| --- | --- | --- |
| `ForumPort` | `lib/domain/ports/forum_port.dart` | 论坛读/写用例的唯一入口 |

实现（适配器）：

| 实现 | 位置 | 用途 |
| --- | --- | --- |
| `RemoteForumRepository` | `lib/data/repositories/remote_forum_repository.dart` | 走 `/api/v1/forum/*`，写操作带 `Idempotency-Key` |
| `MockForumRepository` | `lib/data/mock/mock_forum_repository.dart` | 内存实现，**默认装配**，无后端可跑 |

端口方法与契约 §6.1 的统一 CRUD 形状一一对应：

| 方法 | HTTP | 备注 |
| --- | --- | --- |
| `listBoards()` | `GET forum/boards` | 响应是 `{ items, nextCursor }` |
| `listPosts(ForumPostQuery)` | `GET forum/items?board=&q=` | 游标分页 + 版块筛选 + 关键词 |
| `getPost(id)` | `GET forum/items/:id` | 隐藏/已删除对普通用户按 404 处理 |
| `listReplies(ForumReplyQuery)` | `GET forum/items/:postId/replies` | 游标分页，按时间正序 |
| `createPost(command)` | `POST forum/items` | 请求体字段名是 `board` |
| `createReply(command)` | `POST forum/items/:postId/replies` | 复数子资源；`postId` 在**路径**里 |
| `report(command)` | `POST forum/items/:id/report` | action 名 `report`，**已**登记在契约 §11.2 |

### 与 `services/api` 的实测对齐（重要）

本端在交付前**读了 `services/api/src/modules/forum/`**（跨端一致性检查，只读不改），
发现若干 `02-domain-model.md` 与已实现后端之间的差异，并**按"两端都能用"处理**：

| 项 | `02-domain-model.md` | `services/api` 实现 | 本端处理 |
| --- | --- | --- | --- |
| 主题的版块字段 | `boardId` | `board` | **两个都读**；请求体发 `board` |
| 列表过滤参数 | `boardId` / `keyword` | `board` / `q` | 发 `board` / `q` |
| 主题/回复状态 | `DRAFT\|PUBLISHED\|…`（大写） | `draft\|published\|…`（小写） | `fromWire` **大小写不敏感** |
| 举报状态/对象类型 | `PENDING\|UPHELD\|DISMISSED` | 同上（大写） | 一致 |
| 举报理由 | `…\|privacy\|…` | `…\|pii\|…`（接受 `privacy` 归一化） | **发 `pii`，两个都解析** |
| 举报补充说明字段 | `note` | `detail` | 发 `detail`，两个都解析 |
| 回复路径 | `items/:id/<action>` | `items/:id/replies` | 用 `replies`（子资源） |
| 匿名的表达 | `anonymous` + `anonymousIdentity{id,alias}` | `authorId: null`，**不下发** `anonymousIdentity` | 两种都兼容：缺 `anonymousIdentity` 时合成**只用于展示**的匿名身份（不含任何实名信息） |

> 这些差异**不是本端自创**：本端没有改 `docs/` 与 `packages/`（Lead 独占），
> 只是让客户端在两种形状下都不会解析失败。**请 Lead 裁定规范取值**，
> 三端再统一（契约 §11.2 的精神：不要各自漂移）。

### ⚠️ 需要 Lead 补登记 / 裁定的三处（本端**没有**自创路由，也没有改契约文件）

契约 §11.2 明确要求：「实现时若发现某个动作确实是领域需要的，**正确做法是补进本表 +
OpenAPI**，而不是绕过去」。本端把缺口**上报**给 Lead：

1. **`forum.reply`** —— 契约 §11.2 的 action 表里没有 `reply`；后端用的是子资源
   `POST items/:id/replies`（也不是 §11.2 的 action 形状）。**两处都没登记**，请裁定。
2. **`forum/boards`** —— 只读子资源路径，契约 §6.1 只冻结了 `<mod>/items` 这一套。
   后端已实现 `GET /forum/boards`，建议补进 OpenAPI。
3. **匿名句柄的暴露面（隐私）** —— 见下节「🔒 一个跨端隐私发现」。

## 该模块的用例（application 层）

| 用例 | 位置 | 说明 |
| --- | --- | --- |
| `forumBoardFilterProvider` | `application/forum_providers.dart` | 版块筛选（`Notifier<String?>`，null = 全部） |
| `forumBoardsProvider` | 同上 | 版块列表（`FutureProvider`） |
| `forumListControllerProvider` | 同上 | 主题列表：首屏 / 下拉刷新 / 翻页（翻页失败保留列表） |
| `forumPostProvider` | 同上 | 主题详情（`FutureProvider.family`） |
| `forumRepliesProvider` | 同上 | 某主题的回复列表（`AsyncNotifierProvider.family`） |
| `forumActionsProvider` | 同上 | 发帖 / 回复 / 举报；写成功后**失效读 provider** |

`ForumActions` **不持有 `Ref`**（只拿端口 + 失效回调），因此能在测试里直接构造 ——
`test/application/forum_controller_test.dart` 就是靠这一点直接调它。

## 匿名（契约 §9）

匿名不是"把名字藏起来"，而是在**模型层面**分成两个类型：

```
ForumAuthor (sealed)
├── RealAuthor(userId, name)         → realUserIdOrNull == userId
└── AnonymousAuthor(AnonymousIdentity) → realUserIdOrNull == null，且**没有** userId 字段
```

- `AnonymousIdentity`（`lib/domain/models/anonymous_identity.dart`）没有 `userId`，
  也没有任何指回实名的字段；`derive(boardId, sequence)` 只有两个入参，方向是**单向**的。
- `ForumAuthor.fromJson` 在 `anonymous: true` 时**只**读 `anonymousIdentity`：
  payload 里即使混进了 `authorId`，也会被丢弃。
- 客户端**不持有**匿名 id ↔ 实名 id 的映射（追溯能力在服务端，契约 §2.4）。
- 发帖请求体里没有 `authorId` / `userId` / `authorName`，只有 `anonymous: true`。
- UI 侧：匿名帖/匿名回复都带「匿名」徽标；发帖页与回复框的匿名开关旁**必然**显示
  `anonymousPostNotice` / `anonymousReplyNotice`（domain 常量，措辞可被测试校验）。

边界由 `test/domain/forum_anonymity_boundary_test.dart` **机械校验**
（与契约 §5 的 `auth_session_boundary_test.dart` 同一思路）。

### 🔒 一个跨端隐私发现（已上报 Lead，本端只读未改）

`services/api` 的 `ForumPostModel` / `ForumReplyModel` 里有 `anonHandle`
（= `HMAC(secret, userId + '|' + thread:<id>)`），`ForumReportModel` 里有 `reporterKey`；
而仓储基类 `PrismaCursorRepository.toModel` 是**恒等透传**
（`row as unknown as TModel`，`services/api/src/common/crud/prisma-cursor.repository.ts:37`），
因此这两个字段**会随列表/详情响应下发给客户端**。

问题：`02-domain-model.md` §2.4 明确"同一 `AnonymousIdentity` 在版块内**可被版主追溯**，
**对普通用户不可见**"。拿到 `anonHandle` 的任何客户端都能把同一匿名作者的所有帖子关联起来 ——
这正是那条规则要防的事。

**本端的处理**：`domain` 模型里**根本没有**这两个字段（不读、不存、不序列化），
并由 `test/domain/forum_post_test.dart` 断言 `toJson()` 不含 `anonHandle`。
建议 `services/api` 在序列化前剔除（`select`/`omit` 或显式 DTO）。

## 治理规则（契约 §2.4）

| 规则 | 本端实现 |
| --- | --- |
| 3 个不同用户举报 → 自动隐藏 | ✅ `MockForumRepository.report` 按举报人去重，达阈值把帖子置 `HIDDEN`；`getPost`/`listPosts` 之后都取不到 |
| 同一用户重复举报 | ✅ 返回 `CONFLICT`（mock 有测试） |
| `LOCKED` 禁止新回复 | ✅ `createReply` 返回 `CONFLICT`；UI 隐藏输入框并说明原因 |
| 举报理由 / 状态枚举 | ✅ 未知值收敛（理由 → `other`，状态 → `unknown`） |
| 发帖/回复频率限制（10 分钟 3 帖…） | ❌ **未实现**：属于服务端限流，客户端只做长度校验 |
| 敏感词拦截 | ❌ 未实现：契约要求返回 `VALIDATION_FAILED`，由服务端判定 |
| 版主 Moderation / Lock / Hide 界面 | ❌ 未实现：只有数据层状态与治理规则 |

## 页面（presentation）

| 页面 | 文件 | 内容 |
| --- | --- | --- |
| 版块 + 主题列表 | `presentation/pages/forum_board_page.dart` | 版块 chip 筛选、置顶优先排序、**下拉刷新** + **触底加载**、三态 |
| 主题详情 | `presentation/pages/forum_post_detail_page.dart` | 正文 + 回复列表（分页）+ 底部回复输入框 + 匿名开关 + 分享 + 举报 |
| 发帖 | `presentation/pages/forum_compose_page.dart` | 版块 / 标题 / 正文 / 标签 + **匿名开关**（旁附契约文案） |
| 举报弹层 | `presentation/components/forum_report_sheet.dart` | 理由选择 + 补充说明 + **默认匿名** |

**分享**走 `lib/platform/` 的 `SharePort`（当前装配 `ClipboardSharePort`，链接进系统剪贴板，
**真实可用**）；换成 `share_plus` 只需替换 platform 层实现，页面不用改。
分享链接基址 `forumShareBaseUrl` 是**占位域名**（与 `AppEnvironment.prodBaseUrl` 同一类问题）。

## 三态

`AsyncStateView` 统一渲染：

| 态 | 触发方式 |
| --- | --- |
| loading | 首帧 / 下拉刷新 / 切换版块 |
| error | 上游故障（🧪 菜单切 `MockFailureMode.upstreamUnavailable`） |
| empty | 空结果（🧪 菜单切 `controls.emptyResults = true`），文案「这个版块还没有主题」+ 引导 |
| data | 正常 6 条可见 fixture（第 7 条是 `HIDDEN`，刻意用来验证"隐藏的不出现"） |

详情页把 `NOT_FOUND` 映射为**空态**（"该主题不存在或已被隐藏"），其余错误走错误态。

## 已实现 / 未实现

- ✅ 版块筛选 + 主题列表（游标分页）+ 详情 + 回复列表 + 回复输入 + 发帖（匿名开关）+ 举报 + 分享
- ✅ 匿名身份与实名身份在模型层解耦（sealed 类型 + 机械边界测试）
- ✅ mock 与远端两套适配器，`AppRuntime` 按 `AppFlavor` 装配
- ✅ 亮/暗主题：所有色值走 `context.kedayaColors`（无硬编码色值）
- ❌ 帖子点赞（`likeCount` 只读展示）、编辑/删除自己的帖子
- ❌ 版主 moderation 界面、二级回复的"回复某条"交互（`parentReplyId` 已在模型与 mock 里支持）
- ❌ 图片/附件上传、Markdown 富文本渲染（正文按纯文本展示）

## 测试

- `test/domain/forum_post_test.dart` —— 模型解析/序列化、状态收敛、草稿校验、标签解析、匿名开关语义
- `test/domain/forum_anonymity_boundary_test.dart` —— **契约 §9 机械校验**：匿名路径上不存在实名信息
- `test/data/mock_forum_repository_test.dart` —— 分页/筛选/可见性、匿名身份派生、锁定拒答、举报去重与自动隐藏
- `test/application/forum_controller_test.dart` —— 三态、版块切换、翻页失败保留列表、写操作后失效读 provider

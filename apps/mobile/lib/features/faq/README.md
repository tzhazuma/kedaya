# feature: `faq`（常见问题）

契约 §4.1 的 `faq`（敏感级：**低**，检索**无需登录**）。领域模型照
`docs/architecture/02-domain-model.md` §2.8 实现：知识库文章 + 分类 + 工单。

## 该模块的 ports

| 端口 | 位置 | 说明 |
| --- | --- | --- |
| `FaqPort` | `lib/domain/ports/faq_port.dart` | FAQ 读/写用例的唯一入口 |

实现（适配器）：

| 实现 | 位置 | 用途 |
| --- | --- | --- |
| `RemoteFaqRepository` | `lib/data/repositories/remote_faq_repository.dart` | 走 `/api/v1/faq/*`，写操作带 `Idempotency-Key` |
| `MockFaqRepository` | `lib/data/mock/mock_faq_repository.dart` | 内存实现，**默认装配**，无后端可跑 |

| 方法 | HTTP | 备注 |
| --- | --- | --- |
| `listCategories()` | `GET faq/categories` | ⚠️ **后端没有这条路由**，见下 |
| `listArticles(FaqQuery)` | `GET faq/items?category=&q=` | 游标分页 + 分类 + 关键词；**无需登录** |
| `markHelpful(id, voterId:)` | `POST faq/items/:id/helpful` | **幂等**；响应 `{id, helpfulCount, counted}` |
| `listMyTickets()` | `GET faq/tickets` | 「我的工单」（需登录） |
| `submitTicket(command)` | `POST faq/tickets` | 未登录也可提交；响应含 `suggestions`（本端忽略） |

### 与 `services/api` 的实测对齐（重要）

交付前**读了 `services/api/src/modules/faq/`**（只读不改），发现并处理：

| 项 | `02-domain-model.md` | `services/api` 实现 | 本端处理 |
| --- | --- | --- | --- |
| 关键词参数 | `keyword` | `q` | 发 `q` |
| helpful 响应 | 整篇文章 + `counted` | `{ id, helpfulCount, counted }` | `FaqHelpfulResult` 只承载 `articleId + helpfulCount + counted`；两种响应形状都能解析 |
| 条目状态 | `DRAFT\|PUBLISHED\|ARCHIVED` | **没有 status 字段** | 缺字段按 `PUBLISHED`；"草稿不可见"仅在 mock 生效 |
| 条目字段 | 有 `slug` / `unhelpfulCount` | 无 | 缺省 `''` / `0`（不崩） |
| 工单状态 | `OPEN\|ANSWERED\|CLOSED` | 一致（大写） | 一致 |

### ⚠️ 三处需要 Lead / `api-nest` 处理的缺口（本端只上报，不改别人的作用域）

1. **`GET /faq/categories` 不存在**。`services/api` 只有 `GET /faq/suggestions`，
   `category` 只是条目上的一个字符串，服务端**没有分类列表端点**。
   本端的降级行为是**可见且不阻塞**的：分类条显示「分类加载失败 + 重试」，
   文章列表照常可用（`_CategoryBar` 刻意不把错误抛给整页）。mock 运行时不受影响。
2. **「有用」在真实后端需要登录**：`POST /faq/items/:id/helpful` 带 `AuthGuard`，
   幂等键是 JWT 里的 `actorId`（`voterKeyFor(actor)`），**不接受**请求体里的 voterId。
   本端的 `voterId` 参数因此只在 mock 下生效（真实后端下未登录点击会得到 401 →
   错误提示）。若产品要"未登录也能点有用"，需要后端加匿名投票端点。
   请求体里的 `voterId` 后端会忽略（该路由没有 body 校验），不会 400。
3. **`faq.helpful` 未登记在契约 §11.2** 的 action 表里（后端已实现）。
   请 Lead 补进 §11.2 + OpenAPI。

## 「有用」的**幂等**（本模块的核心要求）

> 同一用户重复点击只算一次。

三层保证：

| 层 | 做法 |
| --- | --- |
| 幂等键 | `FaqVoter`：已登录 → `u:<userId>`；未登录 → `d:<deviceId>`（契约 §2.8 检索无需登录）。两种前缀**不会混淆**，未登录时投的票不会被算到之后登录的人头上 |
| 服务端/mock | `MockFaqRepository` 按 `voterId` 去重：重复调用返回 `counted: false`（**不是失败**），计数不变。真实后端按 JWT 的 `actorId` 去重（同样幂等） |
| UI | 投票后写入 `faqHelpfulOverridesProvider`（`articleId -> 最新有用数`），按钮变「已标记有用」并禁用 —— 正常路径下根本不会发出第二次请求 |

`FaqHelpfulResult.counted` 是判断依据：`false` = 幂等命中，`alreadyVoted == true`。

**为什么不用 `ref.invalidate` 刷新列表**：那会把列表打回 loading，用户点一下「有用」
整页闪一次。这里用**局部覆盖**（`Map<articleId, int>`），只替换这一条的计数 ——
键的存在本身就表示"我已标记有用"，而且不依赖服务端是否回整篇文章。

设备 id 存在 `LocalCachePort`（键 `faq.deviceVoterId`）：首次生成后异步落盘，
保证冷启动后拿到同一个 id（否则幂等键会漂移）。

## 该模块的用例（application 层）

| 用例 | 位置 | 说明 |
| --- | --- | --- |
| `faqFilterProvider` | `application/faq_providers.dart` | 分类 + 关键词筛选（`FaqFilter`，含 `==` 以便 Riverpod 判变更） |
| `faqCategoriesProvider` | 同上 | 分类导航（`FutureProvider`） |
| `faqListControllerProvider` | 同上 | 文章列表：首屏 / 刷新 / 翻页；筛选变化即重载 |
| `faqVoterProvider` | 同上 | 幂等键：`sessionControllerProvider` + 设备 id |
| `faqHelpfulProvider` | 同上 | 「有用」动作（`FaqHelpfulActions`，不持有 `Ref`） |
| `faqHelpfulOverridesProvider` | 同上 | 本端已投过票的文章：`articleId -> 最新有用数`（局部覆盖 + `hasVoted`） |
| `faqTicketsControllerProvider` | 同上 | 我的工单列表（三态） |
| `faqTicketActionsProvider` | 同上 | 提交工单，成功后失效工单列表 |

搜索防抖：`faq_home_page.dart` 里 300ms 防抖，避免每敲一个字发一次请求。

## 隐私（契约 §2.8）

`contact` 是邮箱或微信，**不存明文手机号** —— 校验写在 domain
（`faqTicketContactError`），UI、mock、远端实现共用同一条规则：

- 空 → 「请留下邮箱或微信号，方便我们回复你」
- 手机号（`1[3-9]xxxxxxxxx`）→ 「请不要填写手机号（契约 §2.8：不存明文手机号）…」
- 邮箱 / 微信号 → 通过

`FaqTicket.userId` 可为 `null`（未登录也能提交）；`DRAFT` 文章对普通用户不可见。

## 页面（presentation）

| 页面 | 文件 | 内容 |
| --- | --- | --- |
| 常见问题首页 | `presentation/pages/faq_home_page.dart` | **搜索**（防抖）+ **分类导航** + **手风琴**（`ExpansionTile`）+ 「有用」+ 触底加载 + 三态 |
| 我的工单 | `presentation/pages/faq_tickets_page.dart` | 工单列表（状态徽标 / 官方回复）+ 提交工单对话框 + 三态 |
| 文章条目 | `presentation/components/faq_article_tile.dart` | 手风琴 + 幂等的「有用」按钮 |

「有用」按钮放在**展开区里**而不是标题旁，避免与 `ExpansionTile` 的展开手势打架。

## 三态

| 态 | 触发方式 |
| --- | --- |
| loading | 首帧 / 下拉刷新 / 切换分类或关键词 |
| error | 上游故障（🧪 菜单） |
| empty | 搜索无结果 → 「没有找到相关问题」；分类为空 → 「这个分类还没有内容」；工单为空 → 「还没有提交过工单」+ 引导 |
| data | 7 篇已发布 fixture（第 8 篇是 `DRAFT`，刻意用来验证"草稿不出现"） |

## 已实现 / 未实现

- ✅ 分类导航 + 搜索（防抖）+ 手风琴 + 「有用」（**幂等**）+ 我的工单 + 提交工单
- ✅ mock 与远端两套适配器，`AppRuntime` 按 `AppFlavor` 装配
- ✅ 亮/暗主题：所有色值走 `context.kedayaColors`（无硬编码色值）
- ❌ 文章 Markdown 渲染（当前按纯文本展示）、文章内锚点/相关推荐
- ❌ 工单追问与关闭（`FaqTicketStatus.canFollowUp` 已就绪，但没有 UI）
- ❌ 未登录提交工单的 UI 路径（`FaqTicket.userId` 可为 null 已在模型与 mock 支持，
  但页面装配的运行时始终是 `mockUser`）
- ❌ 本地化（i18n）：文案直接写中文，与全端一致

## 测试

- `test/domain/faq_article_test.dart` —— 文章/工单解析、搜索纯逻辑、联系方式与长度校验（含**拒绝手机号**）
- `test/domain/faq_voter_test.dart` —— 幂等键的稳定性与"设备票 ≠ 用户票"
- `test/data/mock_faq_repository_test.dart` —— 分类/检索/分页、**幂等计数**、工单归属与提交校验、故障注入
- `test/application/faq_controller_test.dart` —— 三态、筛选重载、幂等端到端（走 provider）、局部覆盖、工单提交

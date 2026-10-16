# feature: `buddy`（找搭子）

契约 §4.1 的 `buddy`（敏感级：**低**，**无同意门**）。规格文档：
`docs/features/buddy-matching.md`。领域骨架：`docs/architecture/02-domain-model.md` §2.3（已冻结）。

**需求原话 → 落地**：运动/自习/吃饭/出行**组队匹配** → 三板块活动列表 +
申请/审批/关闭 + 发布 + 匹配资料 + **可解释推荐**（展示理由）+ like/dislike/skip 反馈。

> **不做 dating**（契约 §11.10-G）：三个板块是 `academic` / `daily` / `sport`。
> 若未来要做，必须新开模块 ID + 新 ADR + 独立同意门，**不得挂在 `buddy` 下**。

---

## 1. 该模块的 ports

| 端口 | 位置 | 说明 |
| --- | --- | --- |
| `BuddyPort` | `lib/domain/ports/buddy_port.dart` | 活动 / 申请 / 推荐 / 反馈 / 匹配资料的唯一入口 |

实现（适配器）：

| 实现 | 位置 | 用途 |
| --- | --- | --- |
| `RemoteBuddyRepository` | `lib/data/repositories/remote_buddy_repository.dart` | 走 `/api/v1/buddy/*`；所有 `POST` 带 `Idempotency-Key` |
| `MockBuddyRepository` | `lib/data/mock/mock_buddy_repository.dart` | 内存实现，**默认装配**，无后端可跑（还扮演服务端做硬过滤 + 算分） |

端口方法 ↔ HTTP（规格 §5.1）：

| 方法 | HTTP | 备注 |
| --- | --- | --- |
| `getMyProfile()` | `GET buddy/profile` | 只有「我的」资料，**没有**读别人的方法（§6.1） |
| `saveMyProfile(profile)` | `PUT buddy/profile` | 整体替换；`userId` 由服务端决定 |
| `deleteMyProfile()` | `DELETE buddy/profile` | **硬删**（含 embedding），立即退出推荐池（§6.3） |
| `listPosts(query)` | `GET buddy/items` | 游标分页；`section`/`activity`/`tags`/`startsAfter`/`sort` |
| `getPost(id)` | `GET buddy/items/:id` | 已取消的活动对非发起人按 `NOT_FOUND` |
| `createPost(command)` | `POST buddy/items` | 请求体**不含** `creatorId` / `section` |
| `closePost(id)` | `POST buddy/items/:id/close` | action `close`（契约 §11.2） |
| `join(command)` | `POST buddy/items/:id/join` | action `join`；**申请不占名额** |
| `leave(id)` | `POST buddy/items/:id/leave` | action `leave`；`PENDING → WITHDRAWN` |
| `decide(command)` | `POST buddy/items/:id/decide` | action `decide`；body `{applicationId, decision}` |
| `listApplications({postId})` | `GET buddy/applications` | 不带 `postId` = 我申请的；带 = 我收到的（仅发起人） |
| `recommend(query)` | `GET buddy/recommendations?section=` | 响应带 `matchMode`，每条带非空 `reason` |
| `submitFeedback(feedback)` | `POST buddy/items/:id/feedback` | body `{section, action}`；UPSERT |

五个 action 名（`join`/`leave`/`close`/`decide`/`feedback`）**已登记**在契约 §11.2（v1.2 起），
本端不自创路由。**没有** `moderate`（管理员能力），**没有**问卷方法（见 §5）。

---

## 2. 用例（application 层）

`lib/features/buddy/application/buddy_providers.dart`：

| provider | 作用 |
| --- | --- |
| `buddySectionFilterProvider` | 三板块分栏的选中项（列表页与推荐页共用；`unknown` 会被拒绝） |
| `buddyListControllerProvider` | 活动列表（游标分页 + 下拉刷新 + 触底加载；翻页失败保留列表） |
| `buddyPostProvider(id)` | 活动详情 |
| `buddyProfileProvider` | 我的匹配资料 |
| `buddyMyApplicationsProvider` | 我作为**申请人**的申请列表 |
| `buddyPostApplicationsProvider(id)` | 某帖收到的申请（仅发起人） |
| `buddyRecommendControllerProvider` | 推荐（带 `matchMode`；资料变化时自动重算） |
| `buddyActionsProvider` | 写操作：发布 / 申请 / 撤回 / 审批 / 关闭 / 反馈 / 保存资料 / 删除资料 |

`BuddyActions` **不持有 `Ref`**（只拿端口 + 失效回调），因此能在测试里直接构造。
反馈**刻意不失效列表** —— 立刻重排会让用户以为"点一下内容就没了"。

---

## 3. 匹配算法：Dart 侧镜像是干什么的

`@kedaya/shared` 的 `buddy` 子模块是 **TypeScript**，Flutter 端无法 import。
因此 `lib/domain/models/buddy_matching.dart` **镜像**了它的最小必要部分：

| 本端 | TS 侧 | 规格 |
| --- | --- | --- |
| `buddyRuleCoefficients` / `buddyRuleScoreFor` | `ruleScoreFor` | §3.3 的三板块系数表 |
| `buddyExplainMatch` | `explainMatch` | §5.7 的理由构造规则 |
| `buddyOverlapsAvailability` | `overlapsAvailability` | §3.3 的 F7（含跨零点） |
| `buddyFeedbackAdjustment` / `buddyExpNeg` | `feedbackAdjustment` | §3.6 的反馈与衰减 |

> **文件头写明了「镜像自 `packages/shared/src/buddy/scoring.ts`，改一处必须改两处」**，
> 且 `test/domain/buddy_matching_test.dart` 把 §3.3 的每个数字**逐字写死** ——
> 谁手改了系数，测试立刻红。

**这不是客户端匹配引擎**：权威实现在服务端（`services/api/src/modules/buddy/`）。
镜像只服务两件事：① `MockBuddyRepository` 在无后端时给出与线上一致的排序与理由
（契约 §7 硬规则 4）；② 本地可解释性。客户端**不**改写服务端给的 `score` / `reason` /
`matchMode`（展示以服务端为准）。

**系数（逐字对齐 §3.3）**：

| 板块 | 规则 | 加分 |
| --- | --- | --- |
| `academic` | 同 `department` | `+0.4` |
| | 共同 `interestTags` | `+min(0.3, 0.10 × n)` |
| | 共同 `activityTags` | `+0.1` |
| `daily` | 共同 `interestTags` | `+min(0.5, 0.15 × n)` |
| | 可用时段重叠 | `+0.2` |
| | 同 `preferredAreas` | `+0.1` |
| `sport` | `skillLevel` 相同 | `+0.3` |
| | 共同 `activityTags` | `+min(0.4, 0.15 × n)` |
| | 共同 `interestTags` | `+min(0.2, 0.10 × n)` |
| | 同 `preferredAreas` | `+0.1` |

**刻意删除**（§3.3）：同学校 `+0.2`（单校部署恒为真、零信息量）、同学历（我们无 `education_level`）。
**融合**（§3.4）：`rule` 档 = `clamp(ruleScore + feedbackAdjustment, 0, 1)`；
`vector`/`hash` 档 = `clamp(baseScore × 0.70 + ruleScore × 0.30 + adj, 0, 1)`
（`towerScore` 恒为 `None`，与 STUMatch 的 "no tower" 分支逐字一致）。

**硬过滤 F1–F7**（§3.3，在打分之前）：F1 `OPEN` 且未满、F2 未开始、F3 非自己发的、
F4 我未申请过（`PENDING`/`ACCEPTED`）、F5 性别准入相容、F6 我的水平 ≥ `minSkillLevel`、
F7 活动窗口与我的可用时段有交集。

**理由顺序**有实证依据：§5.7 的示例 `"运动水平相同、共同活动：羽毛球、常去同一区域"`
正是 `sport` 板块按 §3.3 的**表格行序**输出的前 3 条，本端据此实现（有单测锁定）。

---

## 4. 隐私：承诺 ↔ 实现

| 承诺（`/buddy/privacy`） | 代码里的落点 |
| --- | --- |
| 默认不参与匹配 | `BuddyProfile.matchEnabled` 默认 `false`；`isRecommendable` 才进推荐池 |
| 可随时撤回 | `deleteMyProfile()` 硬删该行 + 清空本地反馈 |
| 匹配资料对任何人不可见 | 端口**只有** `getMyProfile`；`mock` 里他人资料只用于算分，不进任何响应模型 |
| 不采集敏感属性 | `BuddyProfile` 无 `gender`/`age`/`birthDate`/`mbti`/精确坐标；解析时这些键**永不被读取** |
| 不进通用画像 | 本端不向 `ai-portrait` 暴露任何数据（服务端 Guard 的拒绝列表是权威，见规格 §6.3） |
| 反馈针对活动不针对人 | `BuddyMatchFeedback.targetPostId`（**没有** `targetUserId`） |
| 联系方式不落在活动上 | `buddyContactInfoKind()` 拒绝手机号/微信/QQ/邮箱；`BuddyCreator` 只有 `id`/`nickname`/`avatarUrl` |
| 不做 dating | `BuddySection` 只有三个真实板块；`fromWire('dating')` → `unknown` 且 `isMatchable == false` |
| 保留期与审计 | 低敏感模块，不做逐次审计（服务端 retention-policy 登记见规格 §10） |

守门测试：`test/domain/buddy_privacy_boundary_test.dart`（含**源码机械扫描**：
`lib/` 下所有 `buddy*` 文件里没有 `'dating'` 字符串字面量）。

**为什么这里没有同意门**：契约 §9 的判定规则把 `buddy` 定为敏感级**低**、**无同意门**
（`packages/contracts/src/modules.test.ts`）。本端因此**不经过** `ConsentPort`，
也**不会**返回 `CONSENT_REQUIRED`（规格 §5.10 显式声明）。这是刻意的 ——
一旦加入 dating，就必须新增同意门 + 新 ADR + 新 PIA 条目（规格 §1.3）。

---

## 5. 页面（presentation）

| 路由 | 页面 | 内容 |
| --- | --- | --- |
| `/buddy` | `BuddyBoardPage` | 三板块分栏 + 活动列表（游标分页 + 下拉刷新 + 触底加载）+ 「我的申请」弹层 |
| `/buddy/compose` | `BuddyComposePage` | 发布：活动类型（派生板块）/ 标题 / 说明 / 地点白名单 / 时间 / 时长 / 人数 / 性别偏好 / **封闭标签选择器** / 运动水平要求 |
| `/buddy/recommend` | `BuddyRecommendPage` | 推荐：**展示 `explainMatch` 的理由** + `matchMode` 诚实提示 + like/dislike/skip |
| `/buddy/profile` | `BuddyProfilePage` | 匹配资料：板块 / 兴趣与活动标签 / **可用时段编辑器（含跨零点）** / 偏好区域 / 技能水平 / 院系 / 自述 / 匹配开关 / 删除资料 |
| `/buddy/privacy` | `BuddyPrivacyPage` | 隐私说明（§4 的承诺逐条） |
| `/buddy/:id` | `BuddyPostDetailPage` | 详情 + 申请（`join`）/ 撤回（`leave`）/ 审批（`decide`）/ 关闭（`close`） |

组件：`buddy_cards.dart`（活动卡 / 推荐卡 / 申请卡 / 分栏 chip / 状态徽标）、
`buddy_tag_picker.dart`（**封闭标签选择器**）、`buddy_availability_editor.dart`（时段编辑器）。

### 三态

所有列表页走 `AsyncStateView`（loading / error / empty / data）。
mock 运行时时右上角 🧪 菜单可切换 **正常 / 空列表 / 上游故障**。
翻页失败**不打死整页**（保留已加载内容，只在 footer 挂错误 + 重试）。

### 已实现 / 未实现

**已实现**：上表全部路由；`BuddyPort` 的 13 个方法；两套适配器；
19 个新 lib Dart 文件 + 本 README；10 个新测试文件 / **199 个用例**。

**未实现（如实列出，没有用 TODO 占位）**：

| 项 | 说明 |
| --- | --- |
| 问卷（`BuddyQuestionnaire` / `Response`，规格 §2.6） | 未实现；`BuddyPort` **不提供**假接口 |
| 独立的「我的申请」列表页 | 只有底部弹层；申请状态也可在各活动详情页看到 |
| 举报入口 | 规格 §6.4 说复用 `forum.report`，但那是 `forum` 内容的举报；跨模块举报需要统一的 `Report` 表（规格 §9 U11），本端**不新建举报表** |
| 联系方式交换 | 依赖 `notifications` 模块与 `profile` 的「匹配成功后可见」字段（规格 §6.2 / U8，**跨模块依赖**）；本端只展示说明文案 |
| 服务端算分 | 权威实现在 `services/api`；本端只在 mock 里复算 |
| `PATCH /items/:id`（更新活动） | 端口未暴露；规格 §5.1 有该端点，但本端 UI 没有"编辑活动"入口 |

---

## 6. 与规格的偏离 / 需要 Lead 裁定（**本端没有改 `docs/` 与 `packages/`**）

1. **可用时段上界放宽到 1440**（规格 §2.2 写 0–1439）。
   「23:00 到午夜」用 1439 会留 **1 分钟空洞**，且跨零点拆分必须用到 1440。
   落点是**一个常量** `buddyAvailabilityEndMinMax`，改回 1439 是单点改动。
2. **`ruleScoreFor` 的两个入参来源**规格未逐字指定，本端按「推荐单位是帖子」绑定：
   共同 `activityTags` = `me.activityTags ∩ post.tags`（§2.3 说 `post.tags` 是"匹配打分的主特征"）；
   共同 `interestTags` / 同 `department` / 同 `skillLevel` / 同 `preferredAreas` = 我 vs **发起人的资料**。
   `daily` 的「可用时段重叠 +0.2」用的是 F7 的同一个信号（规格把它注解为"非硬过滤时的软分"）。
3. **F7 的两处宽松**：我没填任何可用时段时 F7 不作约束；帖子没有 `durationMin` 时也不作约束。
   否则"只填了兴趣没填时段"的用户会看到**空推荐**。
4. **`join` 的错误码优先级**：规格 §5.5 的参考实现**先查 `status` 再查名额**，
   因此已满（`FULL`）的帖子报 `POST_NOT_OPEN` 而不是 `POST_FULL`。本端逐字对齐规格代码；
   `POST_FULL` 只在「状态还是 `OPEN` 但名额已满」这种不一致态下触发（正是那段 `FOR UPDATE` 要防的）。
5. **`REJECTED` 后不能重新申请**：规格 §2.8 的 `REJECTED` 是终态，唯一约束又要求复用同一行，
   因此本端把"已 `REJECTED` 再次 `join`"判为 `ALREADY_APPLIED`。若产品要求"被拒后可再申请"，
   需要 Lead 裁决状态机。
6. **联系方式正则收敛**：规格 §6.4 的 `[Vv]信?\s*[:：]?\s*\w+` 会把 `video` / `version`
   判成微信号。本端要求 `v`/`V` 裸形式**必须带冒号**（仍覆盖 `v: abc`、`微信：abc`）。
7. **校园地点白名单是占位**：规格 §9 U10 **至今未关闭**（谁维护、内容是什么没有答案）。
   本端给了一份上科大校园地点的合理占位，落点是 `buddyCampusLocations` 一个常量。
8. **封闭标签表是客户端镜像**：规格 §3.2 说权威表在 DB（可运营）。
   本端镜像了 41 个标签供选择器与理由渲染；服务端新增标签后必须同步本表。
9. **推荐列表的游标**：规格 §5.7 的 `nextCursor` 本端编码为 `(score, id)`（不透明），
   与列表的 `(startsAt, id)` 是两套；客户端一律原样回传（契约 §11.10-E）。
10. **`currentUserGender` / `creatorGenders` 是 mock 的测试旋钮**：
    客户端**不采集**性别（§6.3），F5 的真实判定只能在服务端做。

---

## 7. 测试

| 文件 | 覆盖 |
| --- | --- |
| `test/domain/buddy_matching_test.dart` | **§3.3 系数逐字校验**、`min(cap, perHit×n)`、三板块上限 0.8/0.8/1.0、**§5.7 理由（含文档示例逐字一致）**、**F7 跨零点/时区边界**、`clamp`、融合公式、**反馈权重与衰减**、`buddyExpNeg` 精度、`matchMode` 诚实文案 |
| `test/domain/buddy_post_test.dart` | `sectionOf` 全覆盖、**5×5 状态机矩阵**、payload 里的 `section: dating` 被忽略、敏感键不被读取、creator 两种形状、`BuddyPostQuery`、**发布草稿逐条校验**（含联系方式检测不误伤英文单词） |
| `test/domain/buddy_profile_test.dart` | `AvailabilitySlot` 校验、**跨零点拆分**（含周六→周日）、`normalizeAvailability`、本地时间文案、`matchEnabled` 默认 false、资料校验逐条、**封闭标签表完整性 + 别名搜索** |
| `test/domain/buddy_application_test.dart` | 申请状态机 4×4 矩阵、`BuddyDecision`、留言长度与联系方式、命令请求体形状 |
| `test/domain/buddy_privacy_boundary_test.dart` | **无 dating**（枚举 / `fromWire` / 源码扫描）、响应键名黑名单、`BuddyCreator` 只有三字段、反馈针对帖子、**端口没有读他人资料的出口** |
| `test/data/mock_buddy_repository_test.dart` | 列表状态/板块/活动/标签/时间过滤、**游标不重不漏**、损坏游标容错、可见性、发布校验逐条、**`join` 不占名额**、撤回后复用同一行、F5/F6、`decide` 名额与满员、`close` 归属、申请列表可见性、反馈 UPSERT、资料保存/删除、mock 三态开关 |
| `test/data/mock_buddy_recommend_test.dart` | 未开启匹配 → 「按时间排序」、开启后 **F1–F7 逐条**、分数与理由逐字断言、排序、**反馈影响分数**、**section 隔离**、limit 收敛 |
| `test/application/buddy_controller_test.dart` | 三态、三板块分栏切换、翻页失败保留列表、详情 provider、写操作后的 provider 失效 |
| `test/application/buddy_recommend_controller_test.dart` | 三态、板块切换、翻页、**打开匹配开关后从降级变成可解释推荐**、反馈后 `refresh` 生效、删除资料后回到诚实降级 |
| `test/presentation/buddy_widget_test.dart` | 活动卡/推荐卡文案约束、**理由必须展示**、**降级档不出现「为你智能推荐」**、分栏只有三个板块、**时段编辑器对话框预览跨零点拆分**、隐私页九条承诺、**列表页与推荐页在亮/暗主题下均可用** |

> ⚠️ **全部用例都没有在本机执行过**（本机没有 Flutter SDK）。见 `apps/mobile/README.md` §6 与 §8。

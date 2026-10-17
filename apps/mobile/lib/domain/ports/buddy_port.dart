/// `buddy` 业务端口（契约 §4.1 `buddy`，敏感级 **低**、**无同意门**）。
///
/// 规格 `docs/features/buddy-matching.md` §5.1 的端点总表 ↔ 本端口：
///
/// | 方法 | HTTP | 幂等键 |
/// | --- | --- | --- |
/// | [getMyProfile] | `GET buddy/profile` | — |
/// | [saveMyProfile] | `PUT buddy/profile`（整体替换） | 可选 |
/// | [deleteMyProfile] | `DELETE buddy/profile`（硬删，含 embedding） | 可选 |
/// | [listPosts] | `GET buddy/items` | — |
/// | [createPost] | `POST buddy/items` | **必需** |
/// | [getPost] | `GET buddy/items/:id` | — |
/// | [closePost] | `POST buddy/items/:id/close`（action `close`） | **必需** |
/// | [join] | `POST buddy/items/:id/join`（action `join`） | **必需** |
/// | [leave] | `POST buddy/items/:id/leave`（action `leave`） | **必需** |
/// | [decide] | `POST buddy/items/:id/decide`（action `decide`） | **必需** |
/// | [listApplications] | `GET buddy/applications` | — |
/// | [recommend] | `GET buddy/recommendations` | — |
/// | [submitFeedback] | `POST buddy/items/:id/feedback`（action `feedback`） | **必需** |
///
/// 五个 action 名（`join` / `leave` / `close` / `decide` / `feedback`）
/// **已登记**在契约 §11.2（v1.2 起），本端不自创路由。
///
/// ## 本端口**刻意没有**的能力
///
/// - **没有**「读取他人 `BuddyProfile`」的方法：规格 §6.1 的可见性矩阵规定
///   `BuddyProfile` 对**任何人**都不可见（包括发帖人），它只被算法使用。
///   因此这里不存在任何会泄漏他人资料的方法签名 —— 不是 UI 记得别调，而是没有出口。
/// - **没有**问卷相关方法：`BuddyQuestionnaire`（规格 §2.6）**未实现**
///   （见 feature README §5「未实现」），不提供假接口。
/// - **没有** `moderate`：审核是管理员能力，学生端不提供入口。
/// - **没有** dating 相关方法（契约 §11.10-G）。
///
/// ## 不使用的冻结错误码（规格 §5.10，显式声明）
///
/// | 错误码 | 是否使用 | 理由 |
/// | --- | --- | --- |
/// | `CAMPUS_BINDING_REQUIRED` | **不用** | `buddy` 不需要任何校园系统能力 |
/// | `CONSENT_REQUIRED` | **不用** | `buddy` 敏感级低、**无同意门**（契约 §9）。**刻意如此** —— 若未来加入 dating 板块，就必须启用此码 + 新增同意门（§1.3） |
/// | `UPSTREAM_UNAVAILABLE` | 可能用 | 仅当 `vector` 模式的 embedding 是外部依赖时 |
library;

import '../models/buddy.dart';
import '../models/buddy_application.dart';
import '../models/buddy_matching.dart';
import '../models/buddy_profile.dart';
import '../models/page.dart';
import '../models/result.dart';

abstract interface class BuddyPort {
  // -------------------------------------------------------------- 匹配资料

  /// `GET /api/v1/buddy/profile` —— 读**我的**匹配资料。
  ///
  /// 没有对应「读别人的资料」的方法（规格 §6.1）。
  Future<Result<BuddyProfile>> getMyProfile();

  /// `PUT /api/v1/buddy/profile` —— **整体替换**我的匹配资料。
  ///
  /// 打开匹配开关（`matchEnabled = true`）是**显式动作**：规格 §6.3
  /// 「匹配需要暴露『我的兴趣/可用时段』给算法，属于对个人信息的新用途，不默认开启」。
  Future<Result<BuddyProfile>> saveMyProfile(BuddyProfile profile);

  /// `DELETE /api/v1/buddy/profile` —— **硬删**该行（含 `embedding`），
  /// 立即从推荐池移除（规格 §6.3「可随时撤回」）。
  Future<Result<Unit>> deleteMyProfile();

  // -------------------------------------------------------------- 活动列表

  /// `GET /api/v1/buddy/items` —— 活动列表（**游标分页**，不用 offset）。
  ///
  /// 游标对客户端**完全不透明**（契约 §11.10-E）：只能原样回传。
  Future<Result<Page<BuddyPost>>> listPosts(BuddyPostQuery query);

  /// `GET /api/v1/buddy/items/:id`。
  ///
  /// 不可见/不存在的活动一律 `NOT_FOUND`（不区分，避免成为枚举旁路）。
  Future<Result<BuddyPost>> getPost(String id);

  /// `POST /api/v1/buddy/items` —— 发布活动（契约 §11.3：POST 必须带 `Idempotency-Key`）。
  Future<Result<BuddyPost>> createPost(CreateBuddyPostCommand command);

  /// `POST /api/v1/buddy/items/:id/close` —— **发起人**关闭活动
  /// （`OPEN`/`FULL` → `CLOSED`，action 名 `close` 见契约 §11.2）。
  ///
  /// 刻意叫 `close` 而不是 `cancel`：`CANCELLED` 由 `DELETE /items/:id` 触发，
  /// 动作名与状态名一一对应（规格 §5.2）。
  Future<Result<BuddyPost>> closePost(String postId);

  // -------------------------------------------------------------- 申请与审批

  /// `POST /api/v1/buddy/items/:id/join` —— 申请加入。
  ///
  /// ⚠️ `join` 是**申请**不是**入队**：它**不**递增 `joinedCount`，
  /// 只有 [decide]`(ACCEPTED)` 才递增（规格 §5.5 的重要语义澄清）。
  Future<Result<BuddyApplication>> join(BuddyJoinCommand command);

  /// `POST /api/v1/buddy/items/:id/leave` —— 申请人撤回（`PENDING → WITHDRAWN`）。
  ///
  /// 撤回后重新申请是**更新**同一行回 `PENDING`（`@@unique([postId, applicantId])`，
  /// 规格 §2.4 / 未决项 U7）。
  Future<Result<BuddyApplication>> leave(String postId);

  /// `POST /api/v1/buddy/items/:id/decide` —— **发起人**接受/拒绝某条申请。
  ///
  /// `ACCEPTED` → `joinedCount += 1`；满员 → 帖子转 `FULL`（规格 §5.6）。
  /// **拒绝不给理由**（发起人无义务解释，且理由文本会成为骚扰面）。
  Future<Result<BuddyApplication>> decide(BuddyDecideCommand command);

  /// `GET /api/v1/buddy/applications` —— 我的申请列表
  /// （作为申请人看自己的；作为发起人用 [postId] 过滤看某帖收到的）。
  ///
  /// 规格 §6.1：**申请人列表**对已登录他人 ❌，只有发起人与申请人本人能看到。
  Future<Result<List<BuddyApplication>>> listApplications({String? postId});

  // -------------------------------------------------------------- 推荐与反馈

  /// `GET /api/v1/buddy/recommendations?section=` —— 主动推荐。
  ///
  /// 响应必带 `matchMode`（`vector`/`hash`/`rule`），且每条推荐的 `reason`
  /// **必须非空**（规格 §5.7 / §1.1 G3）。未开启匹配资料时**不报错**，
  /// 返回 `matchMode: "rule"` + 按 `startsAt` 排序的开放帖子、
  /// `reason` 统一为「按时间排序」、`score` 为 `0`。
  Future<Result<BuddyRecommendationPage>> recommend(BuddyRecommendQuery query);

  /// `POST /api/v1/buddy/items/:id/feedback` —— 提交 `like`/`dislike`/`skip`。
  ///
  /// UPSERT（`@@unique([userId, targetPostId, section])`），副作用是
  /// 让下一次推荐立刻反映反馈（规格 §5.8）。
  Future<Result<BuddyMatchFeedback>> submitFeedback(
      BuddyMatchFeedback feedback);
}

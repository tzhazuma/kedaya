import 'anonymous_identity.dart';
import 'api_request.dart';
import 'json_read.dart';
import 'validate.dart';

/// 匿名开关旁**必须**展示的说明（契约 §9）。
///
/// 放在 domain 而不是页面里：这句话是匿名语义的一部分，测试要能机械校验它
/// 确实存在且措辞正确，而不是散落在某个 widget 的字面量里。
const String anonymousPostNotice = '匿名后你的实名身份不会与帖子关联';
const String anonymousReplyNotice = '匿名后你的实名身份不会与回复关联';

/// 版块可见性（契约 §2.4 `ForumBoard.visibility`）。
enum ForumBoardVisibility {
  public('public', '公开'),
  campusOnly('campus_only', '仅校内'),

  /// 后端新增枚举值而客户端未升级时的兜底。
  unknown('unknown', '未知');

  const ForumBoardVisibility(this.wire, this.label);

  final String wire;
  final String label;

  static ForumBoardVisibility fromWire(String wire) {
    for (final ForumBoardVisibility value in ForumBoardVisibility.values) {
      if (wireEquals(value.wire, wire)) return value;
    }
    return ForumBoardVisibility.unknown;
  }
}

/// 主题状态机（契约 §2.4 `ForumPost`）。
enum ForumPostStatus {
  draft('DRAFT', '草稿'),
  published('PUBLISHED', '已发布'),
  locked('LOCKED', '已锁定'),
  hidden('HIDDEN', '已隐藏'),
  deleted('DELETED', '已删除'),

  /// 兜底：未知状态按**不可回复**处理（宁可保守，也不要在已隐藏的帖子上放行回复）。
  unknown('unknown', '未知');

  const ForumPostStatus(this.wire, this.label);

  final String wire;
  final String label;

  static ForumPostStatus fromWire(String wire) {
    for (final ForumPostStatus value in ForumPostStatus.values) {
      if (wireEquals(value.wire, wire)) return value;
    }
    return ForumPostStatus.unknown;
  }
}

/// 回复状态（契约 §2.4 `ForumReply`）。
enum ForumReplyStatus {
  published('PUBLISHED', '已发布'),
  hidden('HIDDEN', '已隐藏'),
  deleted('DELETED', '已删除'),
  unknown('unknown', '未知');

  const ForumReplyStatus(this.wire, this.label);

  final String wire;
  final String label;

  static ForumReplyStatus fromWire(String wire) {
    for (final ForumReplyStatus value in ForumReplyStatus.values) {
      if (wireEquals(value.wire, wire)) return value;
    }
    return ForumReplyStatus.unknown;
  }
}

/// 举报对象类型（契约 §2.4 `ForumReport.targetType`）。
enum ForumReportTargetType {
  post('POST', '主题'),
  reply('REPLY', '回复');

  const ForumReportTargetType(this.wire, this.label);

  final String wire;
  final String label;

  static ForumReportTargetType fromWire(String wire) {
    for (final ForumReportTargetType value in ForumReportTargetType.values) {
      if (wireEquals(value.wire, wire)) return value;
    }
    return ForumReportTargetType.post;
  }
}

/// 举报理由（契约 §2.4 `ForumReport.reason`）。
///
/// ⚠️ **跨端取值不一致（已上报 Lead）**：`docs/architecture/02-domain-model.md`
/// §2.4 写的是 `spam|abuse|illegal|privacy|other`，而 `services/api` 的规范值是
/// `spam|abuse|pii|illegal|other`（后端**同时接受** `privacy` 并归一化为 `pii`）。
/// 本端的处理：**发送规范值 `pii`**，**解析时两种都认** —— 这样两个方向都不会 400，
/// 也不会把历史数据读成"其它"。最终以 Lead 统一后的枚举为准。
enum ForumReportReason {
  spam('spam', '垃圾广告'),
  abuse('abuse', '人身攻击'),
  illegal('illegal', '违法违规'),
  privacy('pii', '泄露隐私'),
  other('other', '其它');

  const ForumReportReason(this.wire, this.label);

  final String wire;
  final String label;

  /// 兼容别名（旧写法 → 本端枚举）。
  static const Map<String, ForumReportReason> aliases =
      <String, ForumReportReason>{
    'privacy': ForumReportReason.privacy,
  };

  static ForumReportReason fromWire(String wire) {
    for (final ForumReportReason value in ForumReportReason.values) {
      if (wireEquals(value.wire, wire)) return value;
    }
    for (final MapEntry<String, ForumReportReason> entry in aliases.entries) {
      if (wireEquals(entry.key, wire)) return entry.value;
    }
    return ForumReportReason.other;
  }
}

/// 举报处理状态（契约 §2.4 `ForumReport.status`）。
enum ForumReportStatus {
  pending('PENDING', '待处理'),
  upheld('UPHELD', '已受理'),
  dismissed('DISMISSED', '已驳回'),
  unknown('unknown', '未知');

  const ForumReportStatus(this.wire, this.label);

  final String wire;
  final String label;

  static ForumReportStatus fromWire(String wire) {
    for (final ForumReportStatus value in ForumReportStatus.values) {
      if (wireEquals(value.wire, wire)) return value;
    }
    return ForumReportStatus.unknown;
  }
}

/// 作者引用 —— **实名与匿名是两个不同的类型**（契约 §9 在模型层面的落点）。
///
/// 注意：本类型**没有** `userId` getter。想拿实名 id 必须调用
/// [realUserIdOrNull] 并显式处理 null —— 匿名作者返回 null，
/// 于是"匿名帖子顺手带上作者"这种泄漏不可能悄悄发生。
sealed class ForumAuthor {
  const ForumAuthor();

  /// 从**扁平的** wire 形状解析（契约 §2.4 把 `anonymous` / `authorId` 直接挂在
  /// `ForumPost` / `ForumReply` 上，而不是嵌套一个 author 对象）。
  ///
  /// `anonymous == true` 时**只**读取 `anonymousIdentity`；
  /// 即使 payload 里混进了实名的 `authorId`，也会被**丢弃** ——
  /// 客户端不持有匿名 ↔ 实名的映射，拿到也不该用。
  ///
  /// **两种 wire 形状都兼容**（跨端实测差异，已上报 Lead）：
  ///   · `docs/architecture/02-domain-model.md` §2.4：`anonymous: true` +
  ///     `anonymousIdentity { id, alias, boardId }`；
  ///   · `services/api` 当前实现：`authorId: null`，**不下发** `anonymousIdentity`
  ///     （后端只保留私有的 `anonHandle` HMAC，客户端拿不到、也不该拿）。
  ///     此时合成一个**只用于展示**的匿名身份（不含任何实名信息）。
  /// 匿名判定：`anonymous == true` **或** `authorId == null`。
  factory ForumAuthor.fromJson(Map<String, Object?> json, {String? boardId}) {
    final bool anonymous =
        readBoolOr(json, 'anonymous', json['authorId'] == null);
    if (anonymous) {
      final Map<String, Object?>? identity =
          readMapOrNull(json, 'anonymousIdentity');
      if (identity != null) {
        return AnonymousAuthor(AnonymousIdentity.fromJson(identity));
      }
      return AnonymousAuthor(
        AnonymousIdentity(
          id: 'anon-${boardId ?? 'unknown'}',
          alias: '匿名用户',
          boardId: boardId,
        ),
      );
    }
    return RealAuthor(
      userId: readStringOrNull(json, 'authorId') ?? 'unknown',
      name: readStringOrNull(json, 'authorName'),
    );
  }

  /// 对外可见的作者标识：实名时是 `userId`，匿名时是 `AnonymousIdentity.id`。
  String get authorId;

  /// 展示名（匿名时为别名）。
  String get displayName;

  bool get isAnonymous;

  /// 实名 id；匿名作者**一定**返回 null。
  String? get realUserIdOrNull;

  /// 序列化回扁平的 wire 形状。
  Map<String, Object?> toJson();
}

/// 实名作者。
final class RealAuthor extends ForumAuthor {
  const RealAuthor({required this.userId, this.name});

  final String userId;

  /// 昵称；为空时展示 [userId]。
  final String? name;

  @override
  String get authorId => userId;

  @override
  String get displayName => (name != null && name!.isNotEmpty) ? name! : userId;

  @override
  bool get isAnonymous => false;

  @override
  String? get realUserIdOrNull => userId;

  @override
  Map<String, Object?> toJson() => <String, Object?>{
        'anonymous': false,
        'authorId': userId,
        'authorName': name,
      };

  @override
  bool operator ==(Object other) =>
      other is RealAuthor && other.userId == userId;

  @override
  int get hashCode => userId.hashCode;

  @override
  String toString() => 'RealAuthor($userId)';
}

/// 匿名作者。
///
/// **没有** `userId` 字段 —— 这是刻意的：匿名帖子的作者信息在客户端
/// 根本无法表达成实名身份。
final class AnonymousAuthor extends ForumAuthor {
  const AnonymousAuthor(this.identity);

  final AnonymousIdentity identity;

  @override
  String get authorId => identity.id;

  @override
  String get displayName => identity.displayName;

  @override
  bool get isAnonymous => true;

  @override
  String? get realUserIdOrNull => null;

  @override
  Map<String, Object?> toJson() => <String, Object?>{
        'anonymous': true,
        'anonymousIdentity': identity.toJson(),
      };

  @override
  bool operator ==(Object other) =>
      other is AnonymousAuthor && other.identity == identity;

  @override
  int get hashCode => identity.hashCode;

  @override
  String toString() => 'AnonymousAuthor(${identity.id})';
}

/// 版块（契约 §2.4 `ForumBoard`）。
final class ForumBoard {
  const ForumBoard({
    required this.id,
    required this.slug,
    required this.name,
    required this.visibility,
    this.description,
    this.postCount = 0,
  });

  factory ForumBoard.fromJson(Map<String, Object?> json) => ForumBoard(
        id: readString(json, 'id'),
        slug: readStringOr(json, 'slug', ''),
        name: readString(json, 'name'),
        visibility: ForumBoardVisibility.fromWire(
            readStringOr(json, 'visibility', 'public')),
        description: readStringOrNull(json, 'description'),
        postCount: readIntOr(json, 'postCount', 0),
      );

  final String id;

  /// 唯一，由 `slugify` 生成。
  final String slug;

  final String name;
  final String? description;
  final ForumBoardVisibility visibility;

  /// 冗余计数（后端维护）。
  final int postCount;

  /// `campus_only` 版块需要登录（契约 §2.4）。
  bool get requiresSignIn => visibility == ForumBoardVisibility.campusOnly;

  Map<String, Object?> toJson() => <String, Object?>{
        'id': id,
        'slug': slug,
        'name': name,
        'visibility': visibility.wire,
        'description': description,
        'postCount': postCount,
      };

  @override
  bool operator ==(Object other) => other is ForumBoard && other.id == id;

  @override
  int get hashCode => id.hashCode;

  @override
  String toString() => 'ForumBoard($id, $name)';
}

/// 主题（契约 §2.4 `ForumPost`）。
final class ForumPost {
  const ForumPost({
    required this.id,
    required this.boardId,
    required this.title,
    required this.body,
    required this.author,
    required this.createdAt,
    this.status = ForumPostStatus.published,
    this.boardName,
    this.tags = const <String>[],
    this.replyCount = 0,
    this.likeCount = 0,
    this.pinnedAt,
    this.updatedAt,
  });

  factory ForumPost.fromJson(Map<String, Object?> json) {
    // `services/api` 的字段名是 `board`（02-domain-model §2.4 写的是 `boardId`）：
    // 两个都认，避免一个字段名差异让整条解析失败。
    final String boardId =
        readStringOrNull(json, 'boardId') ?? readString(json, 'board');
    return ForumPost(
      id: readString(json, 'id'),
      boardId: boardId,
      title: readString(json, 'title'),
      body: readString(json, 'body'),
      author: ForumAuthor.fromJson(json, boardId: boardId),
      createdAt: readDateTime(json, 'createdAt'),
      status:
          ForumPostStatus.fromWire(readStringOr(json, 'status', 'PUBLISHED')),
      boardName: readStringOrNull(json, 'boardName'),
      tags: readStringList(json, 'tags'),
      replyCount: readIntOr(json, 'replyCount', 0),
      likeCount: readIntOr(json, 'likeCount', 0),
      pinnedAt: readDateTimeOrNull(json, 'pinnedAt'),
      updatedAt: readDateTimeOrNull(json, 'updatedAt'),
    );
  }

  final String id;
  final String boardId;
  final String title;
  final String body;

  /// 作者：实名或匿名，二者是不同类型（契约 §9）。
  final ForumAuthor author;

  final ForumPostStatus status;
  final DateTime createdAt;
  final String? boardName;
  final List<String> tags;
  final int replyCount;
  final int likeCount;
  final DateTime? pinnedAt;
  final DateTime? updatedAt;

  /// 契约 §2.4 的 `anonymous` 字段（由 [author] 派生，避免两处状态漂移）。
  bool get anonymous => author.isAnonymous;

  /// 契约 §2.4 的 `authorId` 字段：匿名时是 `AnonymousIdentity.id`。
  String get authorId => author.authorId;

  bool get isPinned => pinnedAt != null;

  bool get isLocked => status == ForumPostStatus.locked;

  /// 只有 `PUBLISHED` 能新增回复（`LOCKED` 禁止新回复，契约 §2.4 状态机）。
  bool get canReply => status == ForumPostStatus.published;

  /// 对普通用户可见（`HIDDEN` / `DELETED` / `DRAFT` 不可见）。
  bool get isVisible =>
      status == ForumPostStatus.published || status == ForumPostStatus.locked;

  Map<String, Object?> toJson() => <String, Object?>{
        ...author.toJson(),
        'id': id,
        'boardId': boardId,
        'boardName': boardName,
        'title': title,
        'body': body,
        'status': status.wire,
        'tags': tags,
        'replyCount': replyCount,
        'likeCount': likeCount,
        'pinnedAt': pinnedAt == null ? null : isoUtc(pinnedAt!),
        'createdAt': isoUtc(createdAt),
        'updatedAt': updatedAt == null ? null : isoUtc(updatedAt!),
      };

  ForumPost copyWith({
    String? id,
    String? boardId,
    String? boardName,
    String? title,
    String? body,
    ForumAuthor? author,
    ForumPostStatus? status,
    List<String>? tags,
    int? replyCount,
    int? likeCount,
    DateTime? createdAt,
    DateTime? pinnedAt,
    DateTime? updatedAt,
  }) =>
      ForumPost(
        id: id ?? this.id,
        boardId: boardId ?? this.boardId,
        boardName: boardName ?? this.boardName,
        title: title ?? this.title,
        body: body ?? this.body,
        author: author ?? this.author,
        status: status ?? this.status,
        tags: tags ?? this.tags,
        replyCount: replyCount ?? this.replyCount,
        likeCount: likeCount ?? this.likeCount,
        createdAt: createdAt ?? this.createdAt,
        pinnedAt: pinnedAt ?? this.pinnedAt,
        updatedAt: updatedAt ?? this.updatedAt,
      );

  @override
  bool operator ==(Object other) => other is ForumPost && other.id == id;

  @override
  int get hashCode => id.hashCode;

  @override
  String toString() =>
      'ForumPost($id, $title, ${status.wire}, anonymous=$anonymous)';
}

/// 回复（契约 §2.4 `ForumReply`）。
final class ForumReply {
  const ForumReply({
    required this.id,
    required this.postId,
    required this.body,
    required this.author,
    required this.createdAt,
    this.status = ForumReplyStatus.published,
    this.parentReplyId,
  });

  factory ForumReply.fromJson(Map<String, Object?> json) => ForumReply(
        id: readString(json, 'id'),
        postId: readString(json, 'postId'),
        body: readString(json, 'body'),
        author: ForumAuthor.fromJson(json),
        createdAt: readDateTime(json, 'createdAt'),
        status: ForumReplyStatus.fromWire(
            readStringOr(json, 'status', 'PUBLISHED')),
        parentReplyId: readStringOrNull(json, 'parentReplyId'),
      );

  final String id;
  final String postId;
  final String body;
  final ForumAuthor author;
  final ForumReplyStatus status;
  final DateTime createdAt;

  /// 二级回复的父回复 id（契约 §2.4）。
  final String? parentReplyId;

  bool get anonymous => author.isAnonymous;

  String get authorId => author.authorId;

  bool get isVisible =>
      status == ForumReplyStatus.published || status == ForumReplyStatus.hidden;

  Map<String, Object?> toJson() => <String, Object?>{
        ...author.toJson(),
        'id': id,
        'postId': postId,
        'body': body,
        'status': status.wire,
        'parentReplyId': parentReplyId,
        'createdAt': isoUtc(createdAt),
      };

  @override
  bool operator ==(Object other) => other is ForumReply && other.id == id;

  @override
  int get hashCode => id.hashCode;

  @override
  String toString() => 'ForumReply($id, post=$postId, anonymous=$anonymous)';
}

/// 举报（契约 §2.4 `ForumReport`；动作名 `report` 见契约 §11.2）。
final class ForumReport {
  const ForumReport({
    required this.id,
    required this.targetType,
    required this.targetId,
    required this.reason,
    required this.reporter,
    required this.createdAt,
    this.status = ForumReportStatus.pending,
    this.detail,
  });

  factory ForumReport.fromJson(Map<String, Object?> json) => ForumReport(
        id: readString(json, 'id'),
        targetType: ForumReportTargetType.fromWire(
            readStringOr(json, 'targetType', 'POST')),
        targetId: readString(json, 'targetId'),
        reason:
            ForumReportReason.fromWire(readStringOr(json, 'reason', 'other')),
        reporter: ForumAuthor.fromJson(json),
        createdAt: readDateTime(json, 'createdAt'),
        status:
            ForumReportStatus.fromWire(readStringOr(json, 'status', 'PENDING')),
        // `services/api` 的字段名是 `detail`（02-domain-model §2.4 写的是 `note`）：两个都认。
        detail:
            readStringOrNull(json, 'detail') ?? readStringOrNull(json, 'note'),
      );

  final String id;
  final ForumReportTargetType targetType;
  final String targetId;
  final ForumReportReason reason;

  /// 举报人；可匿名（契约 §2.4）。
  final ForumAuthor reporter;

  final ForumReportStatus status;
  final DateTime createdAt;

  /// 举报补充说明（`services/api` 的 `detail`；兼容旧字段名 `note`）。
  final String? detail;

  bool get anonymous => reporter.isAnonymous;

  Map<String, Object?> toJson() => <String, Object?>{
        ...reporter.toJson(),
        'id': id,
        'targetType': targetType.wire,
        'targetId': targetId,
        'reason': reason.wire,
        'status': status.wire,
        'detail': detail,
        'createdAt': isoUtc(createdAt),
      };

  @override
  String toString() =>
      'ForumReport($id, ${targetType.wire}/$targetId, ${reason.wire})';
}

/// 主题列表查询（契约 §6.1 游标分页 + 版块筛选）。
final class ForumPostQuery {
  const ForumPostQuery({
    this.boardId,
    this.cursor,
    this.limit = defaultPageSize,
    this.keyword,
  });

  final String? boardId;
  final String? cursor;
  final int limit;
  final String? keyword;

  /// 对齐 `services/api` 的 `GET /forum/items?board=&q=`：过滤参数名是
  /// `board` 与 `q`（02-domain-model 里写的是 `boardId` / `keyword`）。
  Map<String, Object?> toQuery() => <String, Object?>{
        ...PageQuery(cursor: cursor, limit: limit).toQuery(),
        if (boardId != null && boardId!.isNotEmpty) 'board': boardId,
        if (keyword != null && keyword!.trim().isNotEmpty) 'q': keyword!.trim(),
      };

  ForumPostQuery copyWith(
          {String? boardId, String? cursor, int? limit, String? keyword}) =>
      ForumPostQuery(
        boardId: boardId ?? this.boardId,
        cursor: cursor ?? this.cursor,
        limit: limit ?? this.limit,
        keyword: keyword ?? this.keyword,
      );
}

/// 回复列表查询。
final class ForumReplyQuery {
  const ForumReplyQuery({
    required this.postId,
    this.cursor,
    this.limit = defaultPageSize,
  });

  final String postId;
  final String? cursor;
  final int limit;

  Map<String, Object?> toQuery() => <String, Object?>{
        ...PageQuery(cursor: cursor, limit: limit).toQuery(),
        'postId': postId,
      };
}

/// 发帖草稿 —— 纯逻辑，含**匿名开关语义**（契约 §9）。
///
/// 放在 domain 是为了让"匿名开关"这件事可被单元测试直接覆盖，
/// 而不是只能靠点 UI 验证。
final class ForumPostDraft {
  const ForumPostDraft({
    this.title = '',
    this.body = '',
    this.tags = const <String>[],
    this.anonymous = false,
  });

  /// 契约 §2.4：标题 1–100 字，正文 ≤20000 字，标签 ≤5 个、每个 ≤16 字。
  static const int titleMaxLength = 100;
  static const int bodyMaxLength = 20000;
  static const int tagMaxCount = 5;
  static const int tagMaxLength = 16;

  final String title;
  final String body;
  final List<String> tags;

  /// 匿名开关。**默认 false**（契约 §2.4：`anonymous` 默认 `false`）。
  final bool anonymous;

  String? get titleError {
    final String value = title.trim();
    if (value.isEmpty) return '请填写标题';
    if (!isLengthWithin(value, 1, titleMaxLength)) {
      return '标题请控制在 $titleMaxLength 字以内';
    }
    return null;
  }

  String? get bodyError {
    final String value = body.trim();
    if (value.isEmpty) return '请填写正文';
    if (value.runes.length > bodyMaxLength) {
      return '正文请控制在 $bodyMaxLength 字以内';
    }
    return null;
  }

  String? get tagsError {
    if (tags.length > tagMaxCount) return '最多 $tagMaxCount 个标签';
    for (final String tag in tags) {
      if (tag.runes.length > tagMaxLength) return '单个标签请控制在 $tagMaxLength 字以内';
    }
    return null;
  }

  bool get isValid =>
      titleError == null && bodyError == null && tagsError == null;

  /// 匿名开关旁的说明文案（契约 §9）。
  String get anonymityNotice => anonymousPostNotice;

  ForumPostDraft copyWith({
    String? title,
    String? body,
    List<String>? tags,
    bool? anonymous,
  }) =>
      ForumPostDraft(
        title: title ?? this.title,
        body: body ?? this.body,
        tags: tags ?? this.tags,
        anonymous: anonymous ?? this.anonymous,
      );

  /// 转成 `POST /api/v1/forum/items` 的请求体。
  ///
  /// 匿名时请求体里**没有任何实名标识**：只有 `anonymous: true`，
  /// 实名 id 由后端从 JWT 取，客户端不参与。
  CreateForumPostCommand toCommand({required String boardId}) =>
      CreateForumPostCommand(
        boardId: boardId,
        title: title.trim(),
        body: body.trim(),
        anonymous: anonymous,
        tags: tags,
      );

  @override
  String toString() =>
      'ForumPostDraft(${title.length}字, tags=${tags.length}, anonymous=$anonymous)';
}

/// 把用户输入的标签串解析为标签列表（纯函数，便于测试）。
///
/// 支持中英文逗号、顿号、空格分隔；去空、去重、保序、截断到
/// [ForumPostDraft.tagMaxCount] 个。
List<String> parseForumTags(String raw) {
  final List<String> parts = raw
      .split(RegExp(r'[,，、\s]+'))
      .map((String part) => part.trim())
      .where((String part) => part.isNotEmpty)
      .toList(growable: false);
  final List<String> unique = <String>[];
  for (final String part in parts) {
    if (!unique.contains(part)) unique.add(part);
    if (unique.length >= ForumPostDraft.tagMaxCount) break;
  }
  return unique;
}

/// 发帖命令（`POST /api/v1/forum/items`）。
final class CreateForumPostCommand {
  const CreateForumPostCommand({
    required this.boardId,
    required this.title,
    required this.body,
    this.anonymous = false,
    this.tags = const <String>[],
  });

  final String boardId;
  final String title;
  final String body;
  final bool anonymous;
  final List<String> tags;

  /// 对齐 `services/api` 的 `createPostSchema`：字段名是 `board`（不是 `boardId`），
  /// 且**不含任何实名标识**（实名 id 由后端从 JWT 取）。
  Map<String, Object?> toJson() => <String, Object?>{
        'board': boardId,
        'title': title,
        'body': body,
        'anonymous': anonymous,
        'tags': tags,
      };
}

/// 回复草稿。
final class ForumReplyDraft {
  const ForumReplyDraft(
      {this.body = '', this.anonymous = false, this.parentReplyId});

  /// 契约 §2.4：回复 ≤5000 字。
  static const int bodyMaxLength = 5000;

  final String body;
  final bool anonymous;
  final String? parentReplyId;

  String? get bodyError {
    final String value = body.trim();
    if (value.isEmpty) return '请填写回复内容';
    if (value.runes.length > bodyMaxLength) return '回复请控制在 $bodyMaxLength 字以内';
    return null;
  }

  bool get isValid => bodyError == null;

  String get anonymityNotice => anonymousReplyNotice;

  CreateForumReplyCommand toCommand({required String postId}) =>
      CreateForumReplyCommand(
        postId: postId,
        body: body.trim(),
        anonymous: anonymous,
        parentReplyId: parentReplyId,
      );
}

/// 回复命令（`POST /api/v1/forum/items/:id/reply`）。
///
/// ⚠️ `reply` **不在**契约 §11.2 的冻结 action 表里。本端**没有**自创路由：
/// 实现时走的是契约 §6.1 的统一 CRUD 形状
/// `POST /api/v1/forum/items/:id/<action>`，并在交付说明中提出
/// 「`forum.reply` 需要补登记到 §11.2 与 OpenAPI」—— 按 §11.2 的要求，
/// 新增 action 必须**同时**改契约表与 OpenAPI，由 Lead 执行，本端不擅自改契约文件。
final class CreateForumReplyCommand {
  const CreateForumReplyCommand({
    required this.postId,
    required this.body,
    this.anonymous = false,
    this.parentReplyId,
  });

  final String postId;
  final String body;
  final bool anonymous;
  final String? parentReplyId;

  /// 对齐 `services/api` 的 `createReplySchema`：`postId` 在**路径**里
  /// （`POST forum/items/:id/replies`），请求体只有 body / parentReplyId / anonymous。
  Map<String, Object?> toJson() => <String, Object?>{
        'body': body,
        'anonymous': anonymous,
        'parentReplyId': parentReplyId,
      };
}

/// 举报命令（`POST /api/v1/forum/items/:id/report`，action 名见契约 §11.2）。
final class CreateForumReportCommand {
  const CreateForumReportCommand({
    required this.targetType,
    required this.targetId,
    required this.reason,
    this.detail,
    this.anonymous = false,
  });

  final ForumReportTargetType targetType;
  final String targetId;
  final ForumReportReason reason;

  /// 补充说明；`services/api` 的字段名是 `detail`。
  final String? detail;

  final bool anonymous;

  /// 对齐 `services/api` 的 `reportSchema`：`targetType` / `targetId` 由**路径**
  /// 表达（`POST forum/items/:id/report`），请求体只有 reason / detail / anonymous。
  Map<String, Object?> toJson() => <String, Object?>{
        'reason': reason.wire,
        'detail': detail,
        'anonymous': anonymous,
      };
}

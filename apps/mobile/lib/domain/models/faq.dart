import 'api_request.dart';
import 'json_read.dart';
import 'validate.dart';

/// 文章状态（契约 §2.8 `FaqArticle`）。
enum FaqArticleStatus {
  draft('DRAFT', '草稿'),
  published('PUBLISHED', '已发布'),
  archived('ARCHIVED', '已归档'),

  /// 兜底：未知状态**不**当作可见（宁可少显示，也不要显示未发布的草稿）。
  unknown('unknown', '未知');

  const FaqArticleStatus(this.wire, this.label);

  final String wire;
  final String label;

  static FaqArticleStatus fromWire(String wire) {
    for (final FaqArticleStatus value in FaqArticleStatus.values) {
      if (wireEquals(value.wire, wire)) return value;
    }
    return FaqArticleStatus.unknown;
  }
}

/// 工单状态机（契约 §2.8 `FaqTicket`）。
enum FaqTicketStatus {
  open('OPEN', '待回复'),
  answered('ANSWERED', '已回复'),
  closed('CLOSED', '已关闭'),

  /// 兜底：未知状态按"待回复"展示，避免用户以为已经处理完了。
  unknown('unknown', '未知');

  const FaqTicketStatus(this.wire, this.label);

  final String wire;
  final String label;

  static FaqTicketStatus fromWire(String wire) {
    for (final FaqTicketStatus value in FaqTicketStatus.values) {
      if (wireEquals(value.wire, wire)) return value;
    }
    return FaqTicketStatus.unknown;
  }

  /// `ANSWERED` 可以追问（契约 §2.8 状态机：`ANSWERED --> OPEN : 追问`）。
  bool get canFollowUp => this == FaqTicketStatus.answered;
}

/// 分类（用于左侧/顶部分类导航）。
final class FaqCategory {
  const FaqCategory({
    required this.id,
    required this.name,
    this.slug = '',
    this.description,
    this.articleCount = 0,
  });

  factory FaqCategory.fromJson(Map<String, Object?> json) => FaqCategory(
        id: readString(json, 'id'),
        name: readString(json, 'name'),
        slug: readStringOr(json, 'slug', ''),
        description: readStringOrNull(json, 'description'),
        articleCount: readIntOr(json, 'articleCount', 0),
      );

  final String id;
  final String name;
  final String slug;
  final String? description;
  final int articleCount;

  Map<String, Object?> toJson() => <String, Object?>{
        'id': id,
        'name': name,
        'slug': slug,
        'description': description,
        'articleCount': articleCount,
      };

  @override
  bool operator ==(Object other) => other is FaqCategory && other.id == id;

  @override
  int get hashCode => id.hashCode;

  @override
  String toString() => 'FaqCategory($id, $name)';
}

/// 知识库文章（契约 §2.8 `FaqArticle`）。
final class FaqArticle {
  const FaqArticle({
    required this.id,
    required this.question,
    required this.answer,
    required this.category,
    this.slug = '',
    this.status = FaqArticleStatus.published,
    this.helpfulCount = 0,
    this.unhelpfulCount = 0,
    this.tags = const <String>[],
    this.updatedAt,
  });

  factory FaqArticle.fromJson(Map<String, Object?> json) => FaqArticle(
        id: readString(json, 'id'),
        question: readString(json, 'question'),
        answer: readString(json, 'answer'),
        category: readString(json, 'category'),
        slug: readStringOr(json, 'slug', ''),
        status: FaqArticleStatus.fromWire(
            readStringOr(json, 'status', 'PUBLISHED')),
        helpfulCount: readIntOr(json, 'helpfulCount', 0),
        unhelpfulCount: readIntOr(json, 'unhelpfulCount', 0),
        tags: readStringList(json, 'tags'),
        updatedAt: readDateTimeOrNull(json, 'updatedAt'),
      );

  final String id;

  /// 1–120 字（契约 §2.8）。
  final String question;

  /// Markdown 子集，≤10000 字（契约 §2.8）。
  final String answer;

  /// 分类 id。
  final String category;

  final String slug;

  /// ⚠️ `services/api` 的 `FaqEntryModel` **没有** `status` 字段（条目即发布态）。
  /// 缺字段时按 `PUBLISHED` 处理，因此"草稿不可见"这条规则在真实后端下是空转，
  /// 只在 mock 里生效（已上报 Lead）。
  final FaqArticleStatus status;

  final int helpfulCount;

  /// `services/api` 当前**不下发**该字段，缺省为 0（02-domain-model §2.8 里有）。
  final int unhelpfulCount;

  final List<String> tags;
  final DateTime? updatedAt;

  /// 对普通用户可见（草稿不可见）。
  bool get isPublished => status == FaqArticleStatus.published;

  /// 纯函数搜索（契约 §2.8 `SearchFaq` 的**客户端**侧过滤）。
  ///
  /// 后端也支持 `keyword`，这里保留一份纯逻辑是为了：
  /// ① 已加载的结果可以即时过滤，不必等网络；② 可被单元测试直接覆盖。
  bool matches(String keyword) {
    final String needle = keyword.trim().toLowerCase();
    if (needle.isEmpty) return true;
    if (question.toLowerCase().contains(needle)) return true;
    if (answer.toLowerCase().contains(needle)) return true;
    if (category.toLowerCase().contains(needle)) return true;
    for (final String tag in tags) {
      if (tag.toLowerCase().contains(needle)) return true;
    }
    return false;
  }

  Map<String, Object?> toJson() => <String, Object?>{
        'id': id,
        'slug': slug,
        'question': question,
        'answer': answer,
        'category': category,
        'status': status.wire,
        'helpfulCount': helpfulCount,
        'unhelpfulCount': unhelpfulCount,
        'tags': tags,
        'updatedAt': updatedAt == null ? null : isoUtc(updatedAt!),
      };

  FaqArticle copyWith({
    String? id,
    String? slug,
    String? question,
    String? answer,
    String? category,
    FaqArticleStatus? status,
    int? helpfulCount,
    int? unhelpfulCount,
    List<String>? tags,
    DateTime? updatedAt,
  }) =>
      FaqArticle(
        id: id ?? this.id,
        slug: slug ?? this.slug,
        question: question ?? this.question,
        answer: answer ?? this.answer,
        category: category ?? this.category,
        status: status ?? this.status,
        helpfulCount: helpfulCount ?? this.helpfulCount,
        unhelpfulCount: unhelpfulCount ?? this.unhelpfulCount,
        tags: tags ?? this.tags,
        updatedAt: updatedAt ?? this.updatedAt,
      );

  @override
  bool operator ==(Object other) => other is FaqArticle && other.id == id;

  @override
  int get hashCode => id.hashCode;

  @override
  String toString() => 'FaqArticle($id, $question, helpful=$helpfulCount)';
}

/// 工单（契约 §2.8 `FaqTicket`）。
///
/// [userId] 可为 null —— 未登录也能提交（契约 §2.8）。
/// [contact] **不存明文手机号**：校验在 [faqTicketContactError]。
final class FaqTicket {
  const FaqTicket({
    required this.id,
    required this.contact,
    required this.question,
    required this.createdAt,
    this.userId,
    this.status = FaqTicketStatus.open,
    this.answer,
    this.answeredAt,
    this.closedAt,
  });

  factory FaqTicket.fromJson(Map<String, Object?> json) => FaqTicket(
        id: readString(json, 'id'),
        contact: readString(json, 'contact'),
        question: readString(json, 'question'),
        createdAt: readDateTime(json, 'createdAt'),
        userId: readStringOrNull(json, 'userId'),
        status: FaqTicketStatus.fromWire(readStringOr(json, 'status', 'OPEN')),
        answer: readStringOrNull(json, 'answer'),
        answeredAt: readDateTimeOrNull(json, 'answeredAt'),
        closedAt: readDateTimeOrNull(json, 'closedAt'),
      );

  final String id;

  /// 提交者；未登录为 null（契约 §2.8：未登录也可提交）。
  final String? userId;

  /// 邮箱或微信号；**不存明文手机号**。
  final String contact;

  final String question;
  final FaqTicketStatus status;
  final String? answer;
  final DateTime createdAt;
  final DateTime? answeredAt;
  final DateTime? closedAt;

  bool get isOpen => status == FaqTicketStatus.open;

  bool get hasAnswer => answer != null && answer!.isNotEmpty;

  FaqTicket copyWith({
    String? id,
    String? userId,
    String? contact,
    String? question,
    FaqTicketStatus? status,
    String? answer,
    DateTime? createdAt,
    DateTime? answeredAt,
    DateTime? closedAt,
  }) =>
      FaqTicket(
        id: id ?? this.id,
        userId: userId ?? this.userId,
        contact: contact ?? this.contact,
        question: question ?? this.question,
        status: status ?? this.status,
        answer: answer ?? this.answer,
        createdAt: createdAt ?? this.createdAt,
        answeredAt: answeredAt ?? this.answeredAt,
        closedAt: closedAt ?? this.closedAt,
      );

  Map<String, Object?> toJson() => <String, Object?>{
        'id': id,
        'userId': userId,
        'contact': contact,
        'question': question,
        'status': status.wire,
        'answer': answer,
        'createdAt': isoUtc(createdAt),
        'answeredAt': answeredAt == null ? null : isoUtc(answeredAt!),
        'closedAt': closedAt == null ? null : isoUtc(closedAt!),
      };

  @override
  bool operator ==(Object other) => other is FaqTicket && other.id == id;

  @override
  int get hashCode => id.hashCode;

  @override
  String toString() => 'FaqTicket($id, ${status.wire})';
}

/// FAQ 查询（契约 §6.1 游标分页 + 分类 + 关键词）。
final class FaqQuery {
  const FaqQuery({
    this.category,
    this.keyword,
    this.cursor,
    this.limit = defaultPageSize,
  });

  final String? category;
  final String? keyword;
  final String? cursor;
  final int limit;

  /// 对齐 `services/api` 的 `GET /faq/items?category=&q=`：关键词参数名是 `q`。
  Map<String, Object?> toQuery() => <String, Object?>{
        ...PageQuery(cursor: cursor, limit: limit).toQuery(),
        if (category != null && category!.isNotEmpty) 'category': category,
        if (keyword != null && keyword!.trim().isNotEmpty) 'q': keyword!.trim(),
      };

  FaqQuery copyWith(
          {String? category, String? keyword, String? cursor, int? limit}) =>
      FaqQuery(
        category: category ?? this.category,
        keyword: keyword ?? this.keyword,
        cursor: cursor ?? this.cursor,
        limit: limit ?? this.limit,
      );

  @override
  bool operator ==(Object other) =>
      other is FaqQuery &&
      other.category == category &&
      other.keyword == keyword &&
      other.cursor == cursor &&
      other.limit == limit;

  @override
  int get hashCode => Object.hash(category, keyword, cursor, limit);

  @override
  String toString() =>
      'FaqQuery(category=$category, keyword=$keyword, cursor=$cursor)';
}

/// 提交工单命令（`POST /api/v1/faq/items`）。
final class SubmitFaqTicketCommand {
  const SubmitFaqTicketCommand({required this.contact, required this.question});

  final String contact;
  final String question;

  Map<String, Object?> toJson() => <String, Object?>{
        'contact': contact.trim(),
        'question': question.trim(),
      };
}

/// 「有用」投票结果。
///
/// [counted] 为 `false` 表示**这一票没有被计入** —— 该用户此前已经投过，
/// 于是这次点击是**幂等**的空操作（契约要求：同一用户重复点只算一次）。
/// 注意：这不属于失败，UI 不该报错。
///
/// **形状对齐 `services/api`**：后端 `POST /faq/items/:id/helpful` 返回的是
/// `{ id, helpfulCount, counted }`（只回计数，不回整篇文章）。因此这里只承载
/// `articleId + helpfulCount + counted`，客户端用**局部覆盖**把新计数贴回列表 ——
/// 这样"服务端回整篇"与"服务端只回计数"两种实现都能用。
final class FaqHelpfulResult {
  const FaqHelpfulResult({
    required this.articleId,
    required this.helpfulCount,
    required this.counted,
  });

  final String articleId;

  /// 服务端返回的**最新**有用数（幂等命中时与之前相同）。
  final int helpfulCount;

  /// 本次点击是否真的让计数 +1。
  final bool counted;

  /// 是否属于"重复点击"（幂等命中）。
  bool get alreadyVoted => !counted;

  @override
  String toString() =>
      'FaqHelpfulResult($articleId, helpfulCount=$helpfulCount, counted=$counted)';
}

/// 「有用」投票者的身份种类。
enum FaqVoterKind {
  /// 已登录：用实名 `userId`（faq 是低敏感模块，投票不做匿名）。
  realUser('u'),

  /// 未登录：用设备本地 id（契约 §2.8：`SearchFaq` 无需登录）。
  deviceLocal('d');

  const FaqVoterKind(this.prefix);

  final String prefix;
}

/// 「有用」投票者标识。
///
/// 幂等键必须**稳定**：同一用户（或同一台设备）重复点击要落到同一个 key 上。
/// 两种身份用不同前缀，**不会**把设备 id 与用户 id 混为一谈 ——
/// 未登录时投的票不会被算到之后登录的某个人头上。
final class FaqVoter {
  const FaqVoter({required this.kind, required this.id});

  factory FaqVoter.forUser(String userId) =>
      FaqVoter(kind: FaqVoterKind.realUser, id: userId);

  factory FaqVoter.forDevice(String deviceId) =>
      FaqVoter(kind: FaqVoterKind.deviceLocal, id: deviceId);

  /// 解析一个 key；无法识别时按设备身份处理（保守：不会误认成某个实名用户）。
  factory FaqVoter.parse(String key) {
    final int separator = key.indexOf(':');
    if (separator > 0) {
      final String prefix = key.substring(0, separator);
      final String rest = key.substring(separator + 1);
      if (rest.isNotEmpty) {
        for (final FaqVoterKind kind in FaqVoterKind.values) {
          if (kind.prefix == prefix) return FaqVoter(kind: kind, id: rest);
        }
      }
    }
    return FaqVoter.forDevice(key);
  }

  /// 由「已登录的 userId（可为 null）」与「设备 id」解析出稳定的投票者。
  factory FaqVoter.resolve(
      {required String? userId, required String deviceId}) {
    if (userId != null && userId.isNotEmpty) return FaqVoter.forUser(userId);
    return FaqVoter.forDevice(deviceId);
  }

  final FaqVoterKind kind;
  final String id;

  bool get isRealUser => kind == FaqVoterKind.realUser;

  /// 幂等键：`u:<userId>` 或 `d:<deviceId>`。
  String get key => '${kind.prefix}:$id';

  @override
  bool operator ==(Object other) => other is FaqVoter && other.key == key;

  @override
  int get hashCode => key.hashCode;

  @override
  String toString() => 'FaqVoter($key)';
}

/// 联系方式校验（契约 §2.8：`contact` 是邮箱或微信，**不存明文手机号**）。
String? faqTicketContactError(String contact) {
  final String value = contact.trim();
  if (value.isEmpty) return '请留下邮箱或微信号，方便我们回复你';
  if (isChinaMobile(value)) {
    return '请不要填写手机号（契约 §2.8：不存明文手机号），留邮箱或微信号即可';
  }
  if (value.runes.length > 120) return '联系方式请控制在 120 字以内';
  return null;
}

/// 工单问题描述校验（契约 §2.8：≤2000 字）。
String? faqTicketQuestionError(String question) {
  final String value = question.trim();
  if (value.isEmpty) return '请描述你遇到的问题';
  if (value.runes.length > 2000) return '问题描述请控制在 2000 字以内';
  return null;
}

/// 工单草稿（纯逻辑，便于测试）。
final class FaqTicketDraft {
  const FaqTicketDraft({this.contact = '', this.question = ''});

  final String contact;
  final String question;

  String? get contactError => faqTicketContactError(contact);

  String? get questionError => faqTicketQuestionError(question);

  bool get isValid => contactError == null && questionError == null;

  FaqTicketDraft copyWith({String? contact, String? question}) =>
      FaqTicketDraft(
          contact: contact ?? this.contact,
          question: question ?? this.question);

  SubmitFaqTicketCommand toCommand() => SubmitFaqTicketCommand(
      contact: contact.trim(), question: question.trim());
}

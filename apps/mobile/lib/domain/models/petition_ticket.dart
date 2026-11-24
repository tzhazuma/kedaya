/// 建议与诉求（`petition`）—— **本机演示**的规则层。
///
/// ## 这个模块不是「众筹诉求」
///
/// 契约里的 `petition`（`packages/contracts/src/petitions.ts`）是「附议凑门槛 →
/// 生成邮件给部门」。`apps/mobile` 落地的是一个更小的产品形态：
/// **向学校提一条建议 / 诉求，在本机留一份记录**。因此模型里刻意没有
/// 金额、附议数、部门邮箱、阈值这些字段 —— 没有字段，就写不出「假装已送达」。
///
/// ## 状态不单独存，由时间戳推出来
///
/// 一条记录只有三个阶段：已提交 → 处理中 → 已回复。把 `status` 也存成字段，
/// 就会出现「状态是已回复、但没有回复时间」这类自相矛盾的数据。
/// 因此这里只存 [submittedAt] / [processingAt] / [repliedAt]，
/// [status] 与 [petitionTimeline] 都由它们推导。
///
/// ## 匿名是**数据层**的保证，不是 UI 的开关
///
/// [PetitionTicket] 的工厂在 `anonymous == true` 时**丢弃**联系方式，
/// 所以即使页面忘了清空输入框，本机缓存里也不会留下联系方式。
library;

import 'json_read.dart';

/* ------------------------------------------------------------------ *
 * 1. 类别
 * ------------------------------------------------------------------ */

/// 建议 / 诉求的类别。
enum PetitionCategory {
  teaching('teaching', '教学'),
  logistics('logistics', '后勤'),
  dorm('dorm', '宿舍'),
  canteen('canteen', '餐饮'),
  facility('facility', '校园设施'),
  other('other', '其他');

  const PetitionCategory(this.wire, this.label);

  /// 持久化 / 未来接口用的稳定标识。
  final String wire;

  /// 面向用户的名字。
  final String label;

  /// 未知取值返回 null —— 调用方必须显式决定怎么处理，不许静默降级。
  static PetitionCategory? fromWire(String wire) {
    final String normalized = wire.trim().toLowerCase();
    for (final PetitionCategory category in PetitionCategory.values) {
      if (category.wire == normalized) return category;
    }
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * 2. 状态
 * ------------------------------------------------------------------ */

/// 一条诉求在本机的处理状态。
///
/// 演示版没有后台，**不会**自动从「已提交」变成「处理中」——
/// 状态只能由真实的处理方推进（将来接后端时用它写入）。
enum PetitionStatus {
  submitted('submitted', '已提交'),
  processing('processing', '处理中'),
  replied('replied', '已回复');

  const PetitionStatus(this.wire, this.label);

  final String wire;
  final String label;

  /// 只有「已提交」可以撤回：已经进入处理或已有回复的记录不再由本机单方面删除。
  bool get canWithdraw => this == PetitionStatus.submitted;
}

/* ------------------------------------------------------------------ *
 * 3. 常量
 * ------------------------------------------------------------------ */

const int petitionTitleMax = 60;
const int petitionBodyMax = 1000;
const int petitionContactMax = 80;

/// 本机最多保留多少条记录（超出时丢掉最旧的）。
const int petitionStoredLimit = 200;

/* ------------------------------------------------------------------ *
 * 4. 时间线
 * ------------------------------------------------------------------ */

/// 时间线上的一格。
///
/// [at] 为 null 表示这一步**还没发生**（页面显示「待进行」而不是编一个时间）。
final class PetitionTimelineEntry {
  const PetitionTimelineEntry({required this.status, required this.at});

  final PetitionStatus status;
  final DateTime? at;

  bool get happened => at != null;

  @override
  bool operator ==(Object other) =>
      other is PetitionTimelineEntry &&
      other.status == status &&
      other.at == at;

  @override
  int get hashCode => Object.hash(status, at);

  @override
  String toString() => 'PetitionTimelineEntry(${status.wire}, ${at ?? '待进行'})';
}

/* ------------------------------------------------------------------ *
 * 5. 记录
 * ------------------------------------------------------------------ */

/// 一条本机保存的建议 / 诉求。
final class PetitionTicket {
  const PetitionTicket._({
    required this.id,
    required this.category,
    required this.title,
    required this.body,
    required this.anonymous,
    required this.contact,
    required this.submittedAt,
    required this.processingAt,
    required this.repliedAt,
    required this.reply,
  });

  /// 唯一构造入口：负责裁剪空白、丢弃匿名联系方式、校验时间线单调。
  factory PetitionTicket({
    required String id,
    required PetitionCategory category,
    required String title,
    required String body,
    bool anonymous = false,
    String? contact,
    required DateTime submittedAt,
    DateTime? processingAt,
    DateTime? repliedAt,
    String? reply,
  }) {
    final String cleanId = id.trim();
    final String cleanTitle = title.trim();
    final String cleanBody = body.trim();
    final String? cleanContact = anonymous ? null : _cleanText(contact);
    final String? cleanReply = _cleanText(reply);

    if (cleanId.isEmpty) {
      throw ArgumentError.value(id, 'id', '记录 id 不能为空');
    }
    if (cleanTitle.isEmpty) {
      throw ArgumentError.value(title, 'title', '标题不能为空');
    }
    if (cleanTitle.length > petitionTitleMax) {
      throw ArgumentError.value(
        title,
        'title',
        '标题最多 $petitionTitleMax 个字',
      );
    }
    if (cleanBody.isEmpty) {
      throw ArgumentError.value(body, 'body', '正文不能为空');
    }
    if (cleanBody.length > petitionBodyMax) {
      throw ArgumentError.value(
        body,
        'body',
        '正文最多 $petitionBodyMax 个字',
      );
    }
    if (cleanContact != null && cleanContact.length > petitionContactMax) {
      throw ArgumentError.value(
        contact,
        'contact',
        '联系方式最多 $petitionContactMax 个字',
      );
    }
    if (processingAt != null && processingAt.isBefore(submittedAt)) {
      throw ArgumentError('处理时间不能早于提交时间');
    }
    if (repliedAt != null) {
      if (processingAt == null) {
        throw ArgumentError('有回复时间就必须先有处理时间（状态不能跳格）');
      }
      if (repliedAt.isBefore(processingAt)) {
        throw ArgumentError('回复时间不能早于处理时间');
      }
    }
    if (repliedAt == null && cleanReply != null) {
      throw ArgumentError('只有「已回复」的记录才能带回复内容');
    }

    return PetitionTicket._(
      id: cleanId,
      category: category,
      title: cleanTitle,
      body: cleanBody,
      anonymous: anonymous,
      contact: cleanContact,
      submittedAt: submittedAt,
      processingAt: processingAt,
      repliedAt: repliedAt,
      reply: cleanReply,
    );
  }

  factory PetitionTicket.fromJson(Map<String, Object?> json) {
    final String rawCategory = readString(json, 'category');
    final PetitionCategory? category = PetitionCategory.fromWire(rawCategory);
    if (category == null) {
      throw FormatException('PetitionTicket: 未知类别 "$rawCategory"');
    }
    return PetitionTicket(
      id: readString(json, 'id'),
      category: category,
      title: readString(json, 'title'),
      body: readString(json, 'body'),
      anonymous: readBoolOr(json, 'anonymous', false),
      contact: readStringOrNull(json, 'contact'),
      submittedAt: readDateTime(json, 'submittedAt'),
      processingAt: readDateTimeOrNull(json, 'processingAt'),
      repliedAt: readDateTimeOrNull(json, 'repliedAt'),
      reply: readStringOrNull(json, 'reply'),
    );
  }

  final String id;
  final PetitionCategory category;
  final String title;
  final String body;

  /// 是否匿名提交。
  final bool anonymous;

  /// 联系方式；匿名记录**一定**是 null（构造时丢弃）。
  final String? contact;

  final DateTime submittedAt;
  final DateTime? processingAt;
  final DateTime? repliedAt;

  /// 回复内容；空串归一为 null。
  final String? reply;

  /// 由时间戳推导，不单独存储。
  PetitionStatus get status {
    if (repliedAt != null) return PetitionStatus.replied;
    if (processingAt != null) return PetitionStatus.processing;
    return PetitionStatus.submitted;
  }

  /// 撤回规则只写一次：UI 的按钮显示与 controller 的校验都读这里。
  bool get canWithdraw => status.canWithdraw;

  /// 推进到下一状态。
  ///
  /// 规则：
  ///   - 只能向前，不能回退；重复推进到当前状态是幂等的；
  ///   - 「已回复」必须先经过「处理中」，不允许跳格；
  ///   - 时间必须单调不减，否则时间线会出现倒序。
  PetitionTicket advanceTo(
    PetitionStatus next,
    DateTime at, {
    String? reply,
  }) {
    if (next.index < status.index) {
      throw StateError('状态不能从「${status.label}」回退到「${next.label}」');
    }
    if (next == status) return this;

    switch (next) {
      case PetitionStatus.submitted:
        throw StateError('不能把记录改回「已提交」');
      case PetitionStatus.processing:
        if (at.isBefore(submittedAt)) {
          throw ArgumentError('处理时间不能早于提交时间');
        }
        return PetitionTicket(
          id: id,
          category: category,
          title: title,
          body: body,
          anonymous: anonymous,
          contact: contact,
          submittedAt: submittedAt,
          processingAt: at,
          repliedAt: repliedAt,
          reply: reply,
        );
      case PetitionStatus.replied:
        final DateTime? processedAt = processingAt;
        if (processedAt == null) {
          throw StateError('必须先进入「处理中」才能变成「已回复」');
        }
        if (at.isBefore(processedAt)) {
          throw ArgumentError('回复时间不能早于处理时间');
        }
        return PetitionTicket(
          id: id,
          category: category,
          title: title,
          body: body,
          anonymous: anonymous,
          contact: contact,
          submittedAt: submittedAt,
          processingAt: processedAt,
          repliedAt: at,
          reply: reply,
        );
    }
  }

  Map<String, Object?> toJson() => <String, Object?>{
        'id': id,
        'category': category.wire,
        'title': title,
        'body': body,
        'anonymous': anonymous,
        'contact': contact,
        'submittedAt': isoUtc(submittedAt),
        'processingAt': processingAt == null ? null : isoUtc(processingAt!),
        'repliedAt': repliedAt == null ? null : isoUtc(repliedAt!),
        'reply': reply,
      };

  @override
  bool operator ==(Object other) =>
      other is PetitionTicket &&
      other.id == id &&
      other.category == category &&
      other.title == title &&
      other.body == body &&
      other.anonymous == anonymous &&
      other.contact == contact &&
      other.submittedAt == submittedAt &&
      other.processingAt == processingAt &&
      other.repliedAt == repliedAt &&
      other.reply == reply;

  @override
  int get hashCode => Object.hash(
        id,
        category,
        title,
        body,
        anonymous,
        contact,
        submittedAt,
        processingAt,
        repliedAt,
        reply,
      );

  @override
  String toString() =>
      'PetitionTicket($id, ${category.wire}, ${status.wire}, anonymous=$anonymous)';
}

/* ------------------------------------------------------------------ *
 * 6. 草稿与校验
 * ------------------------------------------------------------------ */

/// 提交表单的草稿。
///
/// [category] 可空，专门用来表达「还没选类别」；一旦提交成功，
/// 落到 [PetitionTicket] 里的一定是具体类别。
final class PetitionDraft {
  const PetitionDraft({
    this.category,
    this.title = '',
    this.body = '',
    this.anonymous = false,
    this.contact,
  });

  final PetitionCategory? category;
  final String title;
  final String body;
  final bool anonymous;
  final String? contact;
}

/// 校验问题码 —— UI 要给具体提示，而不是一句「格式不对」。
enum PetitionDraftProblem {
  categoryMissing('category-missing'),
  titleEmpty('title-empty'),
  titleTooLong('title-too-long'),
  bodyEmpty('body-empty'),
  bodyTooLong('body-too-long'),
  contactTooLong('contact-too-long');

  const PetitionDraftProblem(this.wire);

  final String wire;
}

/// 校验草稿；空列表表示通过。
///
/// 注意：匿名提交时**不检查**联系方式 —— 它根本不会被保存，
/// 不该因为一个用不上的字段挡住提交。
List<PetitionDraftProblem> validatePetitionDraft(PetitionDraft draft) {
  final List<PetitionDraftProblem> problems = <PetitionDraftProblem>[];

  if (draft.category == null) {
    problems.add(PetitionDraftProblem.categoryMissing);
  }

  final String title = draft.title.trim();
  if (title.isEmpty) {
    problems.add(PetitionDraftProblem.titleEmpty);
  } else if (title.length > petitionTitleMax) {
    problems.add(PetitionDraftProblem.titleTooLong);
  }

  final String body = draft.body.trim();
  if (body.isEmpty) {
    problems.add(PetitionDraftProblem.bodyEmpty);
  } else if (body.length > petitionBodyMax) {
    problems.add(PetitionDraftProblem.bodyTooLong);
  }

  if (!draft.anonymous) {
    final String contact = draft.contact?.trim() ?? '';
    if (contact.length > petitionContactMax) {
      problems.add(PetitionDraftProblem.contactTooLong);
    }
  }

  return problems;
}

/// 问题码 → 中文提示。
String describePetitionProblem(PetitionDraftProblem problem) =>
    switch (problem) {
      PetitionDraftProblem.categoryMissing =>
        '请选择类别（教学 / 后勤 / 宿舍 / 餐饮 / 校园设施 / 其他）',
      PetitionDraftProblem.titleEmpty => '标题不能为空，写一句能认出问题的话',
      PetitionDraftProblem.titleTooLong => '标题最多 $petitionTitleMax 个字',
      PetitionDraftProblem.bodyEmpty => '正文不能为空，至少写清发生了什么、希望怎么改',
      PetitionDraftProblem.bodyTooLong => '正文最多 $petitionBodyMax 字，请删减后再保存',
      PetitionDraftProblem.contactTooLong => '联系方式最多 $petitionContactMax 个字',
    };

/// 校验失败时抛出的异常（携带全部问题码）。
final class PetitionDraftException implements Exception {
  const PetitionDraftException(this.problems);

  final List<PetitionDraftProblem> problems;

  String get message => problems.map(describePetitionProblem).join('；');

  @override
  String toString() => 'PetitionDraftException($message)';
}

/* ------------------------------------------------------------------ *
 * 7. 排序与时间线（纯函数）
 * ------------------------------------------------------------------ */

/// 「我的提交」按时间倒序；时间相同的保持输入顺序（Dart 的 sort 不稳定）。
List<PetitionTicket> sortPetitionTickets(List<PetitionTicket> tickets) {
  final List<int> order =
      List<int>.generate(tickets.length, (int index) => index);
  order.sort((int a, int b) {
    final int byTime = tickets[b].submittedAt.compareTo(tickets[a].submittedAt);
    if (byTime != 0) return byTime;
    return a.compareTo(b);
  });
  return <PetitionTicket>[
    for (final int index in order) tickets[index],
  ];
}

/// 固定的三步时间线；未发生的步骤 `at` 为 null。
///
/// 顺序是**硬编码的产品规则**，不从 [PetitionStatus.values] 推 ——
/// 以后枚举加值也不会悄悄改变详情页的时间线。
List<PetitionTimelineEntry> petitionTimeline(PetitionTicket ticket) =>
    <PetitionTimelineEntry>[
      PetitionTimelineEntry(
        status: PetitionStatus.submitted,
        at: ticket.submittedAt,
      ),
      PetitionTimelineEntry(
        status: PetitionStatus.processing,
        at: ticket.processingAt,
      ),
      PetitionTimelineEntry(
        status: PetitionStatus.replied,
        at: ticket.repliedAt,
      ),
    ];

String? _cleanText(String? value) {
  if (value == null) return null;
  final String trimmed = value.trim();
  return trimmed.isEmpty ? null : trimmed;
}

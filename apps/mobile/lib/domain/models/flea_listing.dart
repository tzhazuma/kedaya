/// 二手跳蚤市场（`flea-market`）—— 本机演示数据，不接后端。
///
/// ## 为什么规则都放在这里
///
/// 分类筛选、搜索、价格排序、发布校验这四件事，页面各写一份就会漂移：
/// 「全部」里能不能看到已下架、搜索是否覆盖地点、价格怎么比大小，
/// 这些问题必须在**一个地方**有唯一答案。页面只负责把用户输入传进来。
///
/// ## 币种与精度
///
/// 价格用**整数分**存储（与 `Money` 的约定一致，浮点不参与金额运算）。
/// 表单允许「整数或一位小数」（`12` / `12.5`），校验与解析都在
/// [parseFleaPriceFen] 里，展示统一走 [formatFleaPrice]。
///
/// ## 刻意不做的事
///
/// 没有手机号 / 微信号字段，也没有站内聊天：联系靠
/// [buildFleaContactText] 生成一段可粘贴的文本，用户自己发给对方。
/// 模型里没有这些字段，因此这类功能在类型上就写不出来。
library;

import 'time_text.dart';

/* ------------------------------------------------------------------ *
 * 1. 分类 / 成色 / 排序
 * ------------------------------------------------------------------ */

/// 闲置分类。列表页的「全部」不是分类，而是**不施加分类条件**。
enum FleaCategory {
  textbook('textbook', '教材'),
  electronics('electronics', '电子'),
  daily('daily', '生活'),
  other('other', '其他');

  const FleaCategory(this.wire, this.label);

  /// 稳定标识（本地演示数据与未来的接口共用）。
  final String wire;

  /// 面向用户的名字。
  final String label;

  static FleaCategory? fromWire(String wire) {
    final String normalized = wire.trim().toLowerCase();
    for (final FleaCategory category in FleaCategory.values) {
      if (category.wire == normalized) return category;
    }
    return null;
  }
}

/// 成色。四档够用，不引入「几成新」的自由输入（否则排序和筛选都没法做）。
enum FleaCondition {
  brandNew('brand-new', '全新'),
  likeNew('like-new', '九成新'),
  good('good', '七成新'),
  usable('usable', '可用');

  const FleaCondition(this.wire, this.label);

  final String wire;
  final String label;

  static FleaCondition? fromWire(String wire) {
    final String normalized = wire.trim().toLowerCase();
    for (final FleaCondition condition in FleaCondition.values) {
      if (condition.wire == normalized) return condition;
    }
    return null;
  }
}

/// 列表排序。只有两种：默认「最新」，以及买家最常用的「价格从低到高」。
enum FleaSort {
  newest('newest', '最新'),
  priceAsc('price-asc', '价格从低到高');

  const FleaSort(this.wire, this.label);

  final String wire;
  final String label;
}

/// 列表范围：逛市场（只看在架）还是看自己的发布（含已下架）。
enum FleaScope {
  browse('browse', '全部'),
  mine('mine', '我的');

  const FleaScope(this.wire, this.label);

  final String wire;
  final String label;
}

/* ------------------------------------------------------------------ *
 * 2. 数据模型
 * ------------------------------------------------------------------ */

/// 一条二手闲置。
final class FleaListing {
  const FleaListing({
    required this.id,
    required this.title,
    required this.priceFen,
    required this.condition,
    required this.category,
    required this.location,
    required this.createdAt,
    this.description = '',
    this.isMine = false,
    this.active = true,
  });

  final String id;
  final String title;

  /// 价格（**分**）。展示时用 [formatFleaPrice]。
  final int priceFen;

  final FleaCondition condition;
  final FleaCategory category;

  /// 交易地点（「三号宿舍楼下」「图书馆一楼」这类校内位置）。
  final String location;

  /// 发布时间；列表按它算相对时间与「最新」排序。
  final DateTime createdAt;

  /// 描述（≤ [fleaDescriptionMax] 字）；允许为空。
  final String description;

  /// 是不是当前用户发布的（本机演示只有"是 / 不是"两种）。
  final bool isMine;

  /// 是否在架。下架后不再出现在「全部」，但「我的」里仍然可见，便于重新上架。
  final bool active;

  FleaListing copyWith({
    String? title,
    int? priceFen,
    FleaCondition? condition,
    FleaCategory? category,
    String? location,
    DateTime? createdAt,
    String? description,
    bool? isMine,
    bool? active,
  }) =>
      FleaListing(
        id: id,
        title: title ?? this.title,
        priceFen: priceFen ?? this.priceFen,
        condition: condition ?? this.condition,
        category: category ?? this.category,
        location: location ?? this.location,
        createdAt: createdAt ?? this.createdAt,
        description: description ?? this.description,
        isMine: isMine ?? this.isMine,
        active: active ?? this.active,
      );

  /// 搜索命中：标题 / 描述 / 地点任一包含关键词（大小写不敏感）。
  bool matches(String normalizedQuery) {
    if (normalizedQuery.isEmpty) return true;
    return title.toLowerCase().contains(normalizedQuery) ||
        description.toLowerCase().contains(normalizedQuery) ||
        location.toLowerCase().contains(normalizedQuery);
  }

  @override
  bool operator ==(Object other) =>
      other is FleaListing &&
      other.id == id &&
      other.title == title &&
      other.priceFen == priceFen &&
      other.condition == condition &&
      other.category == category &&
      other.location == location &&
      other.createdAt == createdAt &&
      other.description == description &&
      other.isMine == isMine &&
      other.active == active;

  @override
  int get hashCode => Object.hash(
        id,
        title,
        priceFen,
        condition,
        category,
        location,
        createdAt,
        description,
        isMine,
        active,
      );

  @override
  String toString() =>
      'FleaListing($id, $title, $priceFen 分, ${condition.wire}, '
      'active=$active, mine=$isMine)';
}

/* ------------------------------------------------------------------ *
 * 3. 草稿与校验
 * ------------------------------------------------------------------ */

const int fleaTitleMax = 40;
const int fleaDescriptionMax = 300;
const int fleaLocationMax = 40;

/// 发布校验问题码。用问题码而不是布尔：表单要给**具体**提示。
enum FleaDraftProblem {
  titleEmpty('title-empty'),
  titleTooLong('title-too-long'),
  priceNotNumber('price-not-number'),
  priceNotPositive('price-not-positive'),
  descriptionTooLong('description-too-long'),
  locationEmpty('location-empty');

  const FleaDraftProblem(this.wire);

  /// 稳定标识（日志 / 测试用）。
  final String wire;
}

/// 发布表单的原始输入。
///
/// 价格保留**用户输入的字符串**：这样「12.34」不会被提前四舍五入成合法值，
/// 校验才能如实告诉用户「只能填整数或一位小数」。
final class FleaDraft {
  const FleaDraft({
    required this.title,
    required this.priceYuan,
    required this.condition,
    required this.category,
    required this.location,
    this.description = '',
  });

  final String title;
  final String priceYuan;
  final FleaCondition condition;
  final FleaCategory category;
  final String location;
  final String description;

  /// 解析后的价格（分）；格式非法时为 `null`。
  int? get priceFen => parseFleaPriceFen(priceYuan);

  @override
  String toString() =>
      'FleaDraft(${title.trim()}, ¥${priceYuan.trim()}, ${category.wire})';
}

/// 校验问题码汇总异常（仓库在写入前也会再跑一遍校验）。
final class FleaDraftException implements Exception {
  const FleaDraftException(this.problems);

  final List<FleaDraftProblem> problems;

  String get message => problems.map(describeFleaDraftProblem).join('；');

  @override
  String toString() => 'FleaDraftException($message)';
}

final RegExp _pricePattern = RegExp(r'^\d+(\.\d)?$');

/// 把「元」字符串解析成分。只接受**整数或一位小数**，非法返回 `null`。
///
/// 刻意不接受 `12.`、`+12`、千分位、负数与两位小数：
/// 表单文案说「整数或一位小数」，解析规则就必须一致。
int? parseFleaPriceFen(String raw) {
  final String trimmed = raw.trim();
  if (!_pricePattern.hasMatch(trimmed)) return null;

  final int dot = trimmed.indexOf('.');
  final String yuanPart = dot == -1 ? trimmed : trimmed.substring(0, dot);
  final int tenths = dot == -1 ? 0 : int.parse(trimmed.substring(dot + 1));
  // `int.parse` 对超长数字会抛 FormatException；这里把它当成非法输入。
  final int? yuan = int.tryParse(yuanPart);
  if (yuan == null) return null;
  return yuan * 100 + tenths * 10;
}

/// 价格展示：整数不带小数点，一位小数保留一位（`1250 -> '¥12.5'`）。
String formatFleaPrice(int fen) {
  final int yuan = fen ~/ 100;
  final int cents = fen % 100;
  if (cents == 0) return '¥$yuan';
  final String fraction = cents.toString().padLeft(2, '0');
  final String trimmed =
      fraction.endsWith('0') ? fraction.substring(0, 1) : fraction;
  return '¥$yuan.$trimmed';
}

/// 校验草稿；返回问题列表（空 = 通过）。顺序即表单里报错的顺序。
List<FleaDraftProblem> validateFleaDraft(FleaDraft draft) {
  final List<FleaDraftProblem> problems = <FleaDraftProblem>[];

  final String title = draft.title.trim();
  if (title.isEmpty) {
    problems.add(FleaDraftProblem.titleEmpty);
  } else if (title.runes.length > fleaTitleMax) {
    problems.add(FleaDraftProblem.titleTooLong);
  }

  final int? priceFen = parseFleaPriceFen(draft.priceYuan);
  if (priceFen == null) {
    problems.add(FleaDraftProblem.priceNotNumber);
  } else if (priceFen <= 0) {
    problems.add(FleaDraftProblem.priceNotPositive);
  }

  if (draft.description.trim().runes.length > fleaDescriptionMax) {
    problems.add(FleaDraftProblem.descriptionTooLong);
  }

  if (draft.location.trim().isEmpty) {
    problems.add(FleaDraftProblem.locationEmpty);
  }

  return problems;
}

/// 问题码 → 中文提示。
String describeFleaDraftProblem(FleaDraftProblem problem) => switch (problem) {
      FleaDraftProblem.titleEmpty => '标题不能为空，写清楚是什么东西',
      FleaDraftProblem.titleTooLong => '标题最多 $fleaTitleMax 个字',
      FleaDraftProblem.priceNotNumber => '价格只能填整数或一位小数，比如 25 或 12.5',
      FleaDraftProblem.priceNotPositive => '价格要大于 0 元',
      FleaDraftProblem.descriptionTooLong => '描述最多 $fleaDescriptionMax 字',
      FleaDraftProblem.locationEmpty => '写一个交易地点，方便对方判断远近',
    };

/* ------------------------------------------------------------------ *
 * 4. 筛选与排序
 * ------------------------------------------------------------------ */

/// 列表页唯一的数据入口：按范围 / 分类 / 关键词过滤，再排序。
///
/// - [FleaScope.browse] 只返回**在架**的发布（下架后立刻从「全部」消失）；
/// - [FleaScope.mine] 返回自己的全部发布（含已下架，便于重新上架）；
/// - 分类传 `null` 表示「全部」；
/// - 搜索覆盖标题 / 描述 / 地点，前后空白忽略、大小写不敏感。
List<FleaListing> visibleFleaListings(
  List<FleaListing> listings, {
  FleaScope scope = FleaScope.browse,
  FleaCategory? category,
  String query = '',
  FleaSort sort = FleaSort.newest,
}) {
  final String needle = query.trim().toLowerCase();
  final List<FleaListing> matched = <FleaListing>[
    for (final FleaListing listing in listings)
      if ((scope == FleaScope.browse ? listing.active : listing.isMine) &&
          (category == null || listing.category == category) &&
          listing.matches(needle))
        listing,
  ];

  matched.sort((FleaListing a, FleaListing b) {
    switch (sort) {
      case FleaSort.newest:
        {
          final int byTime = b.createdAt.compareTo(a.createdAt);
          if (byTime != 0) return byTime;
        }
      case FleaSort.priceAsc:
        {
          final int byPrice = a.priceFen.compareTo(b.priceFen);
          if (byPrice != 0) return byPrice;
          final int byTime = b.createdAt.compareTo(a.createdAt);
          if (byTime != 0) return byTime;
        }
    }
    // 兜底：`List.sort` 不保证稳定，同键时用 id 固定顺序。
    return a.id.compareTo(b.id);
  });

  return matched;
}

/* ------------------------------------------------------------------ *
 * 5. 文案
 * ------------------------------------------------------------------ */

/// 拼出可粘贴的联系文案。
///
/// 不含手机号 / 微信号 —— 用户复制后自己发给对方；也不生成任何链接。
/// 只放「对方需要知道」的信息：什么东西、多少钱、什么成色、在哪见。
String buildFleaContactText(FleaListing listing) => <String>[
      '【二手转让】${listing.title}',
      '价格：${formatFleaPrice(listing.priceFen)}',
      '成色：${listing.condition.label}',
      '地点：${listing.location}',
      if (listing.description.trim().isNotEmpty)
        '说明：${listing.description.trim()}',
      '交易方式：校内面交，当面验货',
    ].join('\n');

/// 相对发布时间（「3 小时前」）。参照点可注入，测试里不会跟着真实时钟漂移。
String describeFleaPostedAt(FleaListing listing, DateTime now) =>
    formatRelativeTime(listing.createdAt, now: now);

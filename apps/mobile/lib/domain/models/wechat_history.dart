import 'json_read.dart';

/// 公众号「历史消息」页里的一篇文章。
///
/// 这条数据来自**用户自己保存的页面**：他在微信里能看见，我们只是把
/// `msgList` 里的字段读出来。服务端不抓取、不带 Cookie、不绕过验证。
final class WechatHistoryArticle {
  const WechatHistoryArticle({
    required this.title,
    required this.url,
    required this.publishedAt,
    this.digest,
    this.coverUrl,
    this.isHeadline = true,
  });

  factory WechatHistoryArticle.fromJson(Map<String, Object?> json) =>
      WechatHistoryArticle(
        title: readString(json, 'title'),
        url: readString(json, 'url'),
        publishedAt: readDateTime(json, 'publishedAt'),
        digest: readStringOrNull(json, 'digest'),
        coverUrl: readStringOrNull(json, 'coverUrl'),
        isHeadline: json['isHeadline'] is bool
            ? json['isHeadline']! as bool
            : true,
      );

  final String title;
  final String url;
  final DateTime publishedAt;

  /// 微信给的摘要（可能为空）。
  final String? digest;
  final String? coverUrl;

  /// 一次推送可以有多篇；主条为 true，副条为 false。
  final bool isHeadline;

  bool get hasDigest => (digest ?? '').trim().isNotEmpty;

  Map<String, Object?> toJson() => <String, Object?>{
        'title': title,
        'url': url,
        'publishedAt': isoUtc(publishedAt),
        if (digest != null) 'digest': digest,
        if (coverUrl != null) 'coverUrl': coverUrl,
        'isHeadline': isHeadline,
      };

  @override
  bool operator ==(Object other) =>
      other is WechatHistoryArticle &&
      other.title == title &&
      other.url == url &&
      other.publishedAt == publishedAt &&
      other.digest == digest &&
      other.coverUrl == coverUrl &&
      other.isHeadline == isHeadline;

  @override
  int get hashCode =>
      Object.hash(title, url, publishedAt, digest, coverUrl, isHeadline);

  @override
  String toString() => 'WechatHistoryArticle($title, $url)';
}

/// 一次解析结果：公众号名字 + 这一页的全部文章。
final class WechatHistoryPage {
  const WechatHistoryPage({
    required this.articles,
    this.accountName,
    this.biz,
  });

  factory WechatHistoryPage.fromJson(Map<String, Object?> json) =>
      WechatHistoryPage(
        accountName: readStringOrNull(json, 'accountName'),
        biz: readStringOrNull(json, 'biz'),
        articles: readListOrEmpty(json, 'items')
            .map((Object? item) => WechatHistoryArticle.fromJson(
                  requireJsonMap(item, what: 'items[] 元素'),
                ))
            .toList(growable: false),
      );

  final String? accountName;
  final String? biz;
  final List<WechatHistoryArticle> articles;

  bool get isEmpty => articles.isEmpty;

  @override
  String toString() =>
      'WechatHistoryPage(${accountName ?? '未知公众号'}, ${articles.length} 篇)';
}

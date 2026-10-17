import '../../domain/models/api_request.dart';
import '../../domain/models/faq.dart';
import '../../domain/models/json_read.dart';
import '../../domain/models/page.dart';
import '../../domain/models/result.dart';
import '../../domain/ports/faq_port.dart';
import '../../domain/ports/kedaya_api_port.dart';
import '../api/request_ids.dart';

/// [FaqPort] 的远端实现（`/api/v1/faq/*`，契约 §6.1）。
///
/// `markHelpful` 是 POST，因此同样带 `Idempotency-Key`（契约 §11.3）——
/// 客户端幂等键 + 服务端按 `voterId` 去重，两层都保证"重复点只算一次"。
final class RemoteFaqRepository implements FaqPort {
  const RemoteFaqRepository(this._api);

  static const String _items = 'faq/items';
  static const String _tickets = 'faq/tickets';

  final KedayaApiPort _api;

  @override
  Future<Result<List<FaqCategory>>> listCategories() =>
      _api.send<List<FaqCategory>>(
        const ApiRequest(path: 'faq/categories', method: ApiMethod.get),
        _decodeCategories,
      );

  @override
  Future<Result<Page<FaqArticle>>> listArticles(FaqQuery query) =>
      _api.send<Page<FaqArticle>>(
        ApiRequest(path: _items, method: ApiMethod.get, query: query.toQuery()),
        (Object? data) => Page<FaqArticle>.fromJson(
          requireJsonMap(data, what: 'faq list'),
          FaqArticle.fromJson,
        ),
      );

  @override
  Future<Result<FaqHelpfulResult>> markHelpful(
    String articleId, {
    required String voterId,
  }) =>
      _api.send<FaqHelpfulResult>(
        ApiRequest(
          path: '$_items/$articleId/helpful',
          method: ApiMethod.post,
          body: <String, Object?>{'voterId': voterId},
          idempotencyKey: newIdempotencyKey(),
        ),
        _decodeHelpful,
      );

  @override
  Future<Result<Page<FaqTicket>>> listMyTickets({
    String? cursor,
    int limit = defaultPageSize,
  }) =>
      _api.send<Page<FaqTicket>>(
        ApiRequest(
          path: _tickets,
          method: ApiMethod.get,
          query: PageQuery(cursor: cursor, limit: limit).toQuery(),
        ),
        (Object? data) => Page<FaqTicket>.fromJson(
          requireJsonMap(data, what: 'faq tickets'),
          FaqTicket.fromJson,
        ),
      );

  @override
  Future<Result<FaqTicket>> submitTicket(SubmitFaqTicketCommand command) =>
      _api.send<FaqTicket>(
        ApiRequest(
          path: _tickets,
          method: ApiMethod.post,
          body: command.toJson(),
          idempotencyKey: newIdempotencyKey(),
        ),
        (Object? data) =>
            FaqTicket.fromJson(requireJsonMap(data, what: 'faq ticket')),
      );

  List<FaqCategory> _decodeCategories(Object? data) => readListOrEmpty(
        requireJsonMap(data, what: 'faq categories'),
        'items',
      )
          .map((Object? item) =>
              FaqCategory.fromJson(requireJsonMap(item, what: 'faq category')))
          .toList(growable: false);

  /// `services/api` 返回 `{ id, helpfulCount, counted }`。
  ///
  /// `counted == false` 表示**幂等命中**（该用户已经投过），不是失败。
  /// 兼容"服务端回整篇文章"的形状（`{ article: {...}, counted }`）。
  FaqHelpfulResult _decodeHelpful(Object? data) {
    final Map<String, Object?> json = requireJsonMap(data, what: 'faq helpful');
    final Map<String, Object?>? article = readMapOrNull(json, 'article');
    return FaqHelpfulResult(
      articleId: article != null
          ? readString(article, 'id')
          : readStringOr(json, 'id', ''),
      helpfulCount: article != null
          ? readIntOr(article, 'helpfulCount', 0)
          : readIntOr(json, 'helpfulCount', 0),
      counted: readBoolOr(json, 'counted', true),
    );
  }
}

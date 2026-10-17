import '../models/faq.dart';
import '../models/page.dart';
import '../models/result.dart';

/// 常见问题业务端口（契约 §4.1 `faq`）。
///
/// 路径形状遵循契约 §6.1：`faq/items[/:id[/action]]`。
abstract interface class FaqPort {
  /// `GET /api/v1/faq/categories`。
  ///
  /// 同 `ForumPort.listBoards`：分类是只读子资源，契约 §6.1 未单独冻结路径，
  /// 按同一风格取 `faq/categories`，已在交付说明中提出补登记。
  Future<Result<List<FaqCategory>>> listCategories();

  /// `GET /api/v1/faq/items`（游标分页 + 分类 + 关键词；**无需登录**，契约 §2.8）。
  Future<Result<Page<FaqArticle>>> listArticles(FaqQuery query);

  /// `POST /api/v1/faq/items/:id/helpful`。
  ///
  /// **幂等**：同一个 [voterId] 重复调用只会计数一次。重复调用返回
  /// `FaqHelpfulResult.counted == false`（不是失败）。
  Future<Result<FaqHelpfulResult>> markHelpful(String articleId,
      {required String voterId});

  /// `GET /api/v1/faq/tickets` —— 「我的工单」。
  Future<Result<Page<FaqTicket>>> listMyTickets({String? cursor, int limit});

  /// `POST /api/v1/faq/tickets`（契约 §11.3：POST 必须带 `Idempotency-Key`）。
  Future<Result<FaqTicket>> submitTicket(SubmitFaqTicketCommand command);
}

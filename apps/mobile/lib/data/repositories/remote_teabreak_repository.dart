import '../../domain/models/api_request.dart';
import '../../domain/models/json_read.dart';
import '../../domain/models/result.dart';
import '../../domain/models/teabreak.dart';
import '../../domain/ports/kedaya_api_port.dart';
import '../../domain/ports/teabreak_port.dart';
import '../api/request_ids.dart';

/// [TeabreakPort] 的远端实现（`/api/v1/teabreak/*`）。
///
/// ## ⚠️ 端点是**客户端侧的形状假设**（需后端确认）
///
/// `packages/contracts` 已经把规则写完了（`teabreaks.ts`），但**没有**给出
/// 端点表；`services/api/src/modules/` 里也还没有 `teabreak` 模块
/// （2026-10-22 时点）。因此这里按本仓库其它模块的既有约定推导：
///
/// | 本端方法 | 假设的端点 | 依据 |
/// | --- | --- | --- |
/// | [list] | `GET teabreak/items` | 集合资源统一叫 `items`（`forum` / `faq` / `wildlife`） |
/// | [confirm] | `POST teabreak/items/:id/confirms` | 子资源追加（`faq/items/:id/helpful`） |
/// | [create] | `POST teabreak/items` | 同上，写操作带 `Idempotency-Key` |
///
/// 这与 `WebViewHandoff` 的处理方式一致：**先按形状假设实现，再把假设登记进
/// 交付说明**。后端落地时若端点不同，只需改本文件里的三个常量。
///
/// 校验（[validateTeabreakDraft]）仍然在客户端先跑一遍，但**服务端必须再校验**
/// —— 客户端入参一律不可信。
final class RemoteTeabreakRepository implements TeabreakPort {
  const RemoteTeabreakRepository(this._api);

  static const String _items = 'teabreak/items';

  final KedayaApiPort _api;

  @override
  Future<Result<List<Teabreak>>> list() => _api.send<List<Teabreak>>(
        const ApiRequest(path: _items, method: ApiMethod.get),
        (Object? data) => _decodeList(data, 'teabreak list'),
      );

  @override
  Future<Result<Unit>> confirm(String id) => _api.sendVoid(
        ApiRequest(
          path: '$_items/$id/confirms',
          method: ApiMethod.post,
          // 契约 §11.3：写操作带幂等键；重复点「确认还有」只该算一次。
          body: const <String, Object?>{},
          idempotencyKey: newIdempotencyKey(),
        ),
      );

  @override
  Future<Result<Teabreak>> create(TeabreakDraft draft) =>
      _api.send<Teabreak>(
        ApiRequest(
          path: _items,
          method: ApiMethod.post,
          body: draft.toJson(),
          idempotencyKey: newIdempotencyKey(),
        ),
        (Object? data) =>
            Teabreak.fromJson(requireJsonMap(data, what: 'teabreak item')),
      );

  /// 列表响应既可能是裸数组，也可能是 `{ items: [...] }` —— 两种都接受。
  ///
  /// 与 `remote_wildlife_repository` 的处理一致：客户端不该因为一次形状差异
  /// 把整页打成错误态。
  List<Teabreak> _decodeList(Object? data, String what) {
    if (data is List<Object?>) {
      return data
          .whereType<Map<String, Object?>>()
          .map(Teabreak.fromJson)
          .toList(growable: false);
    }
    final Map<String, Object?> map = requireJsonMap(data, what: what);
    return readListOrEmpty(map, 'items')
        .whereType<Map<String, Object?>>()
        .map(Teabreak.fromJson)
        .toList(growable: false);
  }
}

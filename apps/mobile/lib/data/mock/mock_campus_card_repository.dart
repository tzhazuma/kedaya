import '../../domain/models/api_error.dart';
import '../../domain/models/api_request.dart';
import '../../domain/models/campus_card.dart';
import '../../domain/models/page.dart';
import '../../domain/models/result.dart';
import '../../domain/ports/campus_card_port.dart';
import '../api/request_ids.dart';
import 'mock_controls.dart';
import 'techpie_fixtures.dart';

/// [CampusCardPort] 的内存实现 —— **独立 OPENID 通道**，与校园会话代持无关。
///
/// 真实行为：未开通时所有读操作返回 `CAMPUS_BINDING_REQUIRED`（409，**不是** 401）、
/// 开通后余额/流水/付款码可用、解绑幂等、游标分页、故障注入。
///
/// ⚠️ 本实现**不保存**传入的 OPENID：只留下 [CampusCardLink.tailOf] 派生的脱敏尾巴。
/// 付款码**每次现取现给**，不落任何字段。
final class MockCampusCardRepository implements CampusCardPort {
  MockCampusCardRepository({
    CampusCardLinkState? initialState,
    List<CampusCardTransaction>? transactions,
    CampusCardAccount? account,
    MockControls? controls,
    DateTime Function()? clock,
  })  : controls = controls ?? MockControls(),
        _clock = clock ?? DateTime.now,
        _state = initialState ?? CampusCardLinkState.unlinked,
        _transactions = List<CampusCardTransaction>.unmodifiable(
          transactions ?? mockCampusCardTransactions,
        ),
        _account = account ?? mockCampusCardAccount;

  /// 可在运行时切换延迟与故障（UI 三态演示 / 测试注入）。
  final MockControls controls;

  final DateTime Function() _clock;
  final List<CampusCardTransaction> _transactions;
  final CampusCardAccount _account;

  CampusCardLinkState _state;
  String? _channel;

  /// 只保留 OPENID 的脱敏尾巴（末 4 位），**不保存** OPENID 本身。
  String? _openIdTail;
  DateTime? _linkedAt;

  /// 供测试断言"OPENID 与付款码没有留在仓库里"。
  List<String> debugDumpStrings() => <String>[
        _state.wire,
        _channel ?? '',
        _linkedAt?.toIso8601String() ?? '',
        _transactions
            .map((CampusCardTransaction item) => item.toJson().toString())
            .join('|'),
      ];

  /// 当前开通状态（测试/UI 演示用）。
  CampusCardLinkState get state => _state;

  @override
  Future<Result<CampusCardLink>> linkStatus() async {
    await controls.simulate();
    if (controls.failure != null) {
      return controls.failureResult<CampusCardLink>();
    }
    return Ok<CampusCardLink>(_link());
  }

  @override
  Future<Result<CampusCardLink>> connect({
    required String openId,
    String channel = 'wechat',
  }) async {
    await controls.simulate();
    if (controls.failure != null) {
      return controls.failureResult<CampusCardLink>();
    }
    if (openId.trim().isEmpty) {
      return _err<CampusCardLink>(
        ApiErrorCode.validationFailed,
        'OPENID 不能为空',
        reason: 'CREDENTIAL_EMPTY',
      );
    }
    _state = CampusCardLinkState.linked;
    _channel = channel;
    _linkedAt = _clock().toUtc();
    // 刻意不保存 openId：只留脱敏尾巴（`CampusCardLink.tailOf`）。
    // 传进来的 OPENID 的尾巴才是这次开通的真实值；用 fixtures 的常量会让
    // 「只留尾巴」这个隐私承诺在测试里变成假的。
    _openIdTail = CampusCardLink.tailOf(openId);
    return Ok<CampusCardLink>(_link());
  }

  @override
  Future<Result<Unit>> disconnect() async {
    await controls.simulate();
    if (controls.failure != null) return controls.failureResult<Unit>();
    _state = CampusCardLinkState.unlinked;
    _channel = null;
    _linkedAt = null;
    _openIdTail = null;
    return Ok<Unit>(Unit.instance);
  }

  @override
  Future<Result<CampusCardAccount>> account() async {
    await controls.simulate();
    if (controls.failure != null) {
      return controls.failureResult<CampusCardAccount>();
    }
    final ApiError? blocked = _linkGuard();
    if (blocked != null) {
      return Err<CampusCardAccount>(blocked, traceId: MockControls.traceId);
    }
    return Ok<CampusCardAccount>(_account);
  }

  @override
  Future<Result<Page<CampusCardTransaction>>> listTransactions({
    String? cursor,
    int limit = defaultPageSize,
  }) async {
    await controls.simulate();
    if (controls.failure != null) {
      return controls.failureResult<Page<CampusCardTransaction>>();
    }
    final ApiError? blocked = _linkGuard();
    if (blocked != null) {
      return Err<Page<CampusCardTransaction>>(
        blocked,
        traceId: MockControls.traceId,
      );
    }
    if (controls.emptyResults) {
      return Ok<Page<CampusCardTransaction>>(
        const Page<CampusCardTransaction>(
            items: <CampusCardTransaction>[], total: 0),
      );
    }
    final int start = _parseCursor(cursor);
    final int size =
        limit < 1 ? 1 : (limit > maxPageSize ? maxPageSize : limit);
    final List<CampusCardTransaction> window =
        _transactions.skip(start).take(size).toList(growable: false);
    final int consumed = start + window.length;
    return Ok<Page<CampusCardTransaction>>(
      Page<CampusCardTransaction>(
        items: window,
        nextCursor: consumed >= _transactions.length ? null : 'tx-$consumed',
        total: _transactions.length,
      ),
    );
  }

  @override
  Future<Result<CampusPaymentCode>> paymentCode() async {
    await controls.simulate();
    if (controls.failure != null) {
      return controls.failureResult<CampusPaymentCode>();
    }
    final ApiError? blocked = _linkGuard();
    if (blocked != null) {
      return Err<CampusPaymentCode>(blocked, traceId: MockControls.traceId);
    }
    // 现取现给，**不落字段**（付款码是短时效支付凭据，不进任何缓存）。
    final DateTime now = _clock().toUtc();
    return Ok<CampusPaymentCode>(
      CampusPaymentCode(
        code: newRequestId('pay').replaceAll('-', '').toUpperCase(),
        expiresAt: now.add(const Duration(seconds: 60)),
        refreshAfterSec: 60,
      ),
    );
  }

  CampusCardLink _link() => CampusCardLink(
        state: _state,
        channel: _channel,
        openIdTail:
            _state.isUsable ? (_openIdTail ?? mockCampusCardOpenIdTail) : null,
        linkedAt: _linkedAt,
        expiresAt: _state.isUsable
            ? (_linkedAt ?? _clock().toUtc()).add(const Duration(days: 365))
            : null,
      );

  /// 未开通/已过期 → `CAMPUS_BINDING_REQUIRED`（409）。
  ///
  /// 刻意**不是** `UNAUTHENTICATED`：用户可能已经登录，缺的只是开通校园卡。
  /// 返回 null 表示"已开通，可继续"。
  ApiError? _linkGuard() {
    if (_state.isUsable) return null;
    return ApiError(
      code: ApiErrorCode.campusBindingRequired,
      message: _state.needsRebind ? '校园卡授权已过期，请重新开通' : '请先通过校园卡 OPENID 通道开通',
      details: const <String, Object?>{'reason': 'CAMPUS_BINDING_REQUIRED'},
    );
  }

  int _parseCursor(String? cursor) {
    if (cursor == null || cursor.isEmpty) return 0;
    final String body = cursor.startsWith('tx-') ? cursor.substring(3) : cursor;
    final int? parsed = int.tryParse(body);
    if (parsed == null || parsed < 0) return 0;
    return parsed;
  }

  Err<T> _err<T>(ApiErrorCode code, String message, {String? reason}) => Err<T>(
        ApiError(
          code: code,
          message: message,
          details: reason == null ? null : <String, Object?>{'reason': reason},
        ),
        traceId: MockControls.traceId,
      );
}

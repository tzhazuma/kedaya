import '../../domain/models/api_error.dart';
import '../../domain/models/mail_activity.dart';
import '../../domain/models/result.dart';
import '../../domain/ports/mail_port.dart';

/// 校园邮箱的内存实现 —— 让绑定 / 同步 / 勾选这条链在无后端时也能走通。
///
/// 行为不是「假展示」：邮箱域校验是真的，绑定后才会出现事件，
/// 解绑会清掉事件。但它**不连任何 IMAP**，所以事件是固定演示数据。
final class MockMailRepository implements MailPort {
  MockMailRepository({DateTime Function()? clock})
      : _clock = clock ?? DateTime.now;

  final DateTime Function() _clock;

  String? _boundEmail;
  DateTime? _lastSyncAt;

  bool get isBound => _boundEmail != null;

  /// 上次同步成功的时间；null 表示还没同步过。
  DateTime? get lastSyncAt => _lastSyncAt;

  @override
  Future<Result<Unit>> link(MailLinkRequest request) async {
    final String? problem = validateCampusMailAddress(request.email);
    if (problem != null) {
      return _validation<Unit>(problem);
    }
    if (request.password.trim().isEmpty) {
      return _validation<Unit>('请填写邮箱密码或专用密码');
    }
    _boundEmail = request.email.trim().toLowerCase();
    _lastSyncAt = null;
    return const Ok<Unit>(Unit.instance);
  }

  @override
  Future<Result<Unit>> unlink() async {
    // 幂等：本来就没绑定也算成功。
    _boundEmail = null;
    _lastSyncAt = null;
    return const Ok<Unit>(Unit.instance);
  }

  @override
  Future<Result<MailEventsSnapshot>> sync() async {
    if (_boundEmail == null) {
      return _notBound<MailEventsSnapshot>();
    }
    _lastSyncAt = _clock().toUtc();
    return Ok<MailEventsSnapshot>(MailEventsSnapshot(items: _events(), stale: false));
  }

  @override
  Future<Result<MailEventsSnapshot>> events() async {
    if (_boundEmail == null) {
      return const Ok<MailEventsSnapshot>(MailEventsSnapshot(items: <MailEventItem>[], stale: false));
    }
    return Ok<MailEventsSnapshot>(MailEventsSnapshot(
      items: _events(),
      // 没同步过就不算 stale：stale 的含义是「本次同步失败，这是上次结果」。
      stale: false,
    ));
  }

  List<MailEventItem> _events() {
    final DateTime now = _clock().toUtc();
    return <MailEventItem>[
      MailEventItem(
        id: 'mail-1001',
        title: '2026 年校园马拉松志愿者招募',
        startsAt: now.add(const Duration(days: 5)),
        location: '东区体育场',
        organizer: '体育教研组',
        confidence: 0.82,
        matchedText: '11 月 30 日 08:00 东区体育场集合，11 月 26 日前报名',
        receivedAt: now.subtract(const Duration(days: 1)),
        stale: false,
      ),
      MailEventItem(
        id: 'mail-1002',
        title: '信息学院开放日',
        startsAt: now.add(const Duration(days: 12)),
        location: '信息学院 1 号楼',
        organizer: '信息学院',
        confidence: 0.66,
        matchedText: '12 月 7 日 13:30 信息学院 1 号楼大厅',
        receivedAt: now.subtract(const Duration(days: 2)),
        stale: false,
      ),
    ];
  }

  static Err<T> _validation<T>(String message) => Err<T>(
        ApiError(code: ApiErrorCode.validationFailed, message: message),
      );

  static Err<T> _notBound<T>() => Err<T>(
        const ApiError(
          code: ApiErrorCode.campusBindingRequired,
          message: '还没有绑定校园邮箱',
        ),
      );

  @override
  String toString() => 'MockMailRepository(${_boundEmail ?? '未绑定'})';
}

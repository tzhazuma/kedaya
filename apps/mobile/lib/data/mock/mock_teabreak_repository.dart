import '../../domain/models/api_error.dart';
import '../../domain/models/result.dart';
import '../../domain/models/teabreak.dart';
import '../../domain/ports/teabreak_port.dart';
import 'mock_controls.dart';
import 'teabreak_fixtures.dart';

/// [TeabreakPort] 的内存实现 —— 让茶歇切片在**无后端**时可跑（契约 §7 硬规则 4）。
///
/// 它不是"假数据展示器"：`confirm` 真的追加一条确认（从而改变时效与排序），
/// `create` 真的走一遍 [validateTeabreakDraft] 并把条目挂进列表。
/// 只有三处是模拟的：延迟 / 故障 / 空列表（[controls]）。
///
/// ⚠️ 演示数据是**相对 `now` 生成**的（见 `teabreak_fixtures.dart`），
/// 因此在同一个进程里放久了，`fresh` 会自然退化成 `stale` ——
/// 这正是真实语义，不需要"修正"。
final class MockTeabreakRepository implements TeabreakPort {
  MockTeabreakRepository({
    List<Teabreak>? teabreaks,
    MockControls? controls,
    DateTime Function()? clock,
    String postedBy = mockTeabreakPosterName,
  })  : controls = controls ?? MockControls(),
        _clock = clock ?? DateTime.now,
        _postedBy = postedBy {
    for (final Teabreak teabreak in teabreaks ?? buildMockTeabreaks(_clock())) {
      _teabreaks[teabreak.id] = teabreak;
    }
  }

  /// 可在运行时切换延迟与故障（UI 三态演示 / 测试注入）。
  final MockControls controls;

  final DateTime Function() _clock;
  final String _postedBy;

  /// 用 [Map] 而不是 [List]：`confirm` 要按 id 就地替换，且**保留插入顺序**
  /// （Dart 的 `Map` 是有序的，`list()` 因此是稳定的）。
  final Map<String, Teabreak> _teabreaks = <String, Teabreak>{};

  int _sequence = 9100;

  /// 当前条目数（测试 / 调试用）。
  int get debugLength => _teabreaks.length;

  /// 按 id 取当前值（测试用；不存在返回 null）。
  Teabreak? debugById(String id) => _teabreaks[id];

  @override
  Future<Result<List<Teabreak>>> list() async {
    await controls.simulate();
    if (controls.failure != null) {
      return controls.failureResult<List<Teabreak>>();
    }
    if (controls.emptyResults) {
      return Ok<List<Teabreak>>(const <Teabreak>[]);
    }
    // 刻意**不排序**：排序规则是纯领域函数，页面自己注入 `now` 去排。
    return Ok<List<Teabreak>>(
      List<Teabreak>.unmodifiable(_teabreaks.values),
    );
  }

  @override
  Future<Result<Unit>> confirm(String id) async {
    await controls.simulate();
    if (controls.failure != null) return controls.failureResult<Unit>();

    final Teabreak? existing = _teabreaks[id];
    if (existing == null) {
      return _err<Unit>(
        ApiErrorCode.notFound,
        '这条茶歇信息不存在或已下架',
        reason: 'TEABREAK_NOT_FOUND',
      );
    }

    final DateTime now = _clock().toUtc();
    _teabreaks[id] = existing.copyWith(
      confirms: <TeabreakConfirm>[
        ...existing.confirms,
        TeabreakConfirm(confirmId: 'tbc-${_sequence++}', confirmedAt: now),
      ],
    );
    return Ok<Unit>(Unit.instance);
  }

  @override
  Future<Result<Teabreak>> create(TeabreakDraft draft) async {
    await controls.simulate();
    if (controls.failure != null) return controls.failureResult<Teabreak>();

    final DateTime now = _clock().toUtc();
    final List<TeabreakDraftProblem> problems =
        validateTeabreakDraft(draft, now);
    if (problems.isNotEmpty) {
      // 与后端同构：一条 422，message 是给人看的若干条具体问题。
      return _err<Teabreak>(
        ApiErrorCode.validationFailed,
        problems.map(describeTeabreakProblem).join('；'),
        reason: 'VALIDATION_FAILED',
        details: <String, Object?>{
          'problems': problems
              .map((TeabreakDraftProblem problem) => problem.wire)
              .toList(growable: false),
        },
      );
    }

    final Teabreak created = Teabreak(
      id: 'tb-${_sequence++}',
      conferenceName: draft.conferenceName.trim(),
      venue: draft.venue.trim(),
      conferenceStartsAt: draft.conferenceStartsAt.toUtc(),
      conferenceEndsAt: draft.conferenceEndsAt.toUtc(),
      teaStartsAt: draft.teaStartsAt.toUtc(),
      teaEndsAt: draft.teaEndsAt.toUtc(),
      access: draft.access,
      postedBy: _postedBy,
      createdAt: now,
      note: (draft.note == null || draft.note!.trim().isEmpty)
          ? null
          : draft.note!.trim(),
    );
    _teabreaks[created.id] = created;
    return Ok<Teabreak>(created);
  }

  Err<T> _err<T>(
    ApiErrorCode code,
    String message, {
    String? reason,
    Map<String, Object?>? details,
  }) {
    final Map<String, Object?> merged = <String, Object?>{
      if (reason != null) 'reason': reason,
      ...?details,
    };
    return Err<T>(
      ApiError(
        code: code,
        message: message,
        details: merged.isEmpty ? null : merged,
      ),
      traceId: MockControls.traceId,
    );
  }
}

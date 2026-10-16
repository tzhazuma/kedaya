import '../../domain/models/api_error.dart';
import '../../domain/models/api_request.dart';
import '../../domain/models/lost_found_item.dart';
import '../../domain/models/page.dart';
import '../../domain/models/result.dart';
import '../../domain/ports/lost_found_port.dart';
import 'mock_controls.dart';
import 'mock_fixtures.dart';

/// [LostFoundPort] 的内存实现。
final class MockLostFoundRepository implements LostFoundPort {
  MockLostFoundRepository({List<LostFoundItem>? seed, MockControls? controls})
    : _items = <String, LostFoundItem>{
        for (final LostFoundItem item in seed ?? mockLostFoundItems) item.id: item,
      },
      controls = controls ?? MockControls();

  final Map<String, LostFoundItem> _items;
  final MockControls controls;
  int _sequence = 3004;

  List<LostFoundItem> snapshot() => _sorted();

  @override
  Future<Result<Page<LostFoundItem>>> listItems({
    String? cursor,
    int limit = defaultPageSize,
    LostFoundKind? kind,
  }) async {
    await controls.simulate();
    if (controls.failure != null) return controls.failureResult<Page<LostFoundItem>>();
    final List<LostFoundItem> all = _sorted()
        .where((LostFoundItem item) => kind == null || item.kind == kind)
        .toList(growable: false);
    final int start = _parseCursor(cursor);
    final int size = limit < 1 ? 1 : (limit > maxPageSize ? maxPageSize : limit);
    final List<LostFoundItem> window = all.skip(start).take(size).toList(growable: false);
    final int consumed = start + window.length;
    return Ok<Page<LostFoundItem>>(
      Page<LostFoundItem>(
        items: window,
        nextCursor: consumed < all.length ? '$consumed' : null,
        total: all.length,
      ),
    );
  }

  @override
  Future<Result<LostFoundItem>> getItem(String id) async {
    await controls.simulate();
    if (controls.failure != null) return controls.failureResult<LostFoundItem>();
    return _require(id);
  }

  @override
  Future<Result<LostFoundItem>> createItem(CreateLostFoundItemCommand command) async {
    await controls.simulate();
    if (controls.failure != null) return controls.failureResult<LostFoundItem>();
    if (command.title.trim().isEmpty) {
      return Err<LostFoundItem>(
        const ApiError(code: ApiErrorCode.validationFailed, message: '标题不能为空'),
        traceId: MockControls.traceId,
      );
    }
    final LostFoundItem created = LostFoundItem(
      id: 'lf-${_sequence++}',
      kind: command.kind,
      title: command.title.trim(),
      status: LostFoundStatus.open,
      createdAt: mockNow,
      description: command.description,
      location: command.location,
      occurredAt: command.occurredAt,
      contact: command.contact,
    );
    _items[created.id] = created;
    return Ok<LostFoundItem>(created);
  }

  @override
  Future<Result<LostFoundItem>> markMatched(String id) =>
      _transition(id, LostFoundStatus.matched);

  @override
  Future<Result<LostFoundItem>> closeItem(String id) =>
      _transition(id, LostFoundStatus.closed);

  Future<Result<LostFoundItem>> _transition(String id, LostFoundStatus next) async {
    await controls.simulate();
    if (controls.failure != null) return controls.failureResult<LostFoundItem>();
    final Result<LostFoundItem> found = _require(id);
    final LostFoundItem? item = found.valueOrNull;
    if (item == null) return found;
    if (item.status == LostFoundStatus.closed) {
      return Err<LostFoundItem>(
        const ApiError(code: ApiErrorCode.conflict, message: '该条目已关闭'),
        traceId: MockControls.traceId,
      );
    }
    final LostFoundItem updated = item.copyWith(status: next);
    _items[id] = updated;
    return Ok<LostFoundItem>(updated);
  }

  Result<LostFoundItem> _require(String id) {
    final LostFoundItem? item = _items[id];
    if (item == null) {
      return Err<LostFoundItem>(
        const ApiError(code: ApiErrorCode.notFound, message: '该条目不存在'),
        traceId: MockControls.traceId,
      );
    }
    return Ok<LostFoundItem>(item);
  }

  List<LostFoundItem> _sorted() {
    final List<LostFoundItem> all = _items.values.toList(growable: false);
    all.sort((LostFoundItem a, LostFoundItem b) => b.createdAt.compareTo(a.createdAt));
    return all;
  }

  int _parseCursor(String? cursor) {
    if (cursor == null || cursor.isEmpty) return 0;
    final int? parsed = int.tryParse(cursor);
    return (parsed == null || parsed < 0) ? 0 : parsed;
  }
}

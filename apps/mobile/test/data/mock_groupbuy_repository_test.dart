import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/data/mock/mock_controls.dart';
import 'package:kedaya/data/mock/mock_failure.dart';
import 'package:kedaya/data/mock/mock_groupbuy_repository.dart';
import 'package:kedaya/domain/models/api_error.dart';
import 'package:kedaya/domain/models/groupbuy_order.dart';
import 'package:kedaya/domain/models/page.dart';
import 'package:kedaya/domain/models/result.dart';

/// mock 适配器必须**真实可用**（契约 §7 硬规则 4），所以这里验证它的行为，
/// 而不只是"能返回数据"。
MockGroupbuyRepository buildRepository({
  List<GroupbuyOrder>? seed,
  MockControls? controls,
}) => MockGroupbuyRepository(
  seed: seed,
  controls: controls ?? MockControls(latency: Duration.zero),
);

void main() {
  test('默认 fixture 有 5 条，按创建时间倒序', () async {
    final MockGroupbuyRepository repository = buildRepository();
    final Page<GroupbuyOrder> page = (await repository.listOrders(
      const GroupbuyQuery(),
    )).unwrap;
    expect(page.items, hasLength(5));
    expect(page.total, 5);
    expect(page.items.first.id, 'gb-1001');
    expect(page.nextCursor, isNull);
    expect(page.hasMore, isFalse);
  });

  test('游标分页：limit=2 能取完全部且不重复', () async {
    final MockGroupbuyRepository repository = buildRepository();
    final List<String> ids = <String>[];
    String? cursor;
    int guard = 0;
    while (guard++ < 10) {
      final Page<GroupbuyOrder> page = (await repository.listOrders(
        GroupbuyQuery(cursor: cursor, limit: 2),
      )).unwrap;
      ids.addAll(page.items.map((GroupbuyOrder order) => order.id));
      cursor = page.nextCursor;
      if (cursor == null) break;
    }
    expect(ids, hasLength(5));
    expect(ids.toSet(), hasLength(5));
  });

  test('参团累加份数，达到目标后自动锁定', () async {
    final MockGroupbuyRepository repository = buildRepository();
    final GroupbuyOrder first = (await repository.joinOrder('gb-1001', quantity: 1)).unwrap;
    expect(first.joinedQuantity, 4);
    expect(first.status, GroupbuyStatus.recruiting);
    expect(first.isFull, isFalse);

    final GroupbuyOrder second = (await repository.joinOrder('gb-1001', quantity: 1)).unwrap;
    expect(second.joinedQuantity, 5);
    expect(second.status, GroupbuyStatus.locked);
    expect(second.isFull, isTrue);
  });

  test('状态冲突 / 不存在 / 非法份数都返回 Err（不抛异常）', () async {
    final MockGroupbuyRepository repository = buildRepository();

    final Result<GroupbuyOrder> completed = await repository.joinOrder('gb-1004', quantity: 1);
    expect(completed.isErr, isTrue);
    expect(completed.errorOrNull!.code, ApiErrorCode.conflict);

    final Result<GroupbuyOrder> missing = await repository.getOrder('gb-not-exist');
    expect(missing.isErr, isTrue);
    expect(missing.errorOrNull!.code, ApiErrorCode.notFound);

    final Result<GroupbuyOrder> zero = await repository.joinOrder('gb-1001', quantity: 0);
    expect(zero.errorOrNull!.code, ApiErrorCode.validationFailed);

    final Result<GroupbuyOrder> cancelCompleted = await repository.cancelOrder('gb-1004');
    expect(cancelCompleted.errorOrNull!.code, ApiErrorCode.conflict);
  });

  test('故障注入与空结果开关生效（UI 三态可被真实触发）', () async {
    final MockControls controls = MockControls(latency: Duration.zero);
    final MockGroupbuyRepository repository = buildRepository(controls: controls);

    controls.failureMode = MockFailureMode.upstreamUnavailable;
    final Result<Page<GroupbuyOrder>> failed = await repository.listOrders(
      const GroupbuyQuery(),
    );
    expect(failed.isErr, isTrue);
    expect(failed.errorOrNull!.code, ApiErrorCode.upstreamUnavailable);

    controls.failureMode = MockFailureMode.none;
    controls.emptyResults = true;
    final Page<GroupbuyOrder> empty = (await repository.listOrders(
      const GroupbuyQuery(),
    )).unwrap;
    expect(empty.isEmpty, isTrue);
    expect(empty.total, 0);

    controls.emptyResults = false;
    expect((await repository.listOrders(const GroupbuyQuery())).unwrap.items, hasLength(5));
  });

  test('createOrder 走校验并生成新 id', () async {
    final MockGroupbuyRepository repository = buildRepository();

    final Result<GroupbuyOrder> blank = await repository.createOrder(
      const CreateGroupbuyOrderCommand(title: '   ', unitPriceFen: 100, targetQuantity: 2),
    );
    expect(blank.errorOrNull!.code, ApiErrorCode.validationFailed);

    final Result<GroupbuyOrder> badPrice = await repository.createOrder(
      const CreateGroupbuyOrderCommand(title: '拼单', unitPriceFen: 0, targetQuantity: 2),
    );
    expect(badPrice.errorOrNull!.code, ApiErrorCode.validationFailed);

    final GroupbuyOrder created = (await repository.createOrder(
      const CreateGroupbuyOrderCommand(title: '新拼单', unitPriceFen: 1500, targetQuantity: 4),
    )).unwrap;
    expect(created.id, startsWith('gb-'));
    expect(created.joinedQuantity, 1);
    expect(created.unitPriceFen, 1500);
    expect(repository.snapshot(), hasLength(6));
  });
}

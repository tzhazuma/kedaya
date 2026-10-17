import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/domain/models/groupbuy_order.dart';

void main() {
  test('fromJson 解析全部字段，金额保持整数分', () {
    final GroupbuyOrder order = GroupbuyOrder.fromJson(<String, Object?>{
      'id': 'gb-1',
      'title': '麻辣香锅拼单',
      'description': '满 5 份起送',
      'unitPriceFen': 2800,
      'targetQuantity': 5,
      'joinedQuantity': 2,
      'status': 'recruiting',
      'initiatorId': 'u-1',
      'initiatorName': '鸭鸭',
      'pickupLocation': '一食堂二楼',
      'deadline': '2026-10-16T18:00:00Z',
      'createdAt': '2026-10-16T10:00:00Z',
      'updatedAt': '2026-10-16T11:00:00Z',
      // 非字符串元素应被丢弃，而不是让整条解析失败。
      'imageUrls': <Object?>['https://example.com/a.png', 42],
    });

    expect(order.unitPriceFen, 2800);
    expect(order.unitPriceYuan, '28.00');
    expect(order.totalFen, 14000);
    expect(order.totalYuan, '140.00');
    expect(order.remainingQuantity, 3);
    expect(order.progress, closeTo(0.4, 1e-9));
    expect(order.isFull, isFalse);
    expect(order.deadline, DateTime.utc(2026, 10, 16, 18));
    expect(order.imageUrls, <String>['https://example.com/a.png']);
    expect(order.status, GroupbuyStatus.recruiting);
  });

  test('toJson 往返：字段级一致', () {
    final GroupbuyOrder order = GroupbuyOrder.fromJson(<String, Object?>{
      'id': 'gb-1',
      'title': 't',
      'unitPriceFen': 2800,
      'targetQuantity': 5,
      'joinedQuantity': 2,
      'status': 'locked',
      'createdAt': '2026-10-16T10:00:00Z',
    });
    final GroupbuyOrder parsed = GroupbuyOrder.fromJson(order.toJson());
    expect(parsed.id, order.id);
    expect(parsed.unitPriceFen, order.unitPriceFen);
    expect(parsed.targetQuantity, order.targetQuantity);
    expect(parsed.joinedQuantity, order.joinedQuantity);
    expect(parsed.status, GroupbuyStatus.locked);
    expect(parsed.createdAt, DateTime.utc(2026, 10, 16, 10));
  });

  test('未知状态收敛为 unknown，不抛异常', () {
    final GroupbuyOrder order = GroupbuyOrder.fromJson(<String, Object?>{
      'id': 'gb-2',
      'title': 't',
      'unitPriceFen': 100,
      'targetQuantity': 2,
      'status': 'brand_new_status_from_backend',
      'createdAt': '2026-10-16T10:00:00Z',
    });
    expect(order.status, GroupbuyStatus.unknown);
    expect(order.joinedQuantity, 0);
    expect(order.progress, 0);
  });

  test('progress 收敛到 0..1，remainingQuantity 不为负', () {
    final GroupbuyOrder over = GroupbuyOrder.fromJson(<String, Object?>{
      'id': 'gb-3',
      'title': 't',
      'unitPriceFen': 100,
      'targetQuantity': 2,
      'joinedQuantity': 5,
      'createdAt': '2026-10-16T10:00:00Z',
    });
    expect(over.progress, 1);
    expect(over.remainingQuantity, 0);
    expect(over.isFull, isTrue);

    final GroupbuyOrder zeroTarget = over.copyWith(targetQuantity: 0, joinedQuantity: 0);
    expect(zeroTarget.progress, 0);
  });

  test('缺少必填字段抛 FormatException', () {
    expect(
      () => GroupbuyOrder.fromJson(<String, Object?>{'title': 't'}),
      throwsFormatException,
    );
    expect(
      () => GroupbuyOrder.fromJson(<String, Object?>{
        'id': 'gb-4',
        'title': 't',
        'unitPriceFen': '2800',
        'targetQuantity': 5,
        'createdAt': '2026-10-16T10:00:00Z',
      }),
      returnsNormally,
    );
  });

  test('金额字段接受字符串数字（后端 JS 数字序列化差异）', () {
    final GroupbuyOrder order = GroupbuyOrder.fromJson(<String, Object?>{
      'id': 'gb-5',
      'title': 't',
      'unitPriceFen': '2800',
      'targetQuantity': '5',
      'createdAt': '2026-10-16T10:00:00Z',
    });
    expect(order.unitPriceFen, 2800);
    expect(order.targetQuantity, 5);
  });

  test('GroupbuyQuery.toQuery 收敛 limit 并丢弃空值', () {
    expect(const GroupbuyQuery().toQuery(), <String, Object?>{'limit': 20});
    expect(
      const GroupbuyQuery(cursor: 'c1', limit: 500).toQuery(),
      <String, Object?>{'cursor': 'c1', 'limit': 100},
    );
    expect(
      const GroupbuyQuery(status: GroupbuyStatus.recruiting, keyword: ' 香锅 ').toQuery(),
      <String, Object?>{'limit': 20, 'status': 'recruiting', 'keyword': '香锅'},
    );
    expect(
      const GroupbuyQuery(status: GroupbuyStatus.unknown).toQuery(),
      <String, Object?>{'limit': 20},
    );
  });
}

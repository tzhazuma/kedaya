import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/domain/models/buddy.dart';
import 'package:kedaya/domain/models/buddy_application.dart';

/// 申请与审批的领域测试（规格 §2.4 / §2.8 / §5.5 / §5.6）。
void main() {
  group('BuddyApplication 状态机（规格 §2.8，T1 的申请侧）', () {
    const List<BuddyApplicationStatus> real = <BuddyApplicationStatus>[
      BuddyApplicationStatus.pending,
      BuddyApplicationStatus.accepted,
      BuddyApplicationStatus.rejected,
      BuddyApplicationStatus.withdrawn,
    ];
    const Map<BuddyApplicationStatus, Set<BuddyApplicationStatus>> allowed =
        <BuddyApplicationStatus, Set<BuddyApplicationStatus>>{
      BuddyApplicationStatus.pending: <BuddyApplicationStatus>{
        BuddyApplicationStatus.accepted,
        BuddyApplicationStatus.rejected,
        BuddyApplicationStatus.withdrawn,
      },
      // 撤回后重新申请是**更新同一行**回 PENDING（§2.4 的唯一约束）。
      BuddyApplicationStatus.withdrawn: <BuddyApplicationStatus>{
        BuddyApplicationStatus.pending,
      },
      BuddyApplicationStatus.accepted: <BuddyApplicationStatus>{},
      BuddyApplicationStatus.rejected: <BuddyApplicationStatus>{},
    };

    test('4×4 全矩阵逐格校验', () {
      for (final BuddyApplicationStatus from in real) {
        for (final BuddyApplicationStatus to in real) {
          expect(
            canTransitionBuddyApplication(from, to),
            allowed[from]!.contains(to),
            reason: '${from.wire} → ${to.wire}',
          );
        }
      }
    });

    test('自反 false；unknown 永不参与', () {
      for (final BuddyApplicationStatus status
          in BuddyApplicationStatus.values) {
        expect(canTransitionBuddyApplication(status, status), isFalse);
        expect(
          canTransitionBuddyApplication(status, BuddyApplicationStatus.unknown),
          isFalse,
        );
        expect(
          canTransitionBuddyApplication(BuddyApplicationStatus.unknown, status),
          isFalse,
        );
      }
    });

    test('状态收敛与语义', () {
      expect(
        BuddyApplicationStatus.fromWire('pending'),
        BuddyApplicationStatus.pending,
      );
      expect(
        BuddyApplicationStatus.fromWire('WITHDRAWN'),
        BuddyApplicationStatus.withdrawn,
      );
      expect(
        BuddyApplicationStatus.fromWire('???'),
        BuddyApplicationStatus.unknown,
      );
      expect(BuddyApplicationStatus.pending.isPending, isTrue);
      expect(BuddyApplicationStatus.accepted.isPending, isFalse);
      expect(BuddyApplicationStatus.rejected.isTerminal, isTrue);
      expect(BuddyApplicationStatus.accepted.isTerminal, isTrue);
      expect(BuddyApplicationStatus.withdrawn.isTerminal, isFalse);
    });
  });

  group('BuddyDecision（规格 §5.2：不拆成 accept / reject）', () {
    test('wire 与目标状态', () {
      expect(BuddyDecision.accepted.wire, 'ACCEPTED');
      expect(BuddyDecision.rejected.wire, 'REJECTED');
      expect(
          BuddyDecision.accepted.targetStatus, BuddyApplicationStatus.accepted);
      expect(
          BuddyDecision.rejected.targetStatus, BuddyApplicationStatus.rejected);
      expect(BuddyDecision.tryFromWire('accepted'), BuddyDecision.accepted);
      expect(BuddyDecision.tryFromWire('maybe'), isNull);
    });
  });

  group('BuddyApplication 解析与序列化', () {
    test('字段往返；展示名回落为 id', () {
      final BuddyApplication application =
          BuddyApplication.fromJson(<String, Object?>{
        'id': 'ba-1',
        'postId': 'bp-1',
        'applicantId': 'u-1',
        'message': '一起？',
        'status': 'PENDING',
        'createdAt': '2026-10-17T04:00:00.000Z',
      });
      expect(application.displayName, 'u-1');
      expect(application.isPending, isTrue);
      expect(application.isFrom('u-1'), isTrue);
      expect(application.isFrom('u-2'), isFalse);
      expect(application.decidedAt, isNull);
      expect(application.decidedBy, isNull);

      final Map<String, Object?> json = application.toJson();
      expect(json['postId'], 'bp-1');
      expect(json['status'], 'PENDING');
      expect(json['createdAt'], '2026-10-17T04:00:00.000Z');
      expect(json['decidedAt'], isNull);
    });

    test('审批后带上 decidedAt / decidedBy（规格 §2.4）', () {
      final BuddyApplication decided = BuddyApplication(
        id: 'ba-1',
        postId: 'bp-1',
        applicantId: 'u-1',
        createdAt: DateTime.utc(2026, 10, 17, 4),
      ).copyWith(
        status: BuddyApplicationStatus.accepted,
        decidedAt: DateTime.utc(2026, 10, 17, 5),
        decidedBy: 'u-owner',
      );
      expect(decided.status, BuddyApplicationStatus.accepted);
      expect(decided.decidedAt, DateTime.utc(2026, 10, 17, 5));
      expect(decided.decidedBy, 'u-owner');
    });
  });

  group('BuddyJoinCommand（规格 §5.5 / §6.2）', () {
    test('留言可选；空留言合法', () {
      expect(const BuddyJoinCommand(postId: 'bp-1').isValid, isTrue);
      expect(
        const BuddyJoinCommand(postId: 'bp-1', message: '   ').messageError,
        isNull,
      );
    });

    test('留言 ≤200 字', () {
      final String long = List<String>.filled(201, '鸭').join();
      expect(
        BuddyJoinCommand(postId: 'bp-1', message: long).messageError,
        contains('$buddyApplicationMessageMaxLength'),
      );
    });

    test('留言里不得写联系方式（规格 §6.2）', () {
      expect(
        const BuddyJoinCommand(postId: 'bp-1', message: '加我微信：abc')
            .messageError,
        contains('微信号'),
      );
      expect(
        const BuddyJoinCommand(postId: 'bp-1', message: '13800138000')
            .messageError,
        contains('手机号'),
      );
    });

    test('请求体只有 message（postId 在路径里），空留言发 null', () {
      expect(
        const BuddyJoinCommand(postId: 'bp-1', message: ' 一起 ').toJson(),
        <String, Object?>{'message': '一起'},
      );
      expect(
        const BuddyJoinCommand(postId: 'bp-1').toJson(),
        <String, Object?>{'message': null},
      );
      expect(
        const BuddyJoinCommand(postId: 'bp-1').toJson().containsKey('postId'),
        isFalse,
      );
    });
  });

  group('BuddyDecideCommand（规格 §5.6）', () {
    test('请求体是 { applicationId, decision }，postId 在路径里', () {
      const BuddyDecideCommand command = BuddyDecideCommand(
        postId: 'bp-1',
        applicationId: 'ba-1',
        decision: BuddyDecision.accepted,
      );
      expect(command.toJson(), <String, Object?>{
        'applicationId': 'ba-1',
        'decision': 'ACCEPTED',
      });
      expect(command.toJson().containsKey('postId'), isFalse);
    });
  });
}

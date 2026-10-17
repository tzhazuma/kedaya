import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/domain/models/techpie_link.dart';

/// `TechpieLink` / `CampusBindingSummary` 的领域测试。
///
/// 重点不是"能解析"，而是：
///   - 平台与状态枚举**逐字**对齐契约 §11.10-B / §2.9，未知值**不静默降级**；
///   - 绑定元数据的键名是**封闭集合**（规格 §8.3 的 8 个禁用键名一个都不许出现）；
///   - "已绑定但已过期"与"已绑定"是两种不同状态（过期**不导致登出**）。
void main() {
  final DateTime now = DateTime.utc(2026, 10, 17, 2);

  group('CampusPlatform', () {
    test('wire 值与契约 §11.10-B 逐字一致', () {
      expect(
        CampusPlatform.values.map((CampusPlatform item) => item.wire).toSet(),
        <String>{'cas', 'egate', 'cpdaily', 'ecard', 'techpie'},
      );
    });

    test('fromWire 忽略大小写与首尾空白；未知返回 null', () {
      expect(CampusPlatform.fromWire(' cpDaily '), CampusPlatform.cpdaily);
      expect(CampusPlatform.fromWire('ECARD'), CampusPlatform.ecard);
      expect(CampusPlatform.fromWire('academic'), isNull);
      expect(CampusPlatform.fromWire(''), isNull);
    });

    test('cas 是身份源而不是可绑定的校园系统；ecard 走 OPENID 通道', () {
      expect(CampusPlatform.cas.isCampusCapability, isFalse);
      expect(CampusPlatform.egate.isCampusCapability, isTrue);
      expect(CampusPlatform.ecard.usesOpenIdChannel, isTrue);
      expect(CampusPlatform.cpdaily.usesOpenIdChannel, isFalse);
    });
  });

  group('CampusBindingStatus', () {
    test('wire 值与契约 §2.9 的 5 个状态一致', () {
      expect(
        CampusBindingStatus.values
            .map((CampusBindingStatus item) => item.wire)
            .toSet(),
        <String>{'UNLINKED', 'LINKING', 'LINKED', 'EXPIRED', 'REVOKED'},
      );
    });

    test('needsRebind 只对 EXPIRED / REVOKED 为真（与"从未绑定"区分）', () {
      expect(CampusBindingStatus.expired.needsRebind, isTrue);
      expect(CampusBindingStatus.revoked.needsRebind, isTrue);
      expect(CampusBindingStatus.unlinked.needsRebind, isFalse);
      expect(CampusBindingStatus.linked.needsRebind, isFalse);
      expect(CampusBindingStatus.linking.isInFlight, isTrue);
    });

    test('fromWire 未知返回 null', () {
      expect(
          CampusBindingStatus.fromWire('linked'), CampusBindingStatus.linked);
      expect(CampusBindingStatus.fromWire('weird'), isNull);
    });
  });

  group('CampusBindingSummary', () {
    CampusBindingSummary summary({
      CampusPlatform platform = CampusPlatform.cpdaily,
      CampusBindingStatus status = CampusBindingStatus.linked,
      DateTime? expiresAt,
    }) =>
        CampusBindingSummary(
          platform: platform,
          status: status,
          externalUserId: '20240001',
          expiresAt: expiresAt,
          lastSyncAt: now,
        );

    test('toJson 的键名是封闭集合（5 个）', () {
      expect(summary().toJson().keys.toSet(), <String>{
        'platform',
        'status',
        'externalUserId',
        'expiresAt',
        'lastSyncAt',
      });
    });

    test('isUsableAt：LINKED 且未过期才算可用', () {
      expect(
          summary(expiresAt: now.add(const Duration(days: 1))).isUsableAt(now),
          isTrue);
      expect(
          summary(expiresAt: now.subtract(const Duration(seconds: 1)))
              .isUsableAt(now),
          isFalse);
      // 无 expiresAt（由服务端决定）= 不过期。
      expect(summary().isUsableAt(now), isTrue);
      // 状态不是 LINKED 时，即使 expiresAt 在未来也不可用。
      expect(
        summary(
          status: CampusBindingStatus.revoked,
          expiresAt: now.add(const Duration(days: 1)),
        ).isUsableAt(now),
        isFalse,
      );
    });

    test('fromJson 只读白名单键：多出来的凭证键不会被读取', () {
      final CampusBindingSummary parsed = CampusBindingSummary.fromJson(
        <String, Object?>{
          'platform': 'cpdaily',
          'status': 'LINKED',
          'externalUserId': '20240001',
          'expiresAt': '2026-11-16T02:00:00.000Z',
          'lastSyncAt': '2026-10-17T02:00:00.000Z',
          // 下面这些键**存在但绝不允许被读取**（契约 §11.4 I1）。
          'sessionCipher': 'v1:AAAA',
          'cookie': 'CASTGC=deadbeef',
          'sessionToken': 'st-1',
          'ticket': 'wvt-1',
          'tenant': 'shanghaitech',
        },
      );
      final Map<String, Object?> json = parsed.toJson();
      for (final String key in json.keys) {
        final String lower = key.toLowerCase();
        for (final String forbidden in <String>[
          'cookie',
          'session',
          'tgc',
          'ticket',
          'tenant',
        ]) {
          expect(
            lower.contains(forbidden),
            isFalse,
            reason: '键 "$key" 命中了禁用词 "$forbidden"',
          );
        }
      }
      expect(json.toString(), isNot(contains('deadbeef')));
      expect(json.toString(), isNot(contains('v1:AAAA')));
    });

    test('未知平台 / 未知状态抛 FormatException（不静默降级）', () {
      expect(
        () => CampusBindingSummary.fromJson(<String, Object?>{
          'platform': 'academic',
          'status': 'LINKED',
        }),
        throwsFormatException,
      );
      expect(
        () => CampusBindingSummary.fromJson(<String, Object?>{
          'platform': 'cpdaily',
          'status': 'WHATEVER',
        }),
        throwsFormatException,
      );
    });
  });

  group('TechpieLink', () {
    test('fromJson 从同一层读 id 与元数据（规格 §8.3 的行形状）', () {
      final TechpieLink link = TechpieLink.fromJson(<String, Object?>{
        'id': 'tp-1001',
        'platform': 'cpdaily',
        'status': 'LINKED',
        'externalUserId': '20240001',
        'expiresAt': '2026-11-16T02:00:00.000Z',
        'lastSyncAt': '2026-10-17T02:00:00.000Z',
      });
      expect(link.id, 'tp-1001');
      expect(link.platform, CampusPlatform.cpdaily);
      expect(link.status, CampusBindingStatus.linked);
      expect(link.isUsableAt(now), isTrue);
    });

    test('toJson 键名 = id + 5 个元数据键（没有 userId / tokenCipher）', () {
      final TechpieLink link = TechpieLink(
        id: 'tp-1001',
        summary: CampusBindingSummary(
          platform: CampusPlatform.egate,
          status: CampusBindingStatus.linked,
          expiresAt: now.add(const Duration(days: 30)),
        ),
      );
      expect(link.toJson().keys.toSet(), <String>{
        'id',
        'platform',
        'status',
        'externalUserId',
        'expiresAt',
        'lastSyncAt',
      });
      expect(link.toJson().containsKey('userId'), isFalse);
      expect(link.toJson().containsKey('tokenCipher'), isFalse);
    });

    test('canRenew：LINKED 与 EXPIRED/REVOKED 可以续期，UNLINKED/LINKING 不可以', () {
      TechpieLink withStatus(CampusBindingStatus status) => TechpieLink(
            id: 'tp-1',
            summary: CampusBindingSummary(
              platform: CampusPlatform.egate,
              status: status,
            ),
          );
      expect(withStatus(CampusBindingStatus.linked).canRenew, isTrue);
      expect(withStatus(CampusBindingStatus.expired).canRenew, isTrue);
      expect(withStatus(CampusBindingStatus.revoked).canRenew, isTrue);
      expect(withStatus(CampusBindingStatus.unlinked).canRenew, isFalse);
      expect(withStatus(CampusBindingStatus.linking).canRenew, isFalse);
    });

    test('toString 只打元数据（不含凭证字段名或值）', () {
      final TechpieLink link = TechpieLink(
        id: 'tp-1001',
        summary: CampusBindingSummary(
          platform: CampusPlatform.ecard,
          status: CampusBindingStatus.linked,
          externalUserId: '20240001',
        ),
      );
      expect(link.toString(), contains('ecard'));
      expect(link.toString(), isNot(contains('20240001')));
    });
  });
}

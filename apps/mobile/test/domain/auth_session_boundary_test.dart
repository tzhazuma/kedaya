import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/domain/models/auth_session.dart';
import 'package:kedaya/domain/models/campus_binding.dart';
import 'package:kedaya/domain/models/user.dart';

/// 契约 §5 是"最容易出错"的地方，因此这里做**机械校验**：
/// 第一级身份对象的序列化结果里不允许出现任何校园系统凭据字段。
void main() {
  final AuthSession session = AuthSession(
    user: const User(
      userId: 'u-1',
      studentId: '20240001',
      displayName: '测试账号',
      department: '信息科学与技术学院',
      email: 'test@shanghaitech.edu.cn',
    ),
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    issuedAt: DateTime.utc(2026, 10, 16, 12),
    expiresAt: DateTime.utc(2026, 10, 16, 14),
  );

  test('AuthSession 的 JSON 里没有校园系统凭据字段（契约 §5 硬规则 1）', () {
    final Set<String> keys = _allKeys(session.toJson());
    const List<String> forbidden = <String>[
      'cookie',
      'tgc',
      'castgc',
      'session',
      'egate',
      'cpdaily',
      'ticket',
      'tenant',
    ];
    for (final String key in keys) {
      final String lower = key.toLowerCase();
      for (final String token in forbidden) {
        expect(
          lower.contains(token),
          isFalse,
          reason: 'AuthSession 出现了疑似校园系统字段 "$key"（命中 "$token"）',
        );
      }
    }
    expect(
      keys,
      containsAll(<String>['user', 'accessToken', 'refreshToken', 'issuedAt', 'expiresAt']),
    );
  });

  test('CampusBinding 只暴露元数据，字段集合是封闭的', () {
    final CampusBinding binding = CampusBinding(
      system: CampusSystem.egate,
      boundAt: DateTime.utc(2026, 10, 16),
      displayName: '20240001',
      expiresAt: DateTime.utc(2026, 11, 16),
    );
    expect(_allKeys(binding.toJson()), <String>{
      'system',
      'boundAt',
      'displayName',
      'expiresAt',
    });
    expect(binding.toJson()['system'], 'egate');
    expect(binding.isActive, isTrue);
  });

  test('未知校园系统 id 抛 FormatException（不静默降级）', () {
    expect(
      () => CampusBinding.fromJson(<String, Object?>{
        'system': 'not-a-system',
        'boundAt': '2026-10-16T00:00:00Z',
      }),
      throwsFormatException,
    );
  });

  test('过期判断可注入 now（不依赖真实时钟）', () {
    expect(session.isExpiredAt(DateTime.utc(2026, 10, 16, 13)), isFalse);
    expect(session.isExpiredAt(DateTime.utc(2026, 10, 16, 14)), isTrue);
    expect(session.isExpiredAt(DateTime.utc(2026, 10, 16, 15)), isTrue);
    expect(
      session.expiresWithin(const Duration(hours: 3), now: DateTime.utc(2026, 10, 16, 12)),
      isTrue,
    );
    expect(
      session.expiresWithin(const Duration(minutes: 30), now: DateTime.utc(2026, 10, 16, 12)),
      isFalse,
    );
  });

  test('契约 §8：同步 hydrate 出来的会话可能还没有令牌', () {
    final AuthSession restored = session.copyWith(accessToken: '', refreshToken: '');
    expect(restored.hasTokens, isFalse);
    expect(session.hasTokens, isTrue);
  });

  test('AuthSession.fromJson 往返一致，时间统一为 UTC', () {
    final AuthSession parsed = AuthSession.fromJson(session.toJson());
    expect(parsed, session);
    expect(parsed.expiresAt.isUtc, isTrue);
    expect(parsed.issuedAt.isUtc, isTrue);
  });

  test('toString 不泄露令牌', () {
    expect(session.toString(), isNot(contains('access-token')));
    expect(session.toString(), isNot(contains('refresh-token')));
  });
}

/// 递归收集 JSON 里出现的所有键名。
Set<String> _allKeys(Map<String, Object?> json) {
  final Set<String> keys = <String>{};
  void visit(Object? value) {
    if (value is Map<String, Object?>) {
      for (final MapEntry<String, Object?> entry in value.entries) {
        keys.add(entry.key);
        visit(entry.value);
      }
    } else if (value is List<Object?>) {
      for (final Object? item in value) {
        visit(item);
      }
    }
  }

  visit(json);
  return keys;
}

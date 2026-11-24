import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/data/mock/mock_auth_repository.dart';
import 'package:kedaya/data/mock/mock_controls.dart';
import 'package:kedaya/domain/models/auth_session.dart';

void main() {
  group('MockAuthRepository.signInWithCasCode', () {
    test('空授权码被拒', () async {
      final MockAuthRepository repo =
          MockAuthRepository(controls: MockControls(latency: Duration.zero));
      expect(() => repo.signInWithCasCode('   '), throwsStateError);
    });

    test('非空授权码完成登录并广播会话', () async {
      final MockAuthRepository repo =
          MockAuthRepository(controls: MockControls(latency: Duration.zero));
      final AuthSession session = await repo.signInWithCasCode('abcdef0123456789');
      expect(repo.current, isNotNull);
      expect(session.user.userId, isNotEmpty);
    });
  });
}

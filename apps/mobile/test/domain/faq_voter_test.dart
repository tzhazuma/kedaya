import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/domain/models/faq.dart';

/// 「有用」投票者标识的测试 —— 幂等键必须**稳定**且两种身份**不混淆**。
///
/// 这是"同一用户重复点只算一次"能被实现的前提：
/// 同一用户两次点击必须落到同一个 key 上，而设备 id 不能冒充某个实名用户。
void main() {
  group('FaqVoter.resolve', () {
    test('已登录：用实名 userId，key 前缀 u:', () {
      final FaqVoter voter = FaqVoter.resolve(userId: 'u-1001', deviceId: 'dev-abc');

      expect(voter.key, 'u:u-1001');
      expect(voter.isRealUser, isTrue);
      expect(voter.kind, FaqVoterKind.realUser);
      expect(voter.id, 'u-1001');
    });

    test('未登录 / 空 userId：用设备 id，key 前缀 d:', () {
      expect(
        FaqVoter.resolve(userId: null, deviceId: 'dev-abc').key,
        'd:dev-abc',
      );
      expect(
        FaqVoter.resolve(userId: '', deviceId: 'dev-abc').key,
        'd:dev-abc',
      );
      expect(
        FaqVoter.resolve(userId: null, deviceId: 'dev-abc').isRealUser,
        isFalse,
      );
    });

    test('同一个字符串在两种身份下得到不同的 key（不会互相冒充）', () {
      expect(FaqVoter.forUser('same').key, isNot(FaqVoter.forDevice('same').key));
    });

    test('相同入参稳定得到相同 key（幂等的必要条件）', () {
      expect(
        FaqVoter.resolve(userId: 'u-1', deviceId: 'dev-1'),
        FaqVoter.resolve(userId: 'u-1', deviceId: 'dev-2'),
      );
      expect(
        FaqVoter.resolve(userId: 'u-1', deviceId: 'dev-1').hashCode,
        FaqVoter.resolve(userId: 'u-1', deviceId: 'dev-1').hashCode,
      );
    });
  });

  group('FaqVoter.parse', () {
    test('user / device key 往返一致', () {
      expect(FaqVoter.parse('u:u-1001'), FaqVoter.forUser('u-1001'));
      expect(FaqVoter.parse('d:dev-abc'), FaqVoter.forDevice('dev-abc'));
      expect(FaqVoter.parse('u:u-1001').key, 'u:u-1001');
    });

    test('无法识别的 key 保守地当作设备身份（不会误认成某个实名用户）', () {
      final FaqVoter weird = FaqVoter.parse('whatever');

      expect(weird.isRealUser, isFalse);
      expect(weird.key, 'd:whatever');

      final FaqVoter unknownPrefix = FaqVoter.parse('x:y');
      expect(unknownPrefix.isRealUser, isFalse);
      expect(unknownPrefix.key, 'd:x:y');
    });

    test('空 id 的 key 也保守地按设备处理', () {
      expect(FaqVoter.parse('u:').isRealUser, isFalse);
    });
  });

  group('幂等键的端到端语义', () {
    test('同一 voter 的 key 不变 => 服务端集合里只占一个位置', () {
      final Set<String> voters = <String>{};
      final String first = FaqVoter.resolve(userId: 'u-1', deviceId: 'dev-1').key;
      final String second = FaqVoter.resolve(userId: 'u-1', deviceId: 'dev-1').key;

      voters.add(first);
      voters.add(second);

      expect(voters, hasLength(1), reason: '重复点击只会记一次');
    });

    test('未登录时投的票不会算到之后登录的人头上', () {
      final Set<String> voters = <String>{};
      voters.add(FaqVoter.resolve(userId: null, deviceId: 'dev-1').key);
      voters.add(FaqVoter.resolve(userId: 'u-1', deviceId: 'dev-1').key);

      expect(voters, hasLength(2), reason: '设备票与用户票是两个不同的投票者');
    });
  });
}

import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/domain/models/campus_web_entry.dart';
import 'package:kedaya/domain/models/techpie_link.dart';

/// 目标地址校验的 **fail-closed** 测试（契约 §11.18-B）。
///
/// 这是"凭证外泄到攻击者域名"的唯一防线之一（另一道在服务端）。
/// 因此本文件对**每一种绕过手法**都单独断言一条：
/// 子域通配、`http`、IP 字面量、非 443 端口、userinfo、后缀伪装。
void main() {
  const String campusHost = 'https://ecourse.shanghaitech.edu.cn/';

  group('campusTargetUrlProblem 的通过路径', () {
    test('白名单内的 https + 443 → null（通过）', () {
      expect(campusTargetUrlProblem(campusHost), isNull);
      expect(campusTargetUrlProblem('https://elrc.shanghaitech.edu.cn/a/b?c=1'),
          isNull);
      // host 大小写不敏感（Uri 会归一化，代码再兜一层）。
      expect(campusTargetUrlProblem('https://ECOURSE.ShanghaiTech.EDU.CN/'),
          isNull);
      // 显式写 :443 也是允许的。
      expect(campusTargetUrlProblem('https://ecourse.shanghaitech.edu.cn:443/'),
          isNull);
    });

    test('白名单是精确匹配，不是后缀通配', () {
      expect(campusDomainAllowlist.contains('shanghaitech.edu.cn'), isFalse);
      expect(campusTargetUrlProblem('https://shanghaitech.edu.cn/'), isNotNull);
      expect(
        campusTargetUrlProblem('https://anything.shanghaitech.edu.cn/'),
        isNotNull,
        reason: '通配子域等于没有白名单（契约 §11.18-B 第 1 条）',
      );
    });
  });

  group('campusTargetUrlProblem 的拒绝路径', () {
    test('畸形 URL / 无 scheme / 非 https', () {
      expect(campusTargetUrlProblem('not a url'), isNotNull);
      expect(campusTargetUrlProblem('ecourse.shanghaitech.edu.cn'), isNotNull);
      expect(campusTargetUrlProblem('http://ecourse.shanghaitech.edu.cn/'),
          isNotNull);
      expect(campusTargetUrlProblem('ftp://ecourse.shanghaitech.edu.cn/'),
          isNotNull);
      expect(campusTargetUrlProblem(''), isNotNull);
    });

    test('userinfo 绕过（https://白名单域名@evil.com）', () {
      final String? problem = campusTargetUrlProblem(
        'https://shanghaitech.edu.cn@evil.com/',
      );
      expect(problem, isNotNull);
      expect(problem, contains('userinfo'));
      // 即使 userinfo 是白名单域名、host 也是白名单域名，也要拒绝。
      expect(
        campusTargetUrlProblem('https://a@ecourse.shanghaitech.edu.cn/'),
        isNotNull,
      );
    });

    test('IP 字面量（IPv4 / IPv6）', () {
      expect(campusTargetUrlProblem('https://127.0.0.1/'), isNotNull);
      expect(campusTargetUrlProblem('https://10.0.0.1/'), isNotNull);
      expect(campusTargetUrlProblem('https://[::1]/'), isNotNull);
    });

    test('非 443 端口', () {
      final String? problem = campusTargetUrlProblem(
        'https://ecourse.shanghaitech.edu.cn:8080/',
      );
      expect(problem, isNotNull);
      expect(problem, contains('443'));
      expect(
          campusTargetUrlProblem('https://ecourse.shanghaitech.edu.cn:8443/'),
          isNotNull);
    });

    test('后缀伪装（白名单域名作为前缀或后缀）', () {
      expect(
        campusTargetUrlProblem('https://ecourse.shanghaitech.edu.cn.evil.com/'),
        isNotNull,
      );
      expect(
        campusTargetUrlProblem(
            'https://evil-ecourse.shanghaitech.edu.cn.attacker.net/'),
        isNotNull,
      );
    });

    test('规格 §8.4 的示例地址（:8080）会被拒绝 —— 与契约 §11.18-B 第 3 条冲突', () {
      // 规格 §8.4 写的是 `https://ecourse.shanghaitech.edu.cn:8080/`，
      // 而 Lead 裁决明确禁止非 443 端口。裁决晚于规格，本端以裁决为准。
      expect(
        campusTargetUrlProblem('https://ecourse.shanghaitech.edu.cn:8080/'),
        isNotNull,
      );
    });
  });

  group('占位标记与入口目录', () {
    test('白名单与入口地址都带机器可见的占位标记（U11 未关闭）', () {
      expect(campusDomainAllowlistIsPlaceholder, isTrue);
      expect(phase0CampusWebEntriesArePlaceholder, isTrue);
      expect(campusDomainAllowlist, isNotEmpty);
      for (final String host in campusDomainAllowlist) {
        expect(host, isNot(contains('*')), reason: '白名单不许出现通配符');
        expect(host, isNot(startsWith('https://')), reason: '白名单里只放 host');
      }
    });

    test('Phase 0 的四个入口本身都通过校验（否则页面会全部不可用）', () {
      expect(phase0CampusWebEntries, hasLength(4));
      for (final CampusWebEntry entry in phase0CampusWebEntries) {
        expect(entry.targetUrlProblem, isNull, reason: '${entry.id} 的地址不合法');
        expect(entry.isTargetUrlAllowed, isTrue);
        expect(entry.platform, CampusPlatform.cpdaily);
        // 与 `services/api` 一致：四个 WebView 入口**不要求绑定**（W4 直连）。
        expect(entry.requiresBinding, isFalse, reason: entry.id);
      }
      expect(
        phase0CampusWebEntries.map((CampusWebEntry entry) => entry.id).toSet(),
        <String>{'ecourse', 'leave', 'activity', 'elrc'},
      );
    });

    test('CampusWebEntry 解析：未知平台抛错，toJson 键名封闭', () {
      expect(
        () => CampusWebEntry.fromJson(<String, Object?>{
          'id': 'x',
          'title': 'y',
          'platform': 'academic',
          'targetUrl': campusHost,
        }),
        throwsFormatException,
      );
      expect(phase0CampusWebEntries.first.toJson().keys.toSet(), <String>{
        'id',
        'title',
        'description',
        'platform',
        'targetUrl',
        'requiresBinding',
      });
    });
  });

  group('票据与中转 URL 的语义', () {
    WebViewTicket ticket({int expiresInSec = 30}) => WebViewTicket(
          ticket: 'wvt-secret-value',
          expiresInSec: expiresInSec,
          targetUrl: campusHost,
          platform: CampusPlatform.cpdaily,
        );

    test('默认时效是规格 §8.4 的 30 秒', () {
      expect(WebViewTicket.defaultTicketTtlSec, 30);
      expect(ticket().expiresInSec, 30);
    });

    test('票据 30 秒后过期（可注入时刻，不依赖真实时钟）', () {
      final DateTime issuedAt = DateTime.utc(2026, 10, 17, 2);
      expect(ticket().isExpiredAt(issuedAt, issuedAt), isFalse);
      expect(
        ticket()
            .isExpiredAt(issuedAt, issuedAt.add(const Duration(seconds: 29))),
        isFalse,
      );
      expect(
        ticket()
            .isExpiredAt(issuedAt, issuedAt.add(const Duration(seconds: 30))),
        isTrue,
      );
      expect(
        ticket().expiresAtFrom(issuedAt),
        issuedAt.add(const Duration(seconds: 30)),
      );
    });

    test('fromJson 允许调用方补 platform（§8.4 的响应示例没有该字段）', () {
      final WebViewTicket parsed = WebViewTicket.fromJson(<String, Object?>{
        'ticket': 'wvt-1',
        'expiresInSec': 30,
        'targetUrl': campusHost,
      }, platform: CampusPlatform.cpdaily);
      expect(parsed.platform, CampusPlatform.cpdaily);
      expect(parsed.ticket, 'wvt-1');
      expect(parsed.toString(), isNot(contains('wvt-1')));

      // 不给 platform 也**不报错**：Phase 0 的 W4 直连本来就不指定平台
      // （服务端因此不要求绑定）。
      final WebViewTicket anonymous = WebViewTicket.fromJson(<String, Object?>{
        'ticket': 'wvt-2',
        'targetUrl': campusHost,
      });
      expect(anonymous.platform, isNull);
      expect(anonymous.expiresInSec, WebViewTicket.defaultTicketTtlSec);
    });

    test('中转 URL 的 expiresAt 允许为空（W4 直连返回 null）→ 用票据时效兜底', () {
      final DateTime fallback = DateTime.utc(2026, 10, 17, 2, 0, 30);
      final WebViewHandoff handoff = WebViewHandoff.fromJson(
        <String, Object?>{
          'url': campusHost,
          'targetUrl': campusHost,
          'expiresAt': null,
        },
        fallbackExpiresAt: fallback,
      );
      expect(handoff.expiresAt, fallback);
      expect(handoff.isExpiredAt(fallback.subtract(const Duration(seconds: 1))),
          isFalse);

      // 服务端给了具体时刻时以服务端为准。
      final WebViewHandoff explicit = WebViewHandoff.fromJson(
        <String, Object?>{
          'url': campusHost,
          'expiresAt': '2026-10-17T02:00:30.000Z',
        },
        fallbackExpiresAt: DateTime.utc(2099),
        targetUrl: campusHost,
      );
      expect(explicit.expiresAt, DateTime.utc(2026, 10, 17, 2, 0, 30));
      expect(explicit.targetUrl, campusHost);
    });

    test('toString 必须脱敏（票据 / 中转 URL 都不许出现在字符串里）', () {
      expect(ticket().toString(), isNot(contains('wvt-secret-value')));
      expect(ticket().toString(), contains('redacted'));

      final WebViewHandoff handoff = WebViewHandoff(
        url: 'https://api.kedaya.app/wv/wvt-secret-value',
        targetUrl: campusHost,
        expiresAt: DateTime.utc(2026, 10, 17, 2, 0, 30),
      );
      expect(handoff.toString(), isNot(contains('wvt-secret-value')));
      expect(handoff.toString(), contains('redacted'));
    });

    test('中转 URL 过期判定', () {
      final DateTime expiresAt = DateTime.utc(2026, 10, 17, 2, 0, 30);
      final WebViewHandoff handoff = WebViewHandoff(
        url: 'https://api.kedaya.app/wv/wvt-1',
        targetUrl: campusHost,
        expiresAt: expiresAt,
      );
      expect(
          handoff.isExpiredAt(expiresAt.subtract(const Duration(seconds: 1))),
          isFalse);
      expect(handoff.isExpiredAt(expiresAt), isTrue);
    });
  });
}

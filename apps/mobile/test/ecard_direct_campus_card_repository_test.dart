import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/data/campus/campus_http_client.dart';
import 'package:kedaya/data/campus/ecard_api_client.dart';
import 'package:kedaya/data/campus/ecard_bind_client.dart';
import 'package:kedaya/data/campus/ecard_link_store.dart';
import 'package:kedaya/data/repositories/ecard_direct_campus_card_repository.dart';
import 'package:kedaya/domain/models/api_error.dart';
import 'package:kedaya/domain/models/campus_card.dart';
import 'package:kedaya/domain/models/page.dart';
import 'package:kedaya/domain/models/result.dart';

void main() {
  /// 记录每一次请求，并按 `path` 返回预置 JSON（明文即可，解码器兼容）。
  EcardDirectCampusCardRepository build(
    _Recorder recorder, {
    EcardLinkStore? store,
    String? cookie = 'SESSION=abc',
  }) {
    return EcardDirectCampusCardRepository(
      clientFactory: (String openId, String? cookieHeader) => EcardApiClient(
        transport: recorder.call,
        openId: openId,
        cookieHeader: cookieHeader,
      ),
      linkStore: store ?? InMemoryEcardLinkStore(),
      cookieReader: (String host) async => cookie,
      host: 'ecard.shanghaitech.edu.cn',
    );
  }

  InMemoryEcardLinkStore boundStore() => InMemoryEcardLinkStore(
        EcardLink(
          openId: 'openid-abcdefgh',
          channel: 'wechat',
          linkedAt: DateTime.utc(2026, 11, 24),
        ),
      );

  group('绑定状态', () {
    test('未绑定时是 unlinked，且 account 明确要求先绑定', () async {
      final _Recorder recorder = _Recorder(<String, String>{});
      final EcardDirectCampusCardRepository repo = build(recorder);

      final Result<CampusCardLink> link = await repo.linkStatus();
      expect(link.unwrap.state, CampusCardLinkState.unlinked);

      final Result<CampusCardAccount> account = await repo.account();
      expect(account.isErr, isTrue);
      expect(account.errorOrNull!.code, ApiErrorCode.campusBindingRequired);
      // 没有绑定就不该发任何请求。
      expect(recorder.calls, isEmpty);
    });

    test('绑定后 openId 只以末 4 位出现在返回值里', () async {
      final EcardDirectCampusCardRepository repo =
          build(_Recorder(<String, String>{}), store: boundStore());

      final Result<CampusCardLink> link = await repo.linkStatus();
      final CampusCardLink value = link.unwrap;
      expect(value.state, CampusCardLinkState.linked);
      expect(value.channel, 'wechat');
      expect(value.openIdTail, '****efgh');
      expect(value.toString(), isNot(contains('openid-')));
    });

    test('connectWithBinding 落盘，connect 空值被拒', () async {
      final InMemoryEcardLinkStore store = InMemoryEcardLinkStore();
      final EcardDirectCampusCardRepository repo =
          build(_Recorder(<String, String>{}), store: store);

      await repo.connectWithBinding(
        const EcardBindResult(openId: 'oid-1234', userType: 'wechat'),
      );
      expect((await store.read())!.openId, 'oid-1234');
      expect((await store.read())!.channel, 'wechat');

      final Result<CampusCardLink> empty =
          await repo.connect(openId: '   ');
      expect(empty.isErr, isTrue);
      expect(empty.errorOrNull!.code, ApiErrorCode.validationFailed);
    });

    test('disconnect 清空存储', () async {
      final InMemoryEcardLinkStore store = boundStore();
      final EcardDirectCampusCardRepository repo =
          build(_Recorder(<String, String>{}), store: store);
      await repo.disconnect();
      expect(await store.read(), isNull);
    });
  });

  group('账户', () {
    test('cardbal 按元解析为分，卡号脱敏', () async {
      final _Recorder recorder = _Recorder(<String, String>{
        '/myaccount/openMyAccountApp':
            '{"code":0,"data":{"cardinfo":{"idserial":"2026233153","username":"唐志昊","cardbal":"12.34"}}}',
      });
      final EcardDirectCampusCardRepository repo =
          build(recorder, store: boundStore());

      final CampusCardAccount account = (await repo.account()).unwrap;
      expect(account.balanceFen, 1234);
      expect(account.holderName, '唐志昊');
      expect(account.cardNumberMasked, '**** **** **** 3153');
      expect(account.cardNumberMasked, isNot(contains('2026')));

      expect(recorder.calls.single, 'POST /myaccount/openMyAccountApp');
      expect(recorder.headers.single['session-type'], 'uniapp');
      expect(recorder.headers.single['cookie'], 'SESSION=abc');
    });

    test('整数余额也按元处理', () async {
      final _Recorder recorder = _Recorder(<String, String>{
        '/myaccount/openMyAccountApp':
            '{"data":{"cardinfo":{"idserial":"1","cardbal":"100"}}}',
      });
      final CampusCardAccount account =
          (await build(recorder, store: boundStore()).account()).unwrap;
      expect(account.balanceFen, 10000);
    });

    test('负余额保留符号', () async {
      final _Recorder recorder = _Recorder(<String, String>{
        '/myaccount/openMyAccountApp':
            '{"data":{"cardinfo":{"idserial":"1","cardbal":"-0.05"}}}',
      });
      final CampusCardAccount account =
          (await build(recorder, store: boundStore()).account()).unwrap;
      expect(account.balanceFen, -5);
    });

    test('没有 cardinfo 说明卡未开通', () async {
      final _Recorder recorder = _Recorder(<String, String>{
        '/myaccount/openMyAccountApp': '{"code":0,"data":{"userInfo":{}}}',
      });
      final Result<CampusCardAccount> account =
          await build(recorder, store: boundStore()).account();
      expect(account.isErr, isTrue);
      expect(account.errorOrNull!.message, contains('尚未开通'));
    });

    test('精度不足一分直接报错，不四舍五入', () async {
      final _Recorder recorder = _Recorder(<String, String>{
        '/myaccount/openMyAccountApp':
            '{"data":{"cardinfo":{"idserial":"1","cardbal":"1.234"}}}',
      });
      final Result<CampusCardAccount> account =
          await build(recorder, store: boundStore()).account();
      expect(account.isErr, isTrue);
    });
  });

  group('流水', () {
    String page(String rows, {int currentPage = 0, int totalPage = 1}) =>
        '{"data":{"resultData":{"rows":$rows,"currentPage":$currentPage,"totalPage":$totalPage}}}';

    test('解析方向、金额与排序，endDate 加一天', () async {
      final _Recorder recorder = _Recorder(<String, String>{
        '/selftrade/queryCardSelfTradeList': page(
          '[{"journo":"A1","txname":"食堂消费","txamt":"-8.50","txtype":"1","txdate":"2026-11-20 12:01:00","mername":"一食堂"},'
          '{"journo":"A2","txname":"充值","txamt":"100.00","txtype":"2","txdate":"2026-11-21 09:00:00"}]',
        ),
      });

      final Page<CampusCardTransaction> result =
          (await build(recorder, store: boundStore())
                  .listTransactions())
              .unwrap;

      expect(result.items.length, 2);
      // 新的在前。
      expect(result.items.first.id, 'A2');
      expect(result.items.first.direction, CampusCardTransactionDirection.credit);
      expect(result.items.first.amountFen, 10000);
      expect(result.items.last.direction, CampusCardTransactionDirection.debit);
      expect(result.items.last.amountFen, 850);
      expect(result.items.last.merchant, '一食堂');
      expect(result.items.last.signedAmountFen, -850);
      expect(result.nextCursor, isNull);
    });

    test('无业务主键时生成稳定 id（两次解析一致）', () async {
      final String rows =
          '[{"txname":"打印","txamt":"-1.00","txdate":"2026-11-19 10:00:00"}]';
      final _Recorder recorder = _Recorder(<String, String>{
        '/selftrade/queryCardSelfTradeList': page(rows),
      });
      final EcardDirectCampusCardRepository repo =
          build(recorder, store: boundStore());

      final String first = (await repo.listTransactions()).unwrap.items.single.id;
      final String second = (await repo.listTransactions()).unwrap.items.single.id;
      expect(first, second);
      expect(first, startsWith('row-'));
    });

    test('有下一页时给出游标', () async {
      final _Recorder recorder = _Recorder(<String, String>{
        '/selftrade/queryCardSelfTradeList': page(
          '[{"journo":"A1","txamt":"-1.00","txdate":"2026-11-19 10:00:00"}]',
          currentPage: 0,
          totalPage: 3,
        ),
      });
      final Page<CampusCardTransaction> result =
          (await build(recorder, store: boundStore())
                  .listTransactions(limit: 1))
              .unwrap;
      expect(result.nextCursor, '1');
      expect(result.hasMore, isTrue);
    });

    test('空页返回空列表而不是错误', () async {
      final _Recorder recorder = _Recorder(<String, String>{
        '/selftrade/queryCardSelfTradeList': page('[]'),
      });
      final Page<CampusCardTransaction> result =
          (await build(recorder, store: boundStore())
                  .listTransactions())
              .unwrap;
      expect(result.items, isEmpty);
    });
  });

  group('付款码', () {
    test('优先 qrcode，回退 code', () async {
      final _Recorder recorder = _Recorder(<String, String>{
        '/offlineCode/openVirtualcard':
            '{"data":{"code":"123456","qrcode":"https://qr/x"}}',
      });
      final CampusPaymentCode code =
          (await build(recorder, store: boundStore()).paymentCode()).unwrap;
      expect(code.code, 'https://qr/x');
      expect(code.toString(), isNot(contains('qr/x')));
      expect(code.expiresAt.isAfter(DateTime.now().toUtc()), isTrue);
    });

    test('qrcode 为空时用 code', () async {
      final _Recorder recorder = _Recorder(<String, String>{
        '/offlineCode/openVirtualcard': '{"data":{"code":"998877"}}',
      });
      final CampusPaymentCode code =
          (await build(recorder, store: boundStore()).paymentCode()).unwrap;
      expect(code.code, '998877');
    });

    test('两者都空时报错', () async {
      final _Recorder recorder = _Recorder(<String, String>{
        '/offlineCode/openVirtualcard': '{"data":{}}',
      });
      final Result<CampusPaymentCode> code =
          await build(recorder, store: boundStore()).paymentCode();
      expect(code.isErr, isTrue);
      expect(code.errorOrNull!.code, ApiErrorCode.upstreamUnavailable);
    });
  });

  group('会话失效', () {
    test('401 收敛成 unauthenticated', () async {
      final EcardDirectCampusCardRepository repo =
          EcardDirectCampusCardRepository(
        clientFactory: (String openId, String? cookie) => EcardApiClient(
          transport: ({
            required String method,
            required Uri uri,
            required String body,
            required Map<String, String> headers,
          }) async =>
              const CampusHttpResponse(
            statusCode: 401,
            body: '{}',
            headers: <String, List<String>>{},
          ),
          openId: openId,
        ),
        linkStore: boundStore(),
        cookieReader: (String host) async => null,
        host: 'ecard.shanghaitech.edu.cn',
      );

      final Result<CampusCardAccount> account = await repo.account();
      expect(account.isErr, isTrue);
      expect(account.errorOrNull!.code, ApiErrorCode.unauthenticated);
      expect(account.errorOrNull!.message, contains('失效'));
    });

    test('非 JSON 返回被视为上游异常而不是崩溃', () async {
      final _Recorder recorder = _Recorder(<String, String>{
        '/myaccount/openMyAccountApp': '<html>maintenance</html>',
      });
      final Result<CampusCardAccount> account =
          await build(recorder, store: boundStore()).account();
      expect(account.isErr, isTrue);
      expect(account.errorOrNull!.code, ApiErrorCode.upstreamUnavailable);
    });
  });
}

/// 一次请求的记录 + 按 path 预置响应。
///
/// 放在文件级：Dart 不允许在函数体内声明类。
final class _Recorder {
  _Recorder(this.responses);

  final Map<String, String> responses;
  final List<String> calls = <String>[];
  final List<Map<String, String>> headers = <Map<String, String>>[];

  Future<CampusHttpResponse> call({
    required String method,
    required Uri uri,
    required String body,
    required Map<String, String> headers,
  }) async {
    calls.add('$method ${uri.path}');
    this.headers.add(headers);
    final String? payload = responses[uri.path];
    if (payload == null) {
      return const CampusHttpResponse(
        statusCode: 404,
        body: '{}',
        headers: <String, List<String>>{},
      );
    }
    return CampusHttpResponse(
      statusCode: 200,
      body: payload,
      headers: const <String, List<String>>{},
    );
  }
}

import 'dart:convert';

import '../../domain/models/api_error.dart';
import '../../domain/models/api_request.dart';
import '../../domain/models/campus_card.dart';
import '../../domain/models/page.dart';
import '../../domain/models/result.dart';
import '../../domain/ports/campus_card_port.dart';
import '../campus/ecard_api_client.dart';
import '../campus/ecard_bind_client.dart';
import '../campus/ecard_link_store.dart';

/// [CampusCardPort] 的**客户端直连**实现（架构 A）。
///
/// 与 [RemoteCampusCardRepository] 的区别：那条走我们自己的 `/api/v1/campus-card/*`，
/// 需要服务端代持 OPENID；这条按 TechPie 的方式由**客户端自己**持 OPENID 并直连
/// `ecard.shanghaitech.edu.cn`，因此不依赖任何服务端部署。
///
/// 协议要点（读 TechPie 源码核实）：
///
/// | 项目 | 事实 |
/// | --- | --- |
/// | 账户 | `POST /myaccount/openMyAccountApp`，body 为空，结果在 `data.cardinfo` |
/// | 余额 | `cardbal`，**元**（字符串），可能带小数 |
/// | 卡号 | `idserial`（完整卡号），展示必须脱敏 |
/// | 流水 | `GET /selftrade/queryCardSelfTradeList`，`endDate` 是**开区间**，要加一天 |
/// | 流水金额 | `txamt`：带小数点按元解析，否则按分 |
/// | 流水主键 | `journo` → `id` → `serialno` → `tradeno`，都没有则取整行 JSON 的 sha256 |
/// | 付款码 | `POST /offlineCode/openVirtualcard`（`usertype=8, appcode=1`），取 `data.qrcode`，回退 `data.code` |
///
/// 这里所有失败都收敛成 [Result]，不向上抛——UI 只需要认识 [ApiError]。
final class EcardDirectCampusCardRepository implements CampusCardPort {
  EcardDirectCampusCardRepository({
    required EcardApiClient Function(String openId, String? cookieHeader)
        clientFactory,
    required EcardLinkStore linkStore,
    required Future<String?> Function(String host) cookieReader,
    required String host,
  })  : _clientFactory = clientFactory,
        _linkStore = linkStore,
        _cookieReader = cookieReader,
        _host = host;

  /// 便捷构造：给定固定 cookie 与传输函数，直接从换码结果出发。
  static EcardDirectCampusCardRepository fromBinding({
    required EcardBindResult binding,
    required EcardLinkStore linkStore,
    required String cookieHeader,
    required EcardTransport transport,
    String baseUrl = 'https://ecard.shanghaitech.edu.cn',
  }) =>
      EcardDirectCampusCardRepository(
        clientFactory: (String openId, String? cookie) => EcardApiClient(
          transport: transport,
          openId: openId,
          baseUrl: baseUrl,
          cookieHeader: cookie,
        ),
        linkStore: linkStore,
        cookieReader: (String host) async => cookieHeader,
        host: Uri.parse(baseUrl).host,
      );

  final EcardApiClient Function(String openId, String? cookieHeader)
      _clientFactory;
  final EcardLinkStore _linkStore;
  final Future<String?> Function(String host) _cookieReader;
  final String _host;

  @override
  Future<Result<CampusCardLink>> linkStatus() async {
    final EcardLink? link = await _linkStore.read();
    if (link == null) {
      return const Ok<CampusCardLink>(
        CampusCardLink(state: CampusCardLinkState.unlinked),
      );
    }
    return Ok<CampusCardLink>(
      CampusCardLink(
        state: CampusCardLinkState.linked,
        channel: link.channel,
        openIdTail: CampusCardLink.tailOf(link.openId),
        linkedAt: link.linkedAt,
      ),
    );
  }

  /// 直接把换码结果落盘；[openId] 只进加密存储，不出现在任何返回值里。
  Future<Result<CampusCardLink>> connectWithBinding(
    EcardBindResult binding,
  ) async {
    final EcardLink link = EcardLink(
      openId: binding.openId,
      channel: binding.channel,
      orgId: binding.orgId,
      linkedAt: DateTime.now().toUtc(),
    );
    await _linkStore.write(link);
    return Ok<CampusCardLink>(
      CampusCardLink(
        state: CampusCardLinkState.linked,
        channel: link.channel,
        openIdTail: CampusCardLink.tailOf(link.openId),
        linkedAt: link.linkedAt,
      ),
    );
  }

  @override
  Future<Result<CampusCardLink>> connect({
    required String openId,
    String channel = 'wechat',
  }) async {
    final String trimmed = openId.trim();
    if (trimmed.isEmpty) {
      return _fail<CampusCardLink>(
        ApiErrorCode.validationFailed,
        '绑定信息不完整，请重新获取绑定码',
      );
    }
    final EcardLink link = EcardLink(
      openId: trimmed,
      channel: channel,
      linkedAt: DateTime.now().toUtc(),
    );
    await _linkStore.write(link);
    return Ok<CampusCardLink>(
      CampusCardLink(
        state: CampusCardLinkState.linked,
        channel: link.channel,
        openIdTail: CampusCardLink.tailOf(link.openId),
        linkedAt: link.linkedAt,
      ),
    );
  }

  @override
  Future<Result<Unit>> disconnect() async {
    await _linkStore.clear();
    return const Ok<Unit>(Unit.instance);
  }

  @override
  Future<Result<CampusCardAccount>> account() => _withClient(
        (EcardApiClient client) async {
          final Map<String, dynamic> root = _requireMap(
            await client.post('/myaccount/openMyAccountApp', <String, Object?>{}),
            what: '账户',
          );
          final Map<String, dynamic> data = _unwrapData(root);
          final Object? cardInfo = data['cardinfo'];
          if (cardInfo is! Map) {
            throw const EcardException('校园卡尚未开通，请先在校园卡小程序中开通');
          }
          final Map<String, dynamic> card =
              cardInfo.map((Object? key, Object? value) => MapEntry('$key', value));

          final String idSerial = '${card['idserial'] ?? ''}'.trim();
          if (idSerial.isEmpty) {
            throw const EcardException('校园卡服务未返回卡号');
          }
          final String owner = '${card['username'] ?? data['username'] ?? ''}'.trim();

          return CampusCardAccount(
            holderName: owner,
            cardNumberMasked: CampusCardAccount.maskCardNumber(idSerial),
            balanceFen: _yuanToFen(card['cardbal'], field: 'cardbal'),
            updatedAt: DateTime.now().toUtc(),
          );
        },
      );

  @override
  Future<Result<Page<CampusCardTransaction>>> listTransactions({
    String? cursor,
    int limit = defaultPageSize,
  }) =>
      _withClient(
        (EcardApiClient client) async {
          final int pageNumber = int.tryParse(cursor ?? '0') ?? 0;
          final int pageSize = limit.clamp(1, 50);
          final DateTime end = DateTime.now();
          final DateTime begin = DateTime(end.year, end.month - 6, end.day);

          final Object? raw = await client.get(
            '/selftrade/queryCardSelfTradeList',
            <String, Object?>{
              'beginDate': _formatDate(begin),
              // 服务端把 endDate 当开区间：多给一天，用户选的末日才完整。
              'endDate': _formatDate(end.add(const Duration(days: 1))),
              'starttime': _formatDate(begin),
              'endtime': _formatDate(end.add(const Duration(days: 1))),
              'tradeType': 0,
              'pageSize': pageSize,
              'pageNumber': pageNumber,
            },
          );

          final Map<String, dynamic> root =
              _unwrapData(_requireMap(raw, what: '流水'));
          final Map<String, dynamic> pageData = root['resultData'] is Map
              ? _stringKeyed(root['resultData'])
              : root['data'] is Map
                  ? _stringKeyed(root['data'])
                  : root;
          final Object? rows = pageData['rows'] ?? pageData['data'];

          final List<CampusCardTransaction> items = <CampusCardTransaction>[];
          if (rows is List) {
            for (final Object? row in rows) {
              if (row is Map) {
                items.add(_toTransaction(_stringKeyed(row)));
              }
            }
          }
          items.sort(
            (CampusCardTransaction a, CampusCardTransaction b) =>
                b.occurredAt.compareTo(a.occurredAt),
          );

          final int currentPage =
              int.tryParse('${pageData['currentPage'] ?? pageData['currentpage'] ?? pageNumber}') ??
                  pageNumber;
          final int? totalPages =
              int.tryParse('${pageData['totalpage'] ?? pageData['totalPage'] ?? ''}');
          final bool hasMore =
              totalPages == null ? items.length >= pageSize : currentPage + 1 < totalPages;

          return Page<CampusCardTransaction>(
            items: items,
            nextCursor: hasMore ? '${currentPage + 1}' : null,
            total: totalPages == null ? null : totalPages * pageSize,
          );
        },
      );

  @override
  Future<Result<CampusPaymentCode>> paymentCode() => _withClient(
        (EcardApiClient client) async {
          final Map<String, dynamic> root = _requireMap(
            await client.post(
              '/offlineCode/openVirtualcard',
              <String, Object?>{'usertype': '8', 'appcode': '1'},
            ),
            what: '付款码',
          );
          final Map<String, dynamic> data = _unwrapData(root);
          final String payCode = '${data['code'] ?? ''}'.trim();
          final String qr = '${data['qrcode'] ?? ''}'.trim();
          final String code = qr.isEmpty ? payCode : qr;
          if (code.isEmpty) {
            throw const EcardException('校园卡服务未返回付款码');
          }
          // 动态付款码的时效由服务端保证；客户端只负责短时展示。
          // 60 秒是校内终端普遍接受的刷卡窗口，超时即刷新。
          return CampusPaymentCode(
            code: code,
            expiresAt: DateTime.now().toUtc().add(const Duration(seconds: 60)),
            refreshAfterSec: 55,
          );
        },
      );

  /// 统一取客户端、统一收敛异常。
  Future<Result<T>> _withClient<T extends Object>(
    Future<T> Function(EcardApiClient client) body,
  ) async {
    final EcardLink? link = await _linkStore.read();
    if (link == null || link.openId.trim().isEmpty) {
      return _fail<T>(
        ApiErrorCode.campusBindingRequired,
        '请先绑定校园卡',
      );
    }
    final String? cookie = await _cookieReader(_host);
    final EcardApiClient client = _clientFactory(link.openId, cookie);
    try {
      return Ok<T>(await body(client));
    } on EcardException catch (error) {
      return Err<T>(
        ApiError(
          code: error.authExpired
              ? ApiErrorCode.unauthenticated
              : ApiErrorCode.upstreamUnavailable,
          message: error.message,
        ),
      );
    } on Object catch (error) {
      return Err<T>(
        ApiError(
          code: ApiErrorCode.upstreamUnavailable,
          message: '校园卡服务暂时不可用：$error',
        ),
      );
    }
  }

  static Err<T> _fail<T>(ApiErrorCode code, String message) =>
      Err<T>(ApiError(code: code, message: message));

  /// 服务端有两种包裹：`{code, data:{...}}` 与直接 `{...}`。
  static Map<String, dynamic> _unwrapData(Map<String, dynamic> root) {
    final Object? data = root['data'];
    if (data is Map) return _stringKeyed(data);
    return root;
  }

  static Map<String, dynamic> _requireMap(Object? raw, {required String what}) {
    if (raw is Map) return _stringKeyed(raw);
    throw EcardException('校园卡$what 返回格式发生变化');
  }

  static Map<String, dynamic> _stringKeyed(Object? value) {
    if (value is! Map) return <String, dynamic>{};
    return value.map(
      (Object? key, Object? item) => MapEntry<String, dynamic>('$key', item),
    );
  }

  /// 元 → 分。带小数按元解析；纯整数也按元（`cardbal` 是元）。
  static int _yuanToFen(Object? raw, {required String field}) {
    final String source = '$raw'.trim();
    if (source.isEmpty) {
      throw EcardException('校园卡服务未返回 $field');
    }
    final RegExpMatch? match =
        RegExp(r'^(-?)(\d+)(?:\.(\d+))?$').firstMatch(source);
    if (match == null) {
      throw EcardException('校园卡 $field 格式异常');
    }
    final String fraction = match.group(3) ?? '';
    // 少于一分（如 `1.234`）不静默截断：余额被悄悄抹掉 4 厘，比报错更糟。
    if (fraction.length > 2 &&
        fraction.substring(2).contains(RegExp('[1-9]'))) {
      throw EcardException('校园卡 $field 精度不足一分');
    }
    final String padded = '${fraction}00'.substring(0, 2);
    final int absolute =
        int.parse(match.group(2)!) * 100 + int.parse(padded);
    return match.group(1) == '-' ? -absolute : absolute;
  }

  /// 流水金额：带小数点按元，否则按分。
  static int _amountToFen(Object? raw) {
    final String source = '$raw'.trim();
    if (source.isEmpty) return 0;
    return source.contains('.') ? _yuanToFen(source, field: 'txamt') : (int.tryParse(source) ?? 0);
  }

  static CampusCardTransaction _toTransaction(Map<String, dynamic> row) {
    final String id = _firstText(row, const <String>[
          'journo',
          'id',
          'serialno',
          'tradeno',
          'orderid',
        ]) ??
        _stableId(row);

    final String title = _firstText(row, const <String>[
          'txname',
          'tradename',
          'merchantname',
          'mername',
          'summary',
        ]) ??
        '校园卡交易';

    final int rawAmountFen = _amountToFen(row['txamt'] ?? row['amount'] ?? row['tradeamt']);
    final String type = _firstText(row, const <String>[
          'txtype',
          'tradetype',
          'txcode',
          'type',
        ]) ??
        '';

    // 方向判定顺序与 TechPie 一致：先看类型码，再看金额符号，最后看文案。
    final CampusCardTransactionDirection direction;
    final bool negative = rawAmountFen < 0;
    if (type == '2' || type == '3') {
      direction = CampusCardTransactionDirection.credit;
    } else if (type == '1') {
      direction = CampusCardTransactionDirection.debit;
    } else if (negative) {
      direction = CampusCardTransactionDirection.debit;
    } else {
      final String hint = '$title ${row['mername'] ?? ''} ${row['summary'] ?? ''}';
      direction = (hint.contains('充值') ||
              hint.contains('入账') ||
              hint.contains('补贴') ||
              hint.contains('补助') ||
              hint.contains('退款'))
          ? CampusCardTransactionDirection.credit
          : CampusCardTransactionDirection.debit;
    }

    final String? rawDate = _firstText(row, const <String>[
      'txdate',
      'tradetime',
      'paytime',
      'txdatetime',
      'occurtime',
    ]);

    return CampusCardTransaction(
      id: id,
      merchant: _firstText(row, const <String>[
            'mername',
            'merchantname',
            'merchant',
          ]) ??
          title,
      amountFen: rawAmountFen.abs(),
      direction: direction,
      occurredAt: _parseDate(rawDate) ??
          DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
      balanceAfterFen: (row['balance'] ?? row['cardbal'] ?? row['afterbalance']) == null
          ? null
          : _amountToFen(row['balance'] ?? row['cardbal'] ?? row['afterbalance']),
    );
  }

  /// 没有业务主键时用整行规范化 JSON 的稳定摘要做 id：
  /// 同一行每次解析得到同一个 id，翻页重复拉取也不会出现两条一样的流水。
  ///
  /// 用 FNV-1a 64 位而不是 `Object.hash`：后者带进程级随机种子，重启就变。
  static String _stableId(Map<String, dynamic> row) {
    final List<String> keys = row.keys.toList()..sort();
    final String canonical = jsonEncode(<String, Object?>{
      for (final String key in keys) key: row[key],
    });
    int hash = 0xcbf29ce484222325;
    for (final int byte in utf8.encode(canonical)) {
      hash ^= byte;
      hash = (hash * 0x100000001b3) & 0xFFFFFFFFFFFFFFFF;
    }
    return 'row-${hash.toRadixString(16).padLeft(16, '0')}';
  }

  static String? _firstText(Map<String, dynamic> row, List<String> keys) {
    for (final String key in keys) {
      final String value = '${row[key] ?? ''}'.trim();
      if (value.isNotEmpty && value != '-' && value != '--') return value;
    }
    return null;
  }

  static DateTime? _parseDate(String? value) {
    if (value == null) return null;
    final int? epoch = int.tryParse(value);
    if (epoch != null) {
      final int millis = epoch < 100000000000 ? epoch * 1000 : epoch;
      try {
        return DateTime.fromMillisecondsSinceEpoch(millis, isUtc: true);
      } on ArgumentError {
        return null;
      }
    }
    return DateTime.tryParse(value.replaceFirst(' ', 'T'))?.toUtc();
  }

  static String _formatDate(DateTime date) {
    final String month = date.month.toString().padLeft(2, '0');
    final String day = date.day.toString().padLeft(2, '0');
    return '${date.year}-$month-$day';
  }
}

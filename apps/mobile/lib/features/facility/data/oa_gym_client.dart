import 'dart:convert';

import '../../campus_web/domain/campus_bridge_protocol.dart';

/// OA 体育馆查询（只读）。
///
/// 端点与参数来自 TechPie 的 `oa_gym_local_client.dart`（GeekPie，经允许复用）；
/// 请求全部在内嵌 OA 页面里发出，cookie 由浏览器自动携带。
final class OaGymException implements Exception {
  const OaGymException(this.message, {this.sessionExpired = false});

  final String message;
  final bool sessionExpired;

  @override
  String toString() => message;
}

/// 可预约的四类场地。
enum OaSport {
  badminton('badminton', '羽毛球', '4', '室内羽毛球场', '羽毛球场地', 6),
  pingpong('pingpong', '乒乓球', '5', '室内乒乓球场', '乒乓球场', 6),
  tennis('tennis', '网球', '6', '网球场', '网球场', 3),
  pickleball('pickleball', '匹克球', '11', '匹克球场', '匹克球', 1);

  const OaSport(
    this.id,
    this.label,
    this.field32340,
    this.parentName,
    this.courtNamePrefix,
    this.courtCount,
  );

  final String id;
  final String label;
  final String field32340;
  final String parentName;
  final String courtNamePrefix;
  final int courtCount;
}

/// 某个场馆某个时段的空闲场地。
final class OaAvailability {
  const OaAvailability({
    required this.sport,
    required this.date,
    required this.timeSlot,
    required this.availableCourts,
    required this.totalCourts,
  });

  final OaSport sport;
  final String date;
  final int timeSlot;
  final List<int> availableCourts;
  final int totalCourts;

  bool get hasFree => availableCourts.isNotEmpty;
}

/// 请求函数由页面提供（与 ELRC 共用 `CampusBridgeRequest`）。
typedef CampusRequester = Future<CampusBridgeResponse> Function(
  CampusBridgeRequest request,
);

final class OaGymClient {
  OaGymClient(this._requester);

  static const String origin = 'https://oa.shanghaitech.edu.cn';
  static const String _treePath =
      '/formmode/tree/treebrowser/CustomTreeBrowserAjax.jsp';

  final CampusRequester _requester;
  int _sequence = 0;

  Future<List<OaAvailability>> availability({
    required String date,
    List<OaSport> sports = OaSport.values,
    int startSlot = 1,
    int endSlot = 11,
  }) async {
    if (date.length != 10 || !date.contains('-')) {
      throw const OaGymException('日期格式应为 YYYY-MM-DD');
    }
    if (startSlot < 1 || endSlot < startSlot || endSlot > 11) {
      throw const OaGymException('时段范围应在 1–11 之间');
    }

    final List<OaAvailability> result = <OaAvailability>[];
    for (final OaSport sport in sports) {
      for (int slot = startSlot; slot <= endSlot; slot++) {
        final List<Map<String, dynamic>> parents =
            await _tree('63_1', '体育馆', date: date, slot: slot, sport: sport);
        Map<String, dynamic>? parent;
        for (final Map<String, dynamic> item in parents) {
          if (item['name'] == sport.parentName) {
            parent = item;
            break;
          }
        }
        final Set<int> numbers = <int>{};
        if (parent != null && parent['isParent'].toString() != 'false') {
          final List<Map<String, dynamic>> children = await _tree(
            parent['id'].toString(),
            sport.parentName,
            date: date,
            slot: slot,
            sport: sport,
          );
          for (final Map<String, dynamic> item in children) {
            final String name = (item['name'] as String?) ?? '';
            if (!name.startsWith(sport.courtNamePrefix)) continue;
            final RegExpMatch? match = RegExp(r'\d+').firstMatch(name);
            final int? number = int.tryParse(match?.group(0) ?? '');
            if (number != null && number >= 1 && number <= sport.courtCount) {
              numbers.add(number);
            }
          }
        }
        result.add(OaAvailability(
          sport: sport,
          date: date,
          timeSlot: slot,
          availableCourts: numbers.toList()..sort(),
          totalCourts: sport.courtCount,
        ));
      }
    }
    return List<OaAvailability>.unmodifiable(result);
  }

  Future<List<Map<String, dynamic>>> _tree(
    String pid,
    String name, {
    required String date,
    required int slot,
    required OaSport sport,
  }) async {
    final Uri uri = Uri.https('oa.shanghaitech.edu.cn', _treePath, <String, String>{
      'id': '63',
      'init': 'false',
      'showtype': '1',
      'isselsub': '0',
      'isonlyleaf': '1',
      'dataconditionParam':
          '_sfn_31901_sfv_${date}_sfn_31902_sfv_${slot}_sfn_32340_sfv_${sport.field32340}',
      'treerootnode': '',
      'selectedids': '',
      'time': '${DateTime.now().millisecondsSinceEpoch}',
    });

    final CampusBridgeResponse response = await _requester(
      CampusBridgeRequest(
        id: 'oa-${_sequence++}',
        url: uri.toString(),
        method: 'POST',
        form: <String, String>{'pid': pid, 'name': name},
      ),
    );

    final String body = response.body.replaceFirst('\uFEFF', '');
    if (response.status == 401 || body.trimLeft().startsWith('<')) {
      throw const OaGymException('OA 登录已失效', sessionExpired: true);
    }
    if (response.status != 200) {
      throw OaGymException('OA 请求失败（${response.status}）');
    }

    final Object? decoded;
    try {
      decoded = jsonDecode(body);
    } on FormatException {
      throw const OaGymException('OA 返回格式发生变化');
    }
    if (decoded is! List<dynamic>) {
      throw const OaGymException('OA 返回格式发生变化');
    }
    return decoded
        .whereType<Map<String, dynamic>>()
        .toList(growable: false);
  }
}

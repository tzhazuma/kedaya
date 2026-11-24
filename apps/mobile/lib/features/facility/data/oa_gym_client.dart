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

/// 预约提交结果（不重试、不假装成功）。
final class OaBookingResult {
  const OaBookingResult({required this.success, required this.message});

  final bool success;
  final String message;
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

  /// 读当前登录的 OA 用户 id（`loginidweaver`）。
  ///
  /// HttpOnly cookie 在 Dart 侧不可读，所以这里在**页面内**取值：
  /// 先看 `WfForm` 全局，再看 DOM 隐藏域，最后才尝试 `document.cookie`
  /// （HttpOnly 时最后一项拿不到，属正常）。
  Future<String> currentUserId() async {
    final CampusBridgeResponse response = await _requester(
      CampusBridgeRequest(
        id: 'oa-${_sequence++}',
        url: 'about:blank',
        expr: "(window.WfForm && window.WfForm.loginidweaver) || "
            "(document.querySelector('#loginidweaver') || {}).value || "
            "((document.cookie.match(/loginidweaver=([^;]+)/) || [])[1] || '')",
      ),
    );
    if (!response.isOk) {
      throw OaGymException(
        '无法确认 OA 当前用户：${response.error ?? '页面未就绪'}',
        sessionExpired: true,
      );
    }
    final String userId = response.body.trim();
    if (userId.isEmpty) {
      throw const OaGymException('无法确认 OA 当前用户，请刷新登录态后重试',
          sessionExpired: true);
    }
    return userId;
  }

  /// 提交场馆借用申请（OA 工作流 `workflowid=14862`）。
  ///
  /// 注意：提交超时**不重试**——OA 表单没有幂等键，重复提交会产生两条申请。
  /// 调用方应在超时后让用户去 OA「我的请求」里确认。
  Future<OaBookingResult> book({
    required OaSport sport,
    required String date,
    required int timeSlot,
    required int courtNumber,
    required int playersCount,
    required String userName,
    required String studentId,
    required String phone,
    String email = '',
  }) async {
    if (courtNumber < 1 || courtNumber > sport.courtCount) {
      throw const OaGymException('场地编号超出范围');
    }
    if (playersCount < 1 || playersCount > 10) {
      throw const OaGymException('使用人数应在 1–10 之间');
    }
    final String userId = await currentUserId();

    // 与 TechPie 相同的固定提交参数；courtOffset 按运动区分。
    const Map<OaSport, int> courtOffsets = <OaSport, int>{
      OaSport.badminton: 12,
      OaSport.pingpong: 18,
      OaSport.tennis: 24,
      OaSport.pickleball: 42,
    };
    final int court = (courtOffsets[sport] ?? 12) + courtNumber;
    final int startHour = 10 + timeSlot;
    String two(int v) => v.toString().padLeft(2, '0');
    final String slotStart = '${two(startHour)}:00';
    final String slotEnd = '${two(startHour + 1)}:00';
    final String today = DateTime.now()
        .toUtc()
        .add(const Duration(hours: 8))
        .toIso8601String()
        .substring(0, 10);
    final int timestamp = DateTime.now().millisecondsSinceEpoch;

    final Map<String, String> fields = <String, String>{
      'requestname': '学生和教工场馆借用申请-$userName-$today',
      'field31876': userId,
      'field31877': '885',
      'field34283': studentId,
      'field31879': phone,
      'field31880': email,
      'field32340': sport.field32340,
      'field31901': date,
      'field31902': '$timeSlot',
      'field31883': '63_$court',
      'field31884': '$playersCount',
      'field31885': '0',
      'field31888': userName,
      'field31889': phone,
      'field31892': '1',
      'field31904': slotStart,
      'field31905': slotEnd,
      'field31878': today,
      'mainId': '41',
      'subId': '11482',
      'secId': '11483',
      'workflowid': '14862',
      'workflowtype': '61',
      'nodeid': '16385',
      'nodetype': '0',
      'src': 'submit',
      'iscreate': '1',
      'formid': '-248',
      'isbill': '1',
      'needcheck': ',requestname,field31883,field31884,field31885,'
          'field31888,field31889,field31892,field31901,field31902,field32340,,,,',
      'requestid': '-1',
      'rand': '$timestamp',
      'needwfback': '1',
      'f_weaver_belongto_userid': 'null',
      'f_weaver_belongto_usertype': 'null',
      '${userId}_14862_addrequest_submit_token': '${timestamp + 1}',
      'freeNode': '0',
      'freeDuty': '1',
    };

    final CampusBridgeResponse response = await _requester(
      CampusBridgeRequest(
        id: 'oa-${_sequence++}',
        url: 'https://oa.shanghaitech.edu.cn/workflow/request/RequestOperation.jsp',
        method: 'POST',
        form: fields,
      ),
    );

    if (response.status == 0) {
      throw OaGymException(
        '提交中断：${response.error ?? '未知原因'}。请先到 OA 查看是否已生成申请，避免重复提交',
      );
    }
    final bool success = response.body.contains("wfforward('/workflow/request/WorkflowDirection.jsp?");
    return OaBookingResult(
      success: success,
      message: success
          ? '${sport.label} $courtNumber 号 $date $slotStart–$slotEnd 预约成功'
          : '提交未确认成功，请到 OA「我的请求」核对后再重试',
    );
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

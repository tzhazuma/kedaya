import 'dart:convert';

import '../../campus_web/domain/campus_bridge_protocol.dart';
import '../domain/elrc_models.dart';

/// 把 `CampusBridgeRequest` 发到内嵌页面的函数（由页面提供）。
typedef CampusRequester = Future<CampusBridgeResponse> Function(
  CampusBridgeRequest request,
);

/// ELRC 录播客户端：所有请求都在内嵌页面里以同源 fetch 发出。
///
/// 为什么不在 Dart 里直接 HTTP：ELRC 的会话是 HttpOnly cookie，只有页面内
/// fetch 会自动携带；Dart 侧既读不到也不该读。
final class ElrcClient {
  ElrcClient(this._requester);

  static const String origin = 'https://elrc.shanghaitech.edu.cn';
  static const String _courseList = '/learn/v1/course/video/review/1';
  static const String _courseInfo = '/learn/v1/course/recording/video/info';

  final CampusRequester _requester;
  int _sequence = 0;

  Future<List<ElrcCourse>> courses() async {
    final Map<String, ElrcCourse> result = <String, ElrcCourse>{};
    for (int page = 1; page <= 400; page++) {
      final Map<String, dynamic> data = _object(
        await _get(
          _courseList,
          kind: _EnvelopeKind.status,
          query: <String, String>{
            'type': '1',
            'page': '$page',
            'size': '50',
            'courseTime': '1',
            'playType': '0',
            'orderBy': 'course_name',
          },
        ),
      );
      final Object? total = data['total'];
      final Object? size = data['size'];
      if (data['page'] != page || total is! int || total < 0 || size is! int || size < 1) {
        throw const ElrcException('课程列表格式发生变化');
      }

      final int before = result.length;
      for (final Object? value in _items(data['results'])) {
        final Map<String, dynamic> row = _object(value);
        final ElrcCourse course = ElrcCourse(
          _requiredText(row['courseName']),
          _requiredText(row['courseId']),
          reviewId: _optional(row['id']),
          courseNo: _optional(row['courseNumber']),
          schoolYear: _optional(row['schoolYear']),
          semester: _optional(row['semester']),
          description: <String?>[
            _optional(row['courseNumber']),
            _optional(row['serialNumber']),
            _optional(row['showSemester']),
          ].whereType<String>().where((String p) => p.isNotEmpty).join(' · '),
        );
        result.putIfAbsent(course.referer.toString(), () => course);
      }
      if (page * size >= total) return List<ElrcCourse>.unmodifiable(result.values);
      if (result.length == before) {
        throw const ElrcException('课程列表分页异常');
      }
    }
    throw const ElrcException('课程列表分页异常');
  }

  Future<List<ElrcLesson>> lessons(ElrcCourse course) async {
    final Map<String, dynamic> data = _object(
      await _get(
        _courseInfo,
        kind: _EnvelopeKind.status,
        query: <String, String>{
          'courseId': course.courseId,
          if (course.reviewId != null) 'id': course.reviewId!,
          if (course.schoolYear != null) 'schoolYear': course.schoolYear!,
          if (course.semester != null) 'semester': course.semester!,
        },
      ),
    );
    if (_requiredText(data['courseId']) != course.courseId) {
      throw const ElrcException('返回的课程与所选课程不一致');
    }

    final Map<String, ElrcLesson> result = <String, ElrcLesson>{};
    for (final Object? weekValue in _items(data['recordingVideoInfoShows'])) {
      final Map<String, dynamic> week = _object(weekValue);
      for (final Object? detailValue in _items(week['recordInfoDetailList'])) {
        final Map<String, dynamic> detail = _object(detailValue);
        final Map<String, dynamic> live = detail['courseLiveInfo'] == null
            ? <String, dynamic>{}
            : _object(detail['courseLiveInfo']);
        final String nestedCourseId = _text(live['courseId']);
        if (nestedCourseId.isNotEmpty && nestedCourseId != course.courseId) {
          throw const ElrcException('课次与所选课程不一致');
        }

        final Set<String> schedules = <String>{};
        final String liveSchedule = _text(live['scheduleId']);
        if (liveSchedule.isNotEmpty) schedules.add(liveSchedule);
        for (final Object? value in _items(detail['videoInfoList'])) {
          final String scheduleId = _text(_object(value)['scheduleId']);
          if (scheduleId.isNotEmpty) schedules.add(scheduleId);
        }

        final ElrcLesson lesson = ElrcLesson(
          courseId: nestedCourseId.isEmpty ? course.courseId : nestedCourseId,
          courseNo: _first(<Object?>[
            live['courseNo'],
            detail['courseNo'],
            detail['course_number'],
            detail['courseNumber'],
            data['courseNo'],
            data['course_number'],
            data['courseNumber'],
            course.courseNo,
          ]),
          week: _text(week['week']),
          weekDay: _text(detail['weekDay']),
          weekDate: _text(detail['weekDate']),
          section: _text(detail['section']),
          scheduleIds: schedules.toList(),
        );
        if (lesson.courseNo.isEmpty ||
            lesson.week.isEmpty ||
            lesson.weekDay.isEmpty ||
            lesson.section.isEmpty ||
            lesson.scheduleIds.isEmpty) {
          continue;
        }
        result[jsonEncode(<Object?>[
          lesson.courseId,
          lesson.courseNo,
          lesson.week,
          lesson.weekDay,
          lesson.section,
          lesson.scheduleIds,
        ])] = lesson;
      }
    }
    if (result.isEmpty) throw const ElrcException('这门课程暂无录播课次');
    return List<ElrcLesson>.unmodifiable(result.values);
  }

  Future<Object?> _get(
    String path, {
    required _EnvelopeKind kind,
    Map<String, String>? query,
  }) async {
    final String id = 'elrc-${_sequence++}';
    final Uri uri = Uri.https('elrc.shanghaitech.edu.cn', path, query);
    final CampusBridgeResponse response =
        await _requester(CampusBridgeRequest(id: id, url: uri.toString()));

    final String body = response.body.replaceFirst('\uFEFF', '');
    if (response.status == 401 || body.trimLeft().startsWith('<')) {
      throw const ElrcException('ELRC 登录已失效', needsLogin: true);
    }
    if (response.status == 403) throw const ElrcException('没有访问权限');
    if (response.status == 0 ||
        response.status == 408 ||
        response.status == 429 ||
        response.status >= 500) {
      throw const ElrcException('ELRC 网络连接失败');
    }
    if (response.status < 200 || response.status >= 300) {
      throw ElrcException('ELRC 请求失败（${response.status}）');
    }

    final Object? decoded;
    try {
      decoded = jsonDecode(body);
    } on FormatException {
      throw const ElrcException('ELRC 返回格式发生变化');
    }
    final Map<String, dynamic> envelope = _object(decoded);
    return _readStatusData(envelope);
  }

  Object? _readStatusData(Map<String, dynamic> envelope) {
    final Object? status = envelope['status'];
    if (status != null && status is! num) {
      throw const ElrcException('ELRC 返回格式发生变化');
    }
    if (status is num && status != 0 && status != 200) {
      if (status == 401) {
        throw const ElrcException('ELRC 登录已失效', needsLogin: true);
      }
      if (status == 403) throw const ElrcException('没有访问权限');
      final String message = _text(envelope['message']);
      throw ElrcException(message.isEmpty ? 'ELRC 请求失败' : message);
    }
    if (!envelope.containsKey('data')) {
      throw const ElrcException('ELRC 返回格式发生变化');
    }
    return envelope['data'];
  }

}

enum _EnvelopeKind { status }

Map<String, dynamic> _object(Object? value) {
  if (value is Map<String, dynamic>) return value;
  throw const ElrcException('ELRC 返回格式发生变化');
}

List<dynamic> _items(Object? value) {
  if (value is List<dynamic>) return value;
  throw const ElrcException('ELRC 返回格式发生变化');
}

String _text(Object? value) {
  if (value is String) return value.trim();
  if (value is num) return value.toString();
  return '';
}

String _optional(Object? value) {
  final String text = _text(value);
  return text;
}

String _requiredText(Object? value) {
  final String text = _text(value);
  if (text.isEmpty) throw const ElrcException('ELRC 返回格式发生变化');
  return text;
}

String _first(Iterable<Object?> values) {
  for (final Object? value in values) {
    final String text = _text(value);
    if (text.isNotEmpty) return text;
  }
  return '';
}

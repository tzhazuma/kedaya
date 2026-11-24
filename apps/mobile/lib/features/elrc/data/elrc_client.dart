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
  static const String _videoInfo = '/rman/v1/search/new/relation/videos';
  static const String _fileInfo = '/rman/v1/entity/download/fileinfo';

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
  }) =>
      _request(path, kind: kind, query: query);

  Future<Object?> _postJson(
    String path,
    Object json,
  ) =>
      _request(path, kind: _EnvelopeKind.success, json: json);

  /// 取某次课的可播放机位（rman 的两个 JSON 接口）。
  Future<List<ElrcSource>> sources(ElrcCourse course, ElrcLesson lesson) async {
    if (lesson.courseId != course.courseId) {
      throw const ElrcException('课次与所选课程不一致');
    }

    final Map<String, dynamic> videoPage =
        _object(await _postJson(_videoInfo, lesson.query));
    final Map<String, Map<String, dynamic>> videos =
        <String, Map<String, dynamic>>{};
    for (final Object? value in _items(videoPage['data'])) {
      final Map<String, dynamic> video = _object(value);
      final String contentId = _requiredText(video['contentId_']);
      if (videos.containsKey(contentId)) {
        throw const ElrcException('视频标识重复');
      }
      videos[contentId] = video;
    }
    if (videos.isEmpty) throw const ElrcException('这个课次暂无视频');

    final Map<String, Map<String, dynamic>> files =
        <String, Map<String, dynamic>>{};
    for (final Object? value in _items(
      await _postJson(_fileInfo, videos.keys.toList()),
    )) {
      final Map<String, dynamic> file = _object(value);
      final String contentId = _requiredText(file['contentId']);
      if (files.containsKey(contentId)) {
        throw const ElrcException('视频文件标识重复');
      }
      files[contentId] = file;
    }

    final List<ElrcSource> result = <ElrcSource>[];
    int index = 0;
    for (final MapEntry<String, Map<String, dynamic>> entry in videos.entries) {
      final Map<String, dynamic>? file = files[entry.key];
      if (file == null) throw const ElrcException('视频信息与文件信息不一致');
      final String? address = _address(file);
      if (address == null) throw const ElrcException('没有可播放的视频地址');
      final String name = _first(<Object?>[
        entry.value['seat'],
        file['seat'],
        entry.value['name'],
        entry.value['name_'],
        file['entityName'],
      ]);
      result.add(ElrcSource(_sourceLabel(name, index), _mediaUri(address)));
      index++;
    }
    return List<ElrcSource>.unmodifiable(result);
  }

  Future<Object?> _request(
    String path, {
    required _EnvelopeKind kind,
    Map<String, String>? query,
    Object? json,
  }) async {
    final String id = 'elrc-${_sequence++}';
    final Uri uri = Uri.https('elrc.shanghaitech.edu.cn', path, query);
    final CampusBridgeResponse response = await _requester(
      CampusBridgeRequest(
        id: id,
        url: uri.toString(),
        method: json == null ? 'GET' : 'POST',
        json: json,
      ),
    );

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
    return kind == _EnvelopeKind.status
        ? _readStatusData(envelope)
        : _readSuccessData(envelope);
  }

  Object? _readSuccessData(Map<String, dynamic> envelope) {
    final Object? success = envelope['success'];
    if (success != null && success is! bool) {
      throw const ElrcException('ELRC 返回格式发生变化');
    }
    if (success == false) throw const ElrcException('ELRC 请求失败');
    if (!envelope.containsKey('data')) {
      throw const ElrcException('ELRC 返回格式发生变化');
    }
    return envelope['data'];
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

enum _EnvelopeKind { status, success }

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

String _sourceLabel(String name, int index) {
  final String normalized = name.toLowerCase();
  if (normalized.contains('tchpan') || name.contains('全景')) return '全景画面';
  if (normalized.contains('screen') || name.contains('屏幕')) return '屏幕画面';
  if (normalized == 'tch' ||
      normalized.contains('teacher') ||
      name.contains('教师') ||
      name.contains('近景')) {
    return '教师画面';
  }
  return name.isEmpty ? '机位 ${index + 1}' : name;
}

String? _address(Map<String, dynamic> file) {
  // 真实数据里 fileGroups 与 downloadAddress 可能只出现其中一个，
  // 所以这里对缺失字段保持宽容；两者都没有才返回 null（上层会报"没有可播放地址"）。
  final Object? groups = file['fileGroups'];
  if (groups is List<dynamic>) {
    for (final Object? group in groups) {
      if (group is! Map<String, dynamic>) continue;
      final Object? files = group['files'];
      if (files is! List<dynamic>) continue;
      for (final Object? value in files) {
        if (value is! Map<String, dynamic>) continue;
        final String address = _text(value['downloadAddress']);
        if (address.isNotEmpty) return address;
      }
    }
  }
  final Object? direct = file['downloadAddress'];
  if (direct is List<dynamic>) {
    for (final Object? value in direct) {
      final String address = _text(value);
      if (address.isNotEmpty) return address;
    }
  }
  return null;
}

Uri _mediaUri(String address) {
  final String normalized = address.trim();
  if (normalized.isEmpty ||
      normalized.codeUnits.any(
        (int value) => value <= 0x20 || value == 0x7f || value == 0x5c,
      )) {
    throw const ElrcException('视频地址格式不正确');
  }
  final Uri uri;
  try {
    uri = Uri.parse(ElrcClient.origin).resolve(normalized);
  } on FormatException {
    throw const ElrcException('视频地址格式不正确');
  }
  if (uri.scheme != 'https' ||
      uri.host != 'elrc.shanghaitech.edu.cn' ||
      uri.port != 443 ||
      uri.userInfo.isNotEmpty ||
      uri.hasFragment) {
    throw const ElrcException('视频地址不属于 ELRC');
  }
  if (!uri.path.contains('/bucket-z/') ||
      uri.queryParameters.containsKey('isSysAuth')) {
    return uri;
  }
  return Uri.parse(
    '${uri.toString()}${uri.query.isEmpty ? '?' : '&'}isSysAuth=true',
  );
}

String _first(Iterable<Object?> values) {
  for (final Object? value in values) {
    final String text = _text(value);
    if (text.isNotEmpty) return text;
  }
  return '';
}

/// ELRC（课程录播）模型。
///
/// 端点与字段形状对齐 TechPie 的 `lib/services/elrc_client.dart`（GeekPie，经允许复用）。
/// 本文件只放纯数据与异常，不含 IO。
library;

/// ELRC 请求失败。`needsLogin` 为 true 时页面应引导重新登录。
final class ElrcException implements Exception {
  const ElrcException(this.message, {this.needsLogin = false});

  final String message;
  final bool needsLogin;

  @override
  String toString() => message;
}

/// 一门有录播的课程。
final class ElrcCourse {
  const ElrcCourse(
    this.name,
    this.courseId, {
    this.reviewId,
    this.courseNo,
    this.schoolYear,
    this.semester,
    this.description = '',
  });

  final String name;
  final String courseId;
  final String? reviewId;
  final String? courseNo;
  final String? schoolYear;
  final String? semester;
  final String description;

  /// 课程页地址（作为后续请求的 Referer）。
  Uri get referer => Uri.https(
        'elrc.shanghaitech.edu.cn',
        '/learn/videoreview/$courseId',
        <String, String>{
          if (reviewId != null) 'id': reviewId!,
          if (schoolYear != null) 'schoolYear': schoolYear!,
          if (semester != null) 'semester': semester!,
        },
      );
}

/// 一次课（周次 + 星期 + 节次）。
final class ElrcLesson {
  ElrcLesson({
    required this.courseId,
    required this.courseNo,
    required this.week,
    required this.weekDay,
    required this.weekDate,
    required this.section,
    required List<String> scheduleIds,
  }) : scheduleIds = List<String>.unmodifiable(scheduleIds);

  final String courseId;
  final String courseNo;
  final String week;
  final String weekDay;
  final String weekDate;
  final String section;
  final List<String> scheduleIds;

  String get title => '第$week周 $weekDay · $section节';

  /// 取视频列表时提交的字段。
  Map<String, Object> get query => <String, Object>{
        'courseId': courseId,
        'courseNo': courseNo,
        'week': week,
        'weekDay': weekDay,
        'section': section,
        'scheduleIds': scheduleIds,
      };
}

/// 一个可播放的机位。
final class ElrcSource {
  const ElrcSource(this.label, this.uri);

  final String label;
  final Uri uri;
}

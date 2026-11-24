import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/features/campus_web/domain/campus_bridge_protocol.dart';
import 'package:kedaya/features/elrc/data/elrc_client.dart';
import 'package:kedaya/features/elrc/domain/elrc_models.dart';

CampusBridgeResponse _ok(Object? data) => CampusBridgeResponse(
      id: 'x',
      status: 200,
      body: jsonEncode(<String, Object?>{'status': 0, 'data': data}),
    );

void main() {
  group('courses()', () {
    test('解析课程并带上 reviewId / 学期描述', () async {
      final List<Uri> urls = <Uri>[];
      final ElrcClient client = ElrcClient((CampusBridgeRequest request) async {
        urls.add(Uri.parse(request.url));
        return _ok(<String, Object?>{
          'page': 1,
          'size': 50,
          'total': 1,
          'results': <Object?>[
            <String, Object?>{
              'courseName': '程序分析',
              'courseId': 'C1',
              'id': 'R1',
              'courseNumber': 'CS301',
              'serialNumber': '01',
              'showSemester': '2026 秋',
              'schoolYear': '2026',
              'semester': '1',
            },
          ],
        });
      });

      final List<ElrcCourse> courses = await client.courses();
      expect(courses, hasLength(1));
      expect(courses.single.name, '程序分析');
      expect(courses.single.reviewId, 'R1');
      expect(courses.single.description, 'CS301 · 01 · 2026 秋');
      expect(urls.single.path, '/learn/v1/course/video/review/1');
      expect(urls.single.queryParameters['page'], '1');
      expect(urls.single.queryParameters['size'], '50');
    });

    test('rows 缺 courseId → 格式异常', () async {
      final ElrcClient client = ElrcClient((CampusBridgeRequest request) async {
        return _ok(<String, Object?>{
          'page': 1,
          'size': 50,
          'total': 1,
          'results': <Object?>[
            <String, Object?>{'courseName': '没有 id 的课'},
          ],
        });
      });
      expect(
        () => client.courses(),
        throwsA(isA<ElrcException>()),
      );
    });

    test('返回 HTML（未登录）→ needsLogin', () async {
      final ElrcClient client = ElrcClient(
        (CampusBridgeRequest request) async => const CampusBridgeResponse(
          id: 'x',
          status: 200,
          body: '<html><title>登录</title></html>',
        ),
      );
      try {
        await client.courses();
        fail('应当抛 ElrcException');
      } on ElrcException catch (error) {
        expect(error.needsLogin, isTrue);
      }
    });

    test('封套 status 非 0/200 → 抛错并带 message', () async {
      final ElrcClient client = ElrcClient(
        (CampusBridgeRequest request) async => CampusBridgeResponse(
          id: 'x',
          status: 200,
          body: jsonEncode(<String, Object?>{
            'status': 500,
            'message': '服务器开小差了',
          }),
        ),
      );
      expect(
        () => client.courses(),
        throwsA(
          isA<ElrcException>().having(
            (ElrcException e) => e.message,
            'message',
            '服务器开小差了',
          ),
        ),
      );
    });
  });

  group('lessons()', () {
    test('解析周次 / 星期 / 节次与 scheduleIds', () async {
      final ElrcClient client = ElrcClient((CampusBridgeRequest request) async {
        return _ok(<String, Object?>{
          'courseId': 'C1',
          'courseNo': 'CS301',
          'recordingVideoInfoShows': <Object?>[
            <String, Object?>{
              'week': '3',
              'recordInfoDetailList': <Object?>[
                <String, Object?>{
                  'weekDay': '2',
                  'weekDate': '2026-03-10',
                  'section': '3-4',
                  'courseLiveInfo': <String, Object?>{
                    'courseId': 'C1',
                    'scheduleId': 'S1',
                  },
                  'videoInfoList': <Object?>[
                    <String, Object?>{'scheduleId': 'S2'},
                  ],
                },
              ],
            },
          ],
        });
      });

      final List<ElrcLesson> lessons = await client.lessons(
        const ElrcCourse('程序分析', 'C1', courseNo: 'CS301'),
      );
      expect(lessons, hasLength(1));
      expect(lessons.single.title, '第3周 2 · 3-4节');
      expect(lessons.single.scheduleIds, <String>['S1', 'S2']);
      expect(lessons.single.query['courseId'], 'C1');
    });

    test('返回的 courseId 与所选课程不一致 → 抛错', () async {
      final ElrcClient client = ElrcClient((CampusBridgeRequest request) async {
        return _ok(<String, Object?>{
          'courseId': 'OTHER',
          'recordingVideoInfoShows': <Object?>[],
        });
      });
      expect(
        () => client.lessons(const ElrcCourse('程序分析', 'C1')),
        throwsA(isA<ElrcException>()),
      );
    });

    test('没有课次 → 明确空态异常', () async {
      final ElrcClient client = ElrcClient((CampusBridgeRequest request) async {
        return _ok(<String, Object?>{
          'courseId': 'C1',
          'recordingVideoInfoShows': <Object?>[],
        });
      });
      expect(
        () => client.lessons(const ElrcCourse('程序分析', 'C1')),
        throwsA(
          isA<ElrcException>().having(
            (ElrcException e) => e.message,
            'message',
            '这门课程暂无录播课次',
          ),
        ),
      );
    });
  });
}

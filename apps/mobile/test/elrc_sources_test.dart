import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/features/campus_web/domain/campus_bridge_protocol.dart';
import 'package:kedaya/features/elrc/data/elrc_client.dart';
import 'package:kedaya/features/elrc/domain/elrc_models.dart';

CampusBridgeResponse _success(Object? data) => CampusBridgeResponse(
      id: 'x',
      status: 200,
      body: jsonEncode(<String, Object?>{'success': true, 'data': data}),
    );

ElrcCourse _course() => const ElrcCourse('程序分析', 'C1', courseNo: 'CS301');

ElrcLesson _lesson() => ElrcLesson(
      courseId: 'C1',
      courseNo: 'CS301',
      week: '3',
      weekDay: '2',
      weekDate: '2026-03-10',
      section: '3-4',
      scheduleIds: <String>['S1'],
    );

void main() {
  group('sources()', () {
    test('按 contentId 配对，识别教师/屏幕机位，并给 bucket-z 地址补 isSysAuth', () async {
      final ElrcClient client = ElrcClient((CampusBridgeRequest request) async {
        if (request.url.contains('/rman/v1/search/new/relation/videos')) {
          expect(request.method, 'POST');
          expect(request.encode(), contains('"courseId":"C1"'));
          return _success(<String, Object?>{
            'data': <Object?>[
              <String, Object?>{'contentId_': 'V1', 'seat': 'TCH'},
              <String, Object?>{'contentId_': 'V2', 'name_': 'SCREEN'},
            ],
          });
        }
        if (request.url.contains('/rman/v1/entity/download/fileinfo')) {
          expect(request.encode(), contains('"V1"'));
          return _success(<Object?>[
            <String, Object?>{
              'contentId': 'V1',
              'fileGroups': <Object?>[
                <String, Object?>{
                  'files': <Object?>[
                    <String, Object?>{
                      'downloadAddress':
                          'https://elrc.shanghaitech.edu.cn/bucket-z/a.mp4',
                    },
                  ],
                },
              ],
            },
            <String, Object?>{
              'contentId': 'V2',
              'downloadAddress': <Object?>[
                'https://elrc.shanghaitech.edu.cn/plain/b.mp4',
              ],
            },
          ]);
        }
        fail('未预期的请求：${request.url}');
      });

      final List<ElrcSource> sources = await client.sources(_course(), _lesson());
      expect(sources, hasLength(2));
      expect(sources[0].label, '教师画面');
      expect(sources[0].uri.queryParameters['isSysAuth'], 'true');
      expect(sources[1].label, '屏幕画面');
      expect(sources[1].uri.path, '/plain/b.mp4');
    });

    test('视频没有对应文件 → 抛错', () async {
      final ElrcClient client = ElrcClient((CampusBridgeRequest request) async {
        if (request.url.contains('relation/videos')) {
          return _success(<String, Object?>{
            'data': <Object?>[
              <String, Object?>{'contentId_': 'V1'},
            ],
          });
        }
        return _success(<Object?>[]);
      });
      expect(
        () => client.sources(_course(), _lesson()),
        throwsA(
          isA<ElrcException>().having(
            (ElrcException e) => e.message,
            'message',
            '视频信息与文件信息不一致',
          ),
        ),
      );
    });

    test('地址不在 ELRC 域名 → 拒绝', () async {
      final ElrcClient client = ElrcClient((CampusBridgeRequest request) async {
        if (request.url.contains('relation/videos')) {
          return _success(<String, Object?>{
            'data': <Object?>[
              <String, Object?>{'contentId_': 'V1'},
            ],
          });
        }
        return _success(<Object?>[
          <String, Object?>{
            'contentId': 'V1',
            'downloadAddress': <Object?>['https://evil.example.com/a.mp4'],
          },
        ]);
      });
      expect(
        () => client.sources(_course(), _lesson()),
        throwsA(
          isA<ElrcException>().having(
            (ElrcException e) => e.message,
            'message',
            '视频地址不属于 ELRC',
          ),
        ),
      );
    });

    test('课次与课程不一致 → 直接拒绝，不发请求', () async {
      bool called = false;
      final ElrcClient client = ElrcClient((CampusBridgeRequest request) async {
        called = true;
        return _success(<Object?>[]);
      });
      final ElrcLesson other = ElrcLesson(
        courseId: 'OTHER',
        courseNo: 'X',
        week: '1',
        weekDay: '1',
        weekDate: '',
        section: '1-2',
        scheduleIds: <String>['S9'],
      );
      await expectLater(
        () => client.sources(_course(), other),
        throwsA(isA<ElrcException>()),
      );
      expect(called, isFalse);
    });
  });
}

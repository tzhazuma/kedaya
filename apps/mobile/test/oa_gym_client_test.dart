import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/features/campus_web/domain/campus_bridge_protocol.dart';
import 'package:kedaya/features/facility/data/oa_gym_client.dart';

CampusBridgeResponse _json(Object? body) => CampusBridgeResponse(
      id: 'x',
      status: 200,
      body: jsonEncode(body),
    );

void main() {
  group('availability()', () {
    test('两级树：父节点下按前缀与编号范围取空闲场地', () async {
      final List<CampusBridgeRequest> requests = <CampusBridgeRequest>[];
      final OaGymClient client = OaGymClient((CampusBridgeRequest request) async {
        requests.add(request);
        expect(request.method, 'POST');
        final String pid = (request.form ?? <String, String>{})['pid']!;
        if (pid == '63_1') {
          return _json(<Object?>[
            <String, Object?>{'name': '体育馆', 'id': 'ignore'},
            <String, Object?>{
              'name': '室内羽毛球场',
              'id': 'P1',
              'isParent': true,
            },
          ]);
        }
        return _json(<Object?>[
          <String, Object?>{'name': '羽毛球场地1号'},
          <String, Object?>{'name': '羽毛球场地6号'},
          <String, Object?>{'name': '羽毛球场地9号'}, // 超出 courtCount
          <String, Object?>{'name': '走廊'},
        ]);
      });

      final List<OaAvailability> rows = await client.availability(
        date: '2026-11-25',
        sports: <OaSport>[OaSport.badminton],
        startSlot: 3,
        endSlot: 3,
      );
      expect(rows, hasLength(1));
      expect(rows.single.timeSlot, 3);
      expect(rows.single.availableCourts, <int>[1, 6]);
      expect(rows.single.totalCourts, 6);
      expect(rows.single.hasFree, isTrue);
      expect(
        requests.first.url,
        contains('_sfn_31901_sfv_2026-11-25_sfn_31902_sfv_3_sfn_32340_sfv_4'),
      );
    });

    test('找不到父节点 → 该时段空（不是错误）', () async {
      final OaGymClient client = OaGymClient((CampusBridgeRequest request) async {
        return _json(<Object?>[
          <String, Object?>{'name': '别的场馆', 'id': 'X'},
        ]);
      });
      final List<OaAvailability> rows = await client.availability(
        date: '2026-11-25',
        sports: <OaSport>[OaSport.tennis],
        startSlot: 1,
        endSlot: 2,
      );
      expect(rows, hasLength(2));
      expect(rows.every((OaAvailability r) => r.availableCourts.isEmpty), isTrue);
    });

    test('返回 HTML（登录失效）→ sessionExpired', () async {
      final OaGymClient client = OaGymClient(
        (CampusBridgeRequest request) async => const CampusBridgeResponse(
          id: 'x',
          status: 200,
          body: '<html>登录</html>',
        ),
      );
      try {
        await client.availability(date: '2026-11-25', sports: <OaSport>[OaSport.tennis]);
        fail('应当抛 OaGymException');
      } on OaGymException catch (error) {
        expect(error.sessionExpired, isTrue);
      }
    });

    test('日期与时段参数在本地校验，不发请求', () async {
      bool called = false;
      final OaGymClient client = OaGymClient((CampusBridgeRequest request) async {
        called = true;
        return _json(<Object?>[]);
      });
      expect(
        () => client.availability(date: '2026/11/25'),
        throwsA(isA<OaGymException>()),
      );
      expect(
        () => client.availability(date: '2026-11-25', startSlot: 5, endSlot: 12),
        throwsA(isA<OaGymException>()),
      );
      expect(called, isFalse);
    });
  });
}

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
  group('book()', () {
    test('把工作流字段按约定提交，并按 wfforward 判定成功', () async {
      final List<CampusBridgeRequest> requests = <CampusBridgeRequest>[];
      final OaGymClient client = OaGymClient((CampusBridgeRequest request) async {
        requests.add(request);
        if (request.expr != null) {
          return const CampusBridgeResponse(id: 'x', status: 200, body: 'u-123');
        }
        return const CampusBridgeResponse(
          id: 'x',
          status: 200,
          body: "<script>wfforward('/workflow/request/WorkflowDirection.jsp?x=1')</script>",
        );
      });

      final OaBookingResult result = await client.book(
        sport: OaSport.badminton,
        date: '2026-11-25',
        timeSlot: 4,
        courtNumber: 2,
        playersCount: 4,
        userName: '张三',
        studentId: '20265555',
        phone: '13800000000',
      );

      expect(result.success, isTrue);
      final CampusBridgeRequest post = requests.last;
      expect(post.method, 'POST');
      expect(post.url, contains('/workflow/request/RequestOperation.jsp'));
      final Map<String, String> form = post.form!;
      expect(form['field31883'], '63_14'); // offset 12 + 2
      expect(form['field31902'], '4');
      expect(form['field31904'], '14:00');
      expect(form['field31905'], '15:00');
      expect(form['field31876'], 'u-123');
      expect(form['workflowid'], '14862');
    });

    test('提交返回错误页 → success=false，且不重试', () async {
      int posts = 0;
      final OaGymClient client = OaGymClient((CampusBridgeRequest request) async {
        if (request.expr != null) {
          return const CampusBridgeResponse(id: 'x', status: 200, body: 'u-1');
        }
        posts++;
        return const CampusBridgeResponse(id: 'x', status: 200, body: '失败');
      });
      final OaBookingResult result = await client.book(
        sport: OaSport.tennis,
        date: '2026-11-25',
        timeSlot: 1,
        courtNumber: 1,
        playersCount: 2,
        userName: '张三',
        studentId: '20265555',
        phone: '13800000000',
      );
      expect(result.success, isFalse);
      expect(posts, 1);
    });

    test('拿不到 OA 用户 → sessionExpired', () async {
      final OaGymClient client = OaGymClient(
        (CampusBridgeRequest request) async =>
            const CampusBridgeResponse(id: 'x', status: 200, body: ''),
      );
      try {
        await client.book(
          sport: OaSport.tennis,
          date: '2026-11-25',
          timeSlot: 1,
          courtNumber: 1,
          playersCount: 2,
          userName: '张三',
          studentId: '20265555',
          phone: '13800000000',
        );
        fail('应当抛 OaGymException');
      } on OaGymException catch (error) {
        expect(error.sessionExpired, isTrue);
      }
    });

    test('场地编号与人数在本地校验', () async {
      final OaGymClient client = OaGymClient(
        (CampusBridgeRequest request) async =>
            const CampusBridgeResponse(id: 'x', status: 200, body: 'u'),
      );
      expect(
        () => client.book(
          sport: OaSport.pickleball,
          date: '2026-11-25',
          timeSlot: 1,
          courtNumber: 2,
          playersCount: 2,
          userName: 'a',
          studentId: 'b',
          phone: 'c',
        ),
        throwsA(isA<OaGymException>()),
      );
      expect(
        () => client.book(
          sport: OaSport.tennis,
          date: '2026-11-25',
          timeSlot: 1,
          courtNumber: 1,
          playersCount: 11,
          userName: 'a',
          studentId: 'b',
          phone: 'c',
        ),
        throwsA(isA<OaGymException>()),
      );
    });
  });

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

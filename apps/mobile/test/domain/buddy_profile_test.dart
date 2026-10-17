import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/domain/models/buddy.dart';
import 'package:kedaya/domain/models/buddy_profile.dart';
import 'package:kedaya/domain/models/buddy_tags.dart';

/// 匹配资料与可用时段的领域测试（规格 §2.2 / §3.3 / §6.3）。
void main() {
  /// Dart 没有字符串重复运算符，测试里造超长文本用它。
  String repeat(String unit, int count) =>
      List<String>.filled(count, unit).join();

  group('AvailabilitySlot 校验（规格 §2.2）', () {
    test('合法时段：0 ≤ startMin < endMin ≤ 1440', () {
      expect(
        const AvailabilitySlot(dow: 1, startMin: 0, endMin: 60).error,
        isNull,
      );
      expect(
        const AvailabilitySlot(dow: 6, startMin: 23 * 60, endMin: 24 * 60)
            .error,
        isNull,
        reason: '24:00 是「到午夜」的自然边界（本端的显式放宽，见常量注释）',
      );
    });

    test('非法时段逐条', () {
      expect(
        const AvailabilitySlot(dow: 7, startMin: 0, endMin: 60).error,
        contains('0–6'),
      );
      expect(
        const AvailabilitySlot(dow: -1, startMin: 0, endMin: 60).error,
        isNotNull,
      );
      expect(
        const AvailabilitySlot(dow: 1, startMin: 1440, endMin: 1440).error,
        isNotNull,
      );
      expect(
        const AvailabilitySlot(dow: 1, startMin: 600, endMin: 600).error,
        contains('晚于'),
      );
      expect(
        const AvailabilitySlot(dow: 1, startMin: 600, endMin: 599).error,
        contains('晚于'),
      );
      expect(
        const AvailabilitySlot(dow: 1, startMin: 0, endMin: 1441).error,
        contains('24:00'),
      );
    });

    test('时长与展示文案', () {
      const AvailabilitySlot slot = AvailabilitySlot(
        dow: 1,
        startMin: 9 * 60,
        endMin: 12 * 60,
      );
      expect(slot.durationMin, 180);
      expect(slot.label, '周一 09:00–12:00');
      expect(slot.isValid, isTrue);
      expect(
        const AvailabilitySlot(dow: 0, startMin: 23 * 60, endMin: 24 * 60)
            .label,
        '周日 23:00–24:00',
      );
    });

    test('分钟 / 星期文案', () {
      expect(buddyMinutesLabel(0), '00:00');
      expect(buddyMinutesLabel(570), '09:30');
      expect(buddyMinutesLabel(1439), '23:59');
      expect(buddyMinutesLabel(1440), '24:00');
      expect(buddyDowLabel(0), '周日');
      expect(buddyDowLabel(6), '周六');
      expect(buddyDowLabel(9), '未知');
    });

    test('JSON 往返', () {
      const AvailabilitySlot slot = AvailabilitySlot(
        dow: 3,
        startMin: 1140,
        endMin: 1320,
      );
      expect(AvailabilitySlot.fromJson(slot.toJson()), slot);
      expect(slot.toJson(), <String, Object?>{
        'dow': 3,
        'startMin': 1140,
        'endMin': 1320,
      });
    });
  });

  group('跨零点时段拆分（规格 §3.3 点名的边界情况）', () {
    test('end > start：原样返回单段', () {
      final List<AvailabilitySlot> parts = splitCrossMidnight(
        dow: 1,
        startMin: 19 * 60,
        endMin: 22 * 60,
      );
      expect(parts, hasLength(1));
      expect(parts.single.label, '周一 19:00–22:00');
    });

    test('23:00 → 01:00：拆成当天 23:00–24:00 + 次日 00:00–01:00', () {
      final List<AvailabilitySlot> parts = splitCrossMidnight(
        dow: 1,
        startMin: 23 * 60,
        endMin: 60,
      );
      expect(parts, hasLength(2));
      expect(parts.first.label, '周一 23:00–24:00');
      expect(parts.last.label, '周二 00:00–01:00');
      expect(parts.every((AvailabilitySlot slot) => slot.isValid), isTrue);
    });

    test('23:00 → 00:00：只留当天那一段（次日段长度为 0，不生成）', () {
      final List<AvailabilitySlot> parts = splitCrossMidnight(
        dow: 6,
        startMin: 23 * 60,
        endMin: 0,
      );
      expect(parts, hasLength(1));
      expect(parts.single.label, '周六 23:00–24:00');
    });

    test('周六跨零点 → 次日是**周日**（0），不是 7', () {
      final List<AvailabilitySlot> parts = splitCrossMidnight(
        dow: 6,
        startMin: 23 * 60,
        endMin: 30,
      );
      expect(parts.last.dow, 0);
      expect(parts.last.label, '周日 00:00–00:30');
    });

    test('非法输入返回空列表（由调用方展示 slot.error）', () {
      expect(splitCrossMidnight(dow: 9, startMin: 0, endMin: 60), isEmpty);
      expect(splitCrossMidnight(dow: 1, startMin: 1440, endMin: 60), isEmpty);
      expect(splitCrossMidnight(dow: 1, startMin: 0, endMin: 2000), isEmpty);
      expect(splitCrossMidnight(dow: 1, startMin: 0, endMin: -5), isEmpty);
    });
  });

  group('normalizeAvailability / hasOverlappingAvailability', () {
    test('拆分跨零点 + 去重 + 排序', () {
      final List<AvailabilitySlot> normalized = normalizeAvailability(
        <AvailabilitySlot>[
          const AvailabilitySlot(dow: 3, startMin: 19 * 60, endMin: 22 * 60),
          const AvailabilitySlot(dow: 1, startMin: 19 * 60, endMin: 22 * 60),
          const AvailabilitySlot(dow: 1, startMin: 19 * 60, endMin: 22 * 60),
          const AvailabilitySlot(dow: 5, startMin: 23 * 60, endMin: 60),
        ],
      );
      expect(
        normalized.map((AvailabilitySlot slot) => slot.label),
        <String>[
          '周一 19:00–22:00',
          '周三 19:00–22:00',
          '周五 23:00–24:00',
          '周六 00:00–01:00'
        ],
      );
    });

    test('重叠检测', () {
      expect(
        hasOverlappingAvailability(const <AvailabilitySlot>[
          AvailabilitySlot(dow: 1, startMin: 9 * 60, endMin: 12 * 60),
          AvailabilitySlot(dow: 1, startMin: 11 * 60, endMin: 13 * 60),
        ]),
        isTrue,
      );
      expect(
        hasOverlappingAvailability(const <AvailabilitySlot>[
          AvailabilitySlot(dow: 1, startMin: 9 * 60, endMin: 12 * 60),
          AvailabilitySlot(dow: 1, startMin: 12 * 60, endMin: 13 * 60),
        ]),
        isFalse,
        reason: '左闭右开：12:00 相接不算重叠',
      );
      expect(
        hasOverlappingAvailability(const <AvailabilitySlot>[
          AvailabilitySlot(dow: 1, startMin: 9 * 60, endMin: 12 * 60),
          AvailabilitySlot(dow: 2, startMin: 9 * 60, endMin: 12 * 60),
        ]),
        isFalse,
        reason: '不同星期不算重叠',
      );
    });
  });

  group('本地时间文案（Asia/Shanghai = UTC+8）', () {
    test('UTC 06:00 == 上海 14:00（周一）', () {
      final DateTime instant = DateTime.utc(2026, 10, 19, 6);
      expect(buddyLocalTime(instant), DateTime.utc(2026, 10, 19, 14));
      expect(buddyLocalDateLabel(instant), '10月19日');
      expect(buddyLocalDateTimeLabel(instant), '周一 14:00');
      expect(buddyLocalFullLabel(instant), '10月19日 周一 14:00');
    });

    test('UTC 16:00 == 上海次日 00:00（跨日）', () {
      final DateTime instant = DateTime.utc(2026, 10, 19, 16);
      expect(buddyLocalDateLabel(instant), '10月20日');
      expect(buddyLocalDateTimeLabel(instant), '周二 00:00');
    });
  });

  group('BuddyProfile 解析与序列化', () {
    test('未登记板块（含 dating）被丢弃，而不是变成一个可用板块', () {
      final BuddyProfile profile = BuddyProfile.fromJson(<String, Object?>{
        'userId': 'u-1',
        'sections': <String>['sport', 'dating', 'daily'],
        'matchEnabled': true,
      });
      expect(profile.matchableSections, <BuddySection>[
        BuddySection.sport,
        BuddySection.daily,
      ]);
      expect(profile.sections, isNot(contains(BuddySection.unknown)));
      expect(profile.isRecommendable, isTrue);
    });

    test('matchEnabled 缺省为 false（规格 §6.3：默认不参与）', () {
      expect(
          BuddyProfile.fromJson(<String, Object?>{'userId': 'u-1'})
              .matchEnabled,
          isFalse);
      expect(BuddyProfile.empty('u-1').matchEnabled, isFalse);
      expect(BuddyProfile.empty('u-1').isRecommendable, isFalse);
      expect(BuddyProfile.empty('u-1').hasAnySignal, isFalse);
    });

    test('序列化里没有 embedding / gender / age（规格 §8.4 T26）', () {
      final Map<String, Object?> json = BuddyProfile.empty('u-1').toJson();
      for (final String forbidden in <String>[
        'embedding',
        'embeddingModel',
        'gender',
        'age',
        'birthDate',
        'mbti',
      ]) {
        expect(json.containsKey(forbidden), isFalse, reason: '不得下发 $forbidden');
      }
      expect(json.keys,
          containsAll(<String>['sections', 'interestTags', 'availability']));
    });

    test('availability 解析容错：非对象元素被跳过', () {
      final BuddyProfile profile = BuddyProfile.fromJson(<String, Object?>{
        'userId': 'u-1',
        'availability': <Object?>[
          <String, Object?>{'dow': 1, 'startMin': 1140, 'endMin': 1320},
          'not-a-map',
          42,
        ],
      });
      expect(profile.availability, hasLength(1));
      expect(profile.availability.single.label, '周一 19:00–22:00');
    });
  });

  group('BuddyProfile 校验（规格 §2.2 的约束列）', () {
    BuddyProfile base() => BuddyProfile(
          userId: 'u-1',
          sections: const <BuddySection>[BuddySection.sport],
          interestTags: const <String>['badminton', 'coding'],
          activityTags: const <String>['badminton'],
          availability: const <AvailabilitySlot>[
            AvailabilitySlot(dow: 1, startMin: 19 * 60, endMin: 22 * 60),
          ],
          preferredAreas: const <String>['体育馆'],
          department: '信息科学与技术学院',
          bio: '常泡图书馆',
          matchEnabled: true,
        );

    test('合法资料没有任何错误', () {
      expect(base().validationErrors(), isEmpty);
      expect(base().isValid, isTrue);
      expect(base().isRecommendable, isTrue);
    });

    test('兴趣标签：数量上限 20、单标签长度 24、必须在封闭表里', () {
      expect(
        base().copyWith(
          interestTags: <String>[
            for (int i = 0; i < 21; i++) 'badminton',
          ],
        ).validationErrors()['interestTags'],
        contains('$buddyInterestTagMaxCount'),
      );
      expect(
        base().copyWith(interestTags: <String>[
          repeat('x', 25)
        ]).validationErrors()['interestTags'],
        contains('$buddyInterestTagMaxLength'),
      );
      expect(
        base().copyWith(interestTags: const <String>[
          'quidditch'
        ]).validationErrors()['interestTags'],
        contains('UNKNOWN_TAG:quidditch'),
      );
    });

    test('活动标签：数量上限 10 + 封闭表', () {
      expect(
        base().copyWith(activityTags: <String>[
          for (int i = 0; i < 11; i++) 'badminton'
        ]).validationErrors()['activityTags'],
        contains('$buddyActivityTagMaxCount'),
      );
      expect(
        base().copyWith(activityTags: const <String>[
          'nope'
        ]).validationErrors()['activityTags'],
        contains('UNKNOWN_TAG:nope'),
      );
    });

    test('常去区域：≤5 + 校园地点白名单', () {
      expect(
        base().copyWith(
          preferredAreas: const <String>[
            '图书馆',
            '一食堂',
            '二食堂',
            '体育馆',
            '田径场',
            '篮球场',
          ],
        ).validationErrors()['preferredAreas'],
        contains('$buddyPreferredAreaMaxCount'),
      );
      expect(
        base().copyWith(preferredAreas: const <String>[
          '月球基地'
        ]).validationErrors()['preferredAreas'],
        contains('白名单'),
      );
    });

    test('院系 ≤64 字；自述 ≤200 字且不得写联系方式', () {
      expect(
        base()
            .copyWith(department: repeat('院', 65))
            .validationErrors()['department'],
        isNotNull,
      );
      expect(
        base().copyWith(bio: repeat('鸭', 201)).validationErrors()['bio'],
        isNotNull,
      );
      expect(
        base().copyWith(bio: '加我 v: myid').validationErrors()['bio'],
        contains('微信号'),
      );
    });

    test('时段非法时给出错误', () {
      expect(
        base().copyWith(
          availability: const <AvailabilitySlot>[
            AvailabilitySlot(dow: 1, startMin: 600, endMin: 600),
          ],
        ).validationErrors()['availability'],
        isNotNull,
      );
    });

    test('清空可空字段用显式开关（copyWith 的 ?? 语义无法置空）', () {
      expect(base().copyWith(clearDepartment: true).department, isNull);
      expect(base().copyWith(clearBio: true).bio, isNull);
    });
  });

  group('封闭标签表（规格 §3.2）', () {
    test('key 唯一、label 非空、分组齐全', () {
      final Set<String> keys =
          buddyTagCatalog.map((BuddyTag tag) => tag.key).toSet();
      expect(keys, hasLength(buddyTagCatalog.length), reason: 'key 必须唯一');
      for (final BuddyTag tag in buddyTagCatalog) {
        expect(tag.label, isNotEmpty);
      }
      for (final BuddyTagGroup group in BuddyTagGroup.values) {
        expect(
          buddyActiveTagsOfGroup(group),
          isNotEmpty,
          reason: '${group.wire} 分组不应为空',
        );
      }
    });

    test('登记 / 可选的区分（下架标签仍能渲染历史数据）', () {
      for (final BuddyTag tag in buddyTagCatalog) {
        expect(isKnownBuddyTag(tag.key), isTrue);
        expect(isActiveBuddyTag(tag.key), tag.isActive);
      }
      expect(isKnownBuddyTag('quidditch'), isFalse);
      expect(isActiveBuddyTag('quidditch'), isFalse);
      expect(buddyTagLabel('quidditch'), 'quidditch', reason: '未登记时原样返回');
    });

    test('搜索支持别名（规格 §3.2：aliases 仅用于搜索）', () {
      expect(
        searchBuddyTags('打羽毛球').map((BuddyTag tag) => tag.key),
        contains('badminton'),
      );
      expect(
        searchBuddyTags('BADMINTON').map((BuddyTag tag) => tag.key),
        contains('badminton'),
      );
      expect(searchBuddyTags('').length, buddyActiveTags.length);
      expect(
        searchBuddyTags('羽毛球', group: BuddyTagGroup.study),
        isEmpty,
        reason: '分组过滤生效',
      );
    });

    test('校园地点白名单非空且无重复', () {
      expect(buddyCampusLocations, isNotEmpty);
      expect(
        buddyCampusLocations.toSet(),
        hasLength(buddyCampusLocations.length),
      );
      expect(isKnownCampusLocation(' 图书馆 '), isTrue, reason: '去首尾空白');
      expect(isKnownCampusLocation('月球基地'), isFalse);
    });
  });
}

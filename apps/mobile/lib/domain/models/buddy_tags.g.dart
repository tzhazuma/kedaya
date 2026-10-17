// DO NOT EDIT —— 由 scripts/sync-flutter-mirrors.mjs 从 packages/contracts/src/buddy-tags.ts 生成。
// source: packages/contracts/src/buddy-tags.ts
// source-blob-sha1: 6dcfd17441bf2a0efc1008a41ea354bb700305ab
// 生成物覆盖: BUDDY_TAGS 62 条 / CAMPUS_LOCATION_DEFS 25 条
// 重新生成: node scripts/sync-flutter-mirrors.mjs
// 校验:     node scripts/sync-flutter-mirrors.mjs --check
//
// 手改本文件会在 CI 的 --check 步骤失败；请改源文件后重新生成。
//
// ---------------------------------------------------------------

import 'buddy_tag.dart';

/// 封闭标签表 —— **唯一真相**是 `packages/contracts/src/buddy-tags.ts`。
const List<BuddyTag> buddyTagCatalog = <BuddyTag>[
  BuddyTag(
    key: 'badminton',
    label: '羽毛球',
    group: BuddyTagGroup.sport,
    aliases: <String>['打羽毛球'],
  ),
  BuddyTag(
    key: 'basketball',
    label: '篮球',
    group: BuddyTagGroup.sport,
    aliases: <String>['打篮球'],
  ),
  BuddyTag(
    key: 'football',
    label: '足球',
    group: BuddyTagGroup.sport,
    aliases: <String>['踢球'],
  ),
  BuddyTag(key: 'volleyball', label: '排球', group: BuddyTagGroup.sport),
  BuddyTag(
    key: 'table-tennis',
    label: '乒乓球',
    group: BuddyTagGroup.sport,
    aliases: <String>['乒乓'],
  ),
  BuddyTag(key: 'tennis', label: '网球', group: BuddyTagGroup.sport),
  BuddyTag(
    key: 'running',
    label: '跑步',
    group: BuddyTagGroup.sport,
    aliases: <String>['夜跑', '慢跑'],
  ),
  BuddyTag(key: 'swimming', label: '游泳', group: BuddyTagGroup.sport),
  BuddyTag(
    key: 'gym',
    label: '健身',
    group: BuddyTagGroup.sport,
    aliases: <String>['撸铁'],
  ),
  BuddyTag(key: 'yoga', label: '瑜伽', group: BuddyTagGroup.sport),
  BuddyTag(key: 'cycling', label: '骑行', group: BuddyTagGroup.sport),
  BuddyTag(
    key: 'hiking',
    label: '徒步',
    group: BuddyTagGroup.sport,
    aliases: <String>['爬山'],
  ),
  BuddyTag(key: 'climbing', label: '攀岩', group: BuddyTagGroup.sport),
  BuddyTag(key: 'skateboard', label: '滑板', group: BuddyTagGroup.sport),
  BuddyTag(key: 'billiards', label: '台球', group: BuddyTagGroup.sport),
  BuddyTag(
    key: 'self-study',
    label: '自习',
    group: BuddyTagGroup.study,
    aliases: <String>['泡图书馆'],
  ),
  BuddyTag(key: 'library', label: '图书馆', group: BuddyTagGroup.study),
  BuddyTag(key: 'exam-prep', label: '备考', group: BuddyTagGroup.study),
  BuddyTag(key: 'postgraduate-exam', label: '考研', group: BuddyTagGroup.study),
  BuddyTag(key: 'english', label: '英语', group: BuddyTagGroup.study),
  BuddyTag(key: 'ielts-toefl', label: '托福雅思', group: BuddyTagGroup.study),
  BuddyTag(key: 'math', label: '数学', group: BuddyTagGroup.study),
  BuddyTag(
    key: 'programming',
    label: '编程',
    group: BuddyTagGroup.study,
    aliases: <String>['写代码'],
  ),
  BuddyTag(key: 'research', label: '科研', group: BuddyTagGroup.study),
  BuddyTag(
    key: 'paper-writing',
    label: '论文写作',
    group: BuddyTagGroup.study,
    aliases: <String>['写论文'],
  ),
  BuddyTag(key: 'group-project', label: '小组作业', group: BuddyTagGroup.study),
  BuddyTag(
    key: 'competition',
    label: '竞赛',
    group: BuddyTagGroup.study,
    aliases: <String>['比赛'],
  ),
  BuddyTag(key: 'canteen', label: '食堂', group: BuddyTagGroup.meal),
  BuddyTag(key: 'hotpot', label: '火锅', group: BuddyTagGroup.meal),
  BuddyTag(key: 'bbq', label: '烧烤', group: BuddyTagGroup.meal),
  BuddyTag(key: 'coffee', label: '咖啡', group: BuddyTagGroup.meal),
  BuddyTag(key: 'milk-tea', label: '奶茶', group: BuddyTagGroup.meal),
  BuddyTag(key: 'late-night-snack', label: '夜宵', group: BuddyTagGroup.meal),
  BuddyTag(key: 'baking', label: '烘焙', group: BuddyTagGroup.meal),
  BuddyTag(key: 'food-explore', label: '探店', group: BuddyTagGroup.meal),
  BuddyTag(
    key: 'citywalk',
    label: '城市漫步',
    group: BuddyTagGroup.travel,
    aliases: <String>['city walk'],
  ),
  BuddyTag(key: 'weekend-trip', label: '周末出游', group: BuddyTagGroup.travel),
  BuddyTag(key: 'disney', label: '迪士尼', group: BuddyTagGroup.travel),
  BuddyTag(key: 'mountain-trip', label: '登山', group: BuddyTagGroup.travel),
  BuddyTag(key: 'photo-shoot', label: '拍照', group: BuddyTagGroup.travel),
  BuddyTag(key: 'cycling-trip', label: '骑行出游', group: BuddyTagGroup.travel),
  BuddyTag(key: 'carpool', label: '拼车', group: BuddyTagGroup.travel),
  BuddyTag(key: 'train-together', label: '同行', group: BuddyTagGroup.travel),
  BuddyTag(key: 'music', label: '音乐', group: BuddyTagGroup.interest),
  BuddyTag(key: 'movie', label: '电影', group: BuddyTagGroup.interest),
  BuddyTag(
    key: 'gaming',
    label: '游戏',
    group: BuddyTagGroup.interest,
    aliases: <String>['开黑'],
  ),
  BuddyTag(key: 'board-game', label: '桌游', group: BuddyTagGroup.interest),
  BuddyTag(key: 'reading', label: '读书', group: BuddyTagGroup.interest),
  BuddyTag(key: 'photography', label: '摄影', group: BuddyTagGroup.interest),
  BuddyTag(key: 'anime', label: '动漫', group: BuddyTagGroup.interest),
  BuddyTag(key: 'ktv', label: '唱歌', group: BuddyTagGroup.interest),
  BuddyTag(key: 'drama', label: '话剧', group: BuddyTagGroup.interest),
  BuddyTag(key: 'painting', label: '绘画', group: BuddyTagGroup.interest),
  BuddyTag(key: 'dance', label: '舞蹈', group: BuddyTagGroup.interest),
  BuddyTag(key: 'calligraphy', label: '书法', group: BuddyTagGroup.interest),
  BuddyTag(key: 'cooking', label: '做饭', group: BuddyTagGroup.interest),
  BuddyTag(key: 'pets', label: '撸猫撸狗', group: BuddyTagGroup.interest),
  BuddyTag(key: 'tech', label: '科技', group: BuddyTagGroup.interest),
  BuddyTag(key: 'startup', label: '创业', group: BuddyTagGroup.interest),
  BuddyTag(key: 'volunteer', label: '志愿活动', group: BuddyTagGroup.interest),
  BuddyTag(key: 'debate', label: '辩论', group: BuddyTagGroup.interest),
  BuddyTag(key: 'chess', label: '棋类', group: BuddyTagGroup.interest),
];

/// 校园地点（`label` 是提交给服务端的 wire value，`key` 只用于埋点/i18n）。
const List<CampusLocationDef> buddyCampusLocationDefs = <CampusLocationDef>[
  CampusLocationDef(key: 'library', label: '图书馆'),
  CampusLocationDef(key: 'canteen-1', label: '一食堂'),
  CampusLocationDef(key: 'canteen-2', label: '二食堂'),
  CampusLocationDef(key: 'canteen-3', label: '三食堂'),
  CampusLocationDef(key: 'gym', label: '体育馆'),
  CampusLocationDef(key: 'badminton-hall', label: '羽毛球馆'),
  CampusLocationDef(key: 'swimming-pool', label: '游泳馆'),
  CampusLocationDef(key: 'track-field', label: '田径场'),
  CampusLocationDef(key: 'basketball-court', label: '篮球场'),
  CampusLocationDef(key: 'tennis-court', label: '网球场'),
  CampusLocationDef(key: 'fitness-room', label: '健身房'),
  CampusLocationDef(key: 'teaching-a', label: '教学楼A'),
  CampusLocationDef(key: 'teaching-b', label: '教学楼B'),
  CampusLocationDef(key: 'teaching-c', label: '教学楼C'),
  CampusLocationDef(key: 'student-center', label: '学生活动中心'),
  CampusLocationDef(key: 'academic-exchange-center', label: '学术交流中心'),
  CampusLocationDef(key: 'school-entrepreneurship', label: '创管学院'),
  CampusLocationDef(key: 'school-information', label: '信息学院'),
  CampusLocationDef(key: 'school-physical', label: '物质学院'),
  CampusLocationDef(key: 'school-life', label: '生命学院'),
  CampusLocationDef(key: 'dorm-area', label: '宿舍区'),
  CampusLocationDef(key: 'lakeside-lawn', label: '湖畔草坪'),
  CampusLocationDef(key: 'cafe', label: '咖啡厅'),
  CampusLocationDef(key: 'campus-gate', label: '校门口'),
  CampusLocationDef(key: 'zhangjiang-metro', label: '张江地铁站'),
];

/// 地点白名单（**上线值**，即中文名）。服务端校验的就是这些字符串。
const List<String> buddyCampusLocations = <String>[
  '图书馆',
  '一食堂',
  '二食堂',
  '三食堂',
  '体育馆',
  '羽毛球馆',
  '游泳馆',
  '田径场',
  '篮球场',
  '网球场',
  '健身房',
  '教学楼A',
  '教学楼B',
  '教学楼C',
  '学生活动中心',
  '学术交流中心',
  '创管学院',
  '信息学院',
  '物质学院',
  '生命学院',
  '宿舍区',
  '湖畔草坪',
  '咖啡厅',
  '校门口',
  '张江地铁站',
];

// ---------------------------------------------------------- 数量上限（契约 §3.2）
const int buddyInterestTagMaxCount = 20;
const int buddyActivityTagMaxCount = 10;
const int buddyPostTagMaxCount = 8;
const int buddyPreferredAreaMaxCount = 5;

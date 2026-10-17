import '../../domain/models/anonymous_identity.dart';
import '../../domain/models/faq.dart';
import '../../domain/models/forum.dart';
import 'mock_fixtures.dart';

/// `forum` / `faq` 的 mock 数据（无后端时 UI 能出数据，契约 §7 硬规则 4）。
///
/// 与 `mock_fixtures.dart` 分开存放：那两个模块的 fixture 与拼单/跑腿无关，
/// 单独一个文件更容易看出「哪些数据属于哪个模块」。
/// 时间基准复用 [mockNow]，因此相对时间文案可复现。

/// 4 个版块，覆盖 `public` / `campus_only` 两种可见性。
final List<ForumBoard> mockForumBoards = <ForumBoard>[
  const ForumBoard(
    id: 'fb-campus',
    slug: 'campus-life',
    name: '校园生活',
    description: '吃住行、校园设施、活动见闻。',
    visibility: ForumBoardVisibility.public,
    postCount: 3,
  ),
  const ForumBoard(
    id: 'fb-study',
    slug: 'study',
    name: '学习交流',
    description: '选课、作业、考试与自习搭子。',
    visibility: ForumBoardVisibility.public,
    postCount: 2,
  ),
  const ForumBoard(
    id: 'fb-club',
    slug: 'club',
    name: '社团活动',
    description: '社团招新与活动预告。',
    visibility: ForumBoardVisibility.public,
    postCount: 1,
  ),
  const ForumBoard(
    id: 'fb-voice',
    slug: 'feedback',
    name: '意见建议',
    description: '对校园服务的建议（仅校内可见，需登录）。',
    visibility: ForumBoardVisibility.campusOnly,
    postCount: 0,
  ),
];

/// 匿名身份的稳定样例（同一个 (用户, 版块) 得到同一个匿名 id）。
final AnonymousIdentity mockAnonymousDuck = AnonymousIdentity.derive(
  boardId: 'fb-campus',
  sequence: 7,
);

final AnonymousIdentity mockAnonymousStudy = AnonymousIdentity.derive(
  boardId: 'fb-study',
  sequence: 3,
);

/// 7 个主题：覆盖实名 / 匿名 / 置顶 / 锁定 / 隐藏（隐藏的不该出现在列表里）。
final List<ForumPost> mockForumPosts = <ForumPost>[
  ForumPost(
    id: 'fp-1001',
    boardId: 'fb-campus',
    boardName: '校园生活',
    title: '一食堂三楼新窗口测评（附价格）',
    body: '新开的面食窗口，均价 12 元，出餐速度比二楼快。\n\n'
        '建议 11:30 前到，12:00 之后排队会超过 10 分钟。',
    author: const RealAuthor(userId: 'u-2001', name: '鸭鸭一号'),
    status: ForumPostStatus.published,
    tags: const <String>['食堂', '测评'],
    replyCount: 2,
    likeCount: 14,
    pinnedAt: mockNow.subtract(const Duration(hours: 3)),
    createdAt: mockNow.subtract(const Duration(hours: 8)),
    updatedAt: mockNow.subtract(const Duration(hours: 3)),
  ),
  ForumPost(
    id: 'fp-1002',
    boardId: 'fb-study',
    boardName: '学习交流',
    title: '求《数据结构》期末复习资料',
    body: '想找往年的期末卷子和课件整理，有同学愿意分享一下吗？',
    author: AnonymousAuthor(mockAnonymousStudy),
    status: ForumPostStatus.published,
    tags: const <String>['期末'],
    replyCount: 2,
    likeCount: 6,
    createdAt: mockNow.subtract(const Duration(hours: 6)),
  ),
  ForumPost(
    id: 'fp-1003',
    boardId: 'fb-campus',
    boardName: '校园生活',
    title: '图书馆 4 楼空调太冷，有人一起反映吗',
    body: '靠窗那排下午基本不能坐，穿外套也顶不住。',
    author: AnonymousAuthor(mockAnonymousDuck),
    status: ForumPostStatus.published,
    tags: const <String>['图书馆'],
    replyCount: 1,
    likeCount: 9,
    createdAt: mockNow.subtract(const Duration(hours: 5)),
  ),
  ForumPost(
    id: 'fp-1004',
    boardId: 'fb-club',
    boardName: '社团活动',
    title: '天文社本周六观测活动报名',
    body: '本周六 19:00 在体育馆北侧草坪，自带保温杯。遇雨顺延。',
    author: const RealAuthor(userId: 'u-2004', name: '天文社'),
    status: ForumPostStatus.published,
    tags: const <String>['社团', '活动'],
    replyCount: 0,
    likeCount: 21,
    createdAt: mockNow.subtract(const Duration(hours: 4)),
  ),
  ForumPost(
    id: 'fp-1005',
    boardId: 'fb-study',
    boardName: '学习交流',
    title: '（已锁定）关于选课系统的吐槽集中帖',
    body: '本贴已由版主锁定，不再接受新回复。',
    author: const RealAuthor(userId: 'u-2005', name: '版主小鸭'),
    status: ForumPostStatus.locked,
    tags: const <String>['选课'],
    replyCount: 1,
    likeCount: 3,
    createdAt: mockNow.subtract(const Duration(days: 1, hours: 2)),
  ),
  ForumPost(
    id: 'fp-1006',
    boardId: 'fb-campus',
    boardName: '校园生活',
    title: '校园卡充值机位置汇总',
    body: '一食堂、二食堂、图书馆一楼、行政楼大厅各有一台。',
    author: const RealAuthor(userId: 'u-2006', name: '热心同学'),
    status: ForumPostStatus.published,
    tags: const <String>['校园卡'],
    replyCount: 0,
    likeCount: 5,
    createdAt: mockNow.subtract(const Duration(days: 2)),
  ),
  ForumPost(
    id: 'fp-1007',
    boardId: 'fb-campus',
    boardName: '校园生活',
    title: '（已被举报隐藏）出售内部资料',
    body: '这条内容已被 3 个不同用户举报并自动隐藏（契约 §2.4 治理规则）。',
    author: const RealAuthor(userId: 'u-2007', name: '可疑账号'),
    status: ForumPostStatus.hidden,
    tags: const <String>[],
    replyCount: 0,
    likeCount: 0,
    createdAt: mockNow.subtract(const Duration(hours: 1)),
  ),
];

/// 每个主题的回复（key = postId）。
final Map<String, List<ForumReply>> mockForumReplies =
    <String, List<ForumReply>>{
  'fp-1001': <ForumReply>[
    ForumReply(
      id: 'fr-2001',
      postId: 'fp-1001',
      body: '昨天去吃了，确实比二楼快。',
      author: const RealAuthor(userId: 'u-3001', name: '午饭困难户'),
      createdAt: mockNow.subtract(const Duration(hours: 7)),
    ),
    ForumReply(
      id: 'fr-2002',
      postId: 'fp-1001',
      body: '请问支持校园卡吗？',
      author: AnonymousAuthor(
          AnonymousIdentity.derive(boardId: 'fb-campus', sequence: 11)),
      createdAt: mockNow.subtract(const Duration(hours: 6)),
    ),
  ],
  'fp-1002': <ForumReply>[
    ForumReply(
      id: 'fr-2003',
      postId: 'fp-1002',
      body: '我这里有去年的卷子，稍后整理一份。',
      author: const RealAuthor(userId: 'u-3002', name: '学长鸭'),
      createdAt: mockNow.subtract(const Duration(hours: 5)),
    ),
    ForumReply(
      id: 'fr-2004',
      postId: 'fp-1002',
      body: '同求，可以一起自习。',
      author: AnonymousAuthor(
          AnonymousIdentity.derive(boardId: 'fb-study', sequence: 9)),
      parentReplyId: 'fr-2003',
      createdAt: mockNow.subtract(const Duration(hours: 4)),
    ),
  ],
  'fp-1003': <ForumReply>[
    ForumReply(
      id: 'fr-2005',
      postId: 'fp-1003',
      body: '已经在一楼服务台反映过了，说会调。',
      author: const RealAuthor(userId: 'u-3003', name: '常驻图书馆'),
      createdAt: mockNow.subtract(const Duration(hours: 4)),
    ),
  ],
  'fp-1005': <ForumReply>[
    ForumReply(
      id: 'fr-2006',
      postId: 'fp-1005',
      body: '锁定前留个脚印。',
      author: const RealAuthor(userId: 'u-3004', name: '路人甲'),
      createdAt: mockNow.subtract(const Duration(days: 1, hours: 1)),
    ),
  ],
};

/// FAQ 分类。
final List<FaqCategory> mockFaqCategories = <FaqCategory>[
  const FaqCategory(
    id: 'fc-account',
    slug: 'account',
    name: '账号与登录',
    description: '统一身份认证、登录失效、绑定问题。',
    articleCount: 3,
  ),
  const FaqCategory(
    id: 'fc-module',
    slug: 'module',
    name: '功能使用',
    description: '各业务模块怎么用、为什么用不了。',
    articleCount: 3,
  ),
  const FaqCategory(
    id: 'fc-privacy',
    slug: 'privacy',
    name: '隐私与安全',
    description: '数据怎么存、匿名是怎么做的、怎么撤回同意。',
    articleCount: 2,
  ),
  const FaqCategory(
    id: 'fc-other',
    slug: 'other',
    name: '其它',
    description: '没有找到答案？在这里提交工单。',
    articleCount: 0,
  ),
];

/// FAQ 文章（含一条草稿，用来验证"草稿不出现在列表里"）。
final List<FaqArticle> mockFaqArticles = <FaqArticle>[
  FaqArticle(
    id: 'fa-1001',
    slug: 'how-to-login',
    question: '怎么用上科大统一身份认证登录？',
    answer: '在「我的」页点「登录」，会拉起学校的统一身份认证页面。\n\n'
        '登录后可达鸭只保存自己的 JWT，**不会**保存学校的密码。',
    category: 'fc-account',
    tags: const <String>['登录'],
    helpfulCount: 42,
    updatedAt: mockNow.subtract(const Duration(days: 3)),
  ),
  FaqArticle(
    id: 'fa-1002',
    slug: 'why-cas-failed',
    question: '登录时提示「授权失败」怎么办？',
    answer: '通常是会话过期。请完全退出 App 后重试；仍然失败请联系我们。',
    category: 'fc-account',
    tags: const <String>['登录', '故障'],
    helpfulCount: 8,
    unhelpfulCount: 3,
    updatedAt: mockNow.subtract(const Duration(days: 5)),
  ),
  FaqArticle(
    id: 'fa-1003',
    slug: 'campus-binding-required',
    question: '为什么提示「请先绑定校园系统」？',
    answer: '可达鸭把身份和校园系统能力分成两层：登录只解决"你是谁"，'
        '课表/一卡通这类功能还需要单独绑定。未绑定时这些功能会返回 '
        '`CAMPUS_BINDING_REQUIRED`，其它功能不受影响。',
    category: 'fc-account',
    tags: const <String>['绑定'],
    helpfulCount: 19,
    updatedAt: mockNow.subtract(const Duration(days: 2)),
  ),
  FaqArticle(
    id: 'fa-1004',
    slug: 'anonymous-posting',
    question: '论坛匿名发帖，别人能查到我是谁吗？',
    answer: '匿名后你的实名身份不会与帖子关联：帖子只带一个版块内稳定的匿名身份，'
        '普通用户看不到任何实名信息。同一匿名身份在版块内可被版主追溯（用于治理），'
        '该映射由服务端持有，客户端不持有。',
    category: 'fc-privacy',
    tags: const <String>['匿名'],
    helpfulCount: 63,
    updatedAt: mockNow.subtract(const Duration(days: 1)),
  ),
  FaqArticle(
    id: 'fa-1005',
    slug: 'helpful-idempotent',
    question: '「有用」按钮点两次会算两次吗？',
    answer: '不会。同一个用户重复点击只计一次，第二次点击会提示你已经标记过。',
    category: 'fc-module',
    tags: const <String>['FAQ'],
    helpfulCount: 11,
    updatedAt: mockNow.subtract(const Duration(days: 6)),
  ),
  FaqArticle(
    id: 'fa-1006',
    slug: 'how-to-submit-ticket',
    question: '怎么提交工单？多久会回复？',
    answer: '在「常见问题 → 我的工单」里提交。请留邮箱或微信号，'
        '**不要填手机号**（我们不会存明文手机号）。一般 1–2 个工作日回复。',
    category: 'fc-module',
    tags: const <String>['工单'],
    helpfulCount: 5,
    updatedAt: mockNow.subtract(const Duration(hours: 20)),
  ),
  FaqArticle(
    id: 'fa-1007',
    slug: 'third-party-notice',
    question: '可达鸭是学校官方系统吗？',
    answer: '不是。可达鸭是学生社区维护的**第三方非官方**平台，与上海科技大学官方系统无关。'
        '涉及学籍、缴费等正式事项请以学校官方渠道为准。',
    category: 'fc-other',
    tags: const <String>['声明'],
    helpfulCount: 27,
    updatedAt: mockNow.subtract(const Duration(days: 10)),
  ),
  FaqArticle(
    id: 'fa-1008',
    slug: 'draft-example',
    question: '（草稿）这条不该出现在列表里',
    answer: '状态为 DRAFT 的文章对普通用户不可见。',
    category: 'fc-other',
    status: FaqArticleStatus.draft,
    helpfulCount: 0,
    updatedAt: mockNow,
  ),
];

/// 「我的工单」（未登录也能提交，此时 `userId` 为 null）。
final List<FaqTicket> mockFaqTickets = <FaqTicket>[
  FaqTicket(
    id: 'ft-3001',
    userId: mockUser.userId,
    contact: 'test@shanghaitech.edu.cn',
    question: '拼单成团后没有收到通知，是我设置的问题吗？',
    status: FaqTicketStatus.answered,
    answer: '目前推送还未接入，成团后请回拼单详情页查看进度。',
    createdAt: mockNow.subtract(const Duration(days: 2)),
    answeredAt: mockNow.subtract(const Duration(days: 1, hours: 20)),
  ),
  FaqTicket(
    id: 'ft-3002',
    userId: mockUser.userId,
    contact: 'wechat: keda_duck',
    question: '希望论坛支持按标签筛选。',
    status: FaqTicketStatus.open,
    createdAt: mockNow.subtract(const Duration(hours: 6)),
  ),
  FaqTicket(
    id: 'ft-3003',
    userId: mockUser.userId,
    contact: 'test@shanghaitech.edu.cn',
    question: '「有用」按钮我点了好几次，计数只加了 1，是 bug 吗？',
    status: FaqTicketStatus.closed,
    answer: '这是有意为之的幂等设计：同一用户重复点击只算一次。',
    createdAt: mockNow.subtract(const Duration(days: 6)),
    answeredAt: mockNow.subtract(const Duration(days: 5, hours: 20)),
    closedAt: mockNow.subtract(const Duration(days: 5)),
  ),
];

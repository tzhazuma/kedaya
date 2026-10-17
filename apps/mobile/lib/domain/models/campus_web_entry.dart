import 'json_read.dart';
import 'techpie_link.dart';

/// ⚠️ **白名单内容是占位**（契约 §11.18-B 第 2 条）。
///
/// U11「校园系统域名白名单的内容是什么」**至今未关闭** —— 需要列举
/// `*.shanghaitech.edu.cn` 下的实际域名。因此这里与 `CAMPUS_ORIGIN`、
/// `CAMPUS_LOCATIONS` 同一处理：给出合理占位，并把"这是占位"做成**机器可见**的常量。
/// 替换白名单时必须同时把本常量改为 `false`。
const bool campusDomainAllowlistIsPlaceholder = true;

/// 校园系统域名白名单。
///
/// **fail-closed**（契约 §11.18-B 第 1 条）：**精确匹配**，不做后缀通配。
/// 「通配整个 `shanghaitech.edu.cn`」等于没有白名单，还会放行任意（可能已被攻陷的）子域。
///
/// ⚠️ 客户端这份名单只是**提前拦截**，服务端**必须再校验一次** ——
/// 客户端传入的 `targetUrl` 一律不可信（契约 §11.18-B 第 4 条）。
const List<String> campusDomainAllowlist = <String>[
  'ecourse.shanghaitech.edu.cn',
  'egate.shanghaitech.edu.cn',
  'ecard.shanghaitech.edu.cn',
  'elrc.shanghaitech.edu.cn',
  'oa.shanghaitech.edu.cn',
  'acm.shanghaitech.edu.cn',
  'student.shanghaitech.edu.cn',
];

final RegExp _ipv4Literal = RegExp(r'^\d{1,3}(\.\d{1,3}){3}$');

/// 是不是 IP 字面量（IPv4 点分 / IPv6 含冒号）。
///
/// IPv6 在 [Uri.host] 里可能带方括号，因此两条判据都查。
bool _looksLikeIpLiteral(String host) =>
    _ipv4Literal.hasMatch(host) || host.contains(':');

/// 校验一个校园系统目标 URL，返回**拒绝原因**；`null` 表示通过。
///
/// 规则逐条来自契约 §11.18-B 第 3 条（顺序即优先级，先报最明确的错）：
///
/// | # | 规则 | 为什么 |
/// | --- | --- | --- |
/// | 1 | 必须是合法 URL | 解析不了就不放行 |
/// | 2 | 只允许 `https` | 禁止 `http` 明文 |
/// | 3 | 禁止 userinfo | `https://shanghaitech.edu.cn@evil.com` 是经典绕过 |
/// | 4 | 必须有 host | 空 host 不能通过白名单 |
/// | 5 | 禁止 IP 字面量 | 白名单是域名，不是地址 |
/// | 6 | 禁止非 443 端口 | 端口是白名单之外的第二条逃逸路径 |
/// | 7 | host 必须在白名单内（精确匹配） | fail-closed |
String? campusTargetUrlProblem(String targetUrl) {
  final Uri? uri = Uri.tryParse(targetUrl.trim());
  if (uri == null || !uri.hasScheme) return '目标地址不是合法 URL';
  if (uri.scheme.toLowerCase() != 'https') return '只允许 https 的校园系统地址';
  if (uri.userInfo.isNotEmpty) {
    return '地址里不允许出现 userinfo（防 https://host@evil.com 绕过）';
  }
  final String host = uri.host.toLowerCase();
  if (host.isEmpty) return '目标地址缺少 host';
  if (_looksLikeIpLiteral(host)) return '不允许 IP 字面量';
  if (uri.port != 443) return '不允许非 443 端口';
  if (!campusDomainAllowlist.contains(host)) {
    return '不在校园域名白名单内（fail-closed，不做后缀通配）';
  }
  return null;
}

/// 一个"直连校园系统"的 WebView 入口（E云课堂 / 学生请假 / 学生活动 / 课程录播）。
///
/// Phase 0 走规格 §8.4 的 **W4**：让用户在校园系统页面**自己登录**，
/// 我们**不接触** cookie（也**不做** cookie 注入 —— 那需要信息办书面确认）。
final class CampusWebEntry {
  const CampusWebEntry({
    required this.id,
    required this.title,
    required this.description,
    required this.platform,
    required this.targetUrl,
    this.requiresBinding = false,
  });

  factory CampusWebEntry.fromJson(Map<String, Object?> json) {
    final String rawPlatform = readString(json, 'platform');
    final CampusPlatform? platform = CampusPlatform.fromWire(rawPlatform);
    if (platform == null) {
      throw FormatException('CampusWebEntry: 未知校园平台 "$rawPlatform"');
    }
    return CampusWebEntry(
      id: readString(json, 'id'),
      title: readString(json, 'title'),
      description: readStringOr(json, 'description', ''),
      platform: platform,
      targetUrl: readString(json, 'targetUrl'),
      requiresBinding: readBoolOr(json, 'requiresBinding', false),
    );
  }

  final String id;
  final String title;
  final String description;

  /// 该入口**展示上**归属哪个平台。
  ///
  /// ⚠️ 注意它与 [requiresBinding] 是两件事：`services/api` 的能力清单里，
  /// 四个 WebView 入口的 `platform` 是 **null**（`access: 'webview'`），
  /// 即"外部链接本身不需要绑定"。见 [requiresBinding]。
  final CampusPlatform platform;

  /// 目标地址（服务端仍需按同一套规则再校验一次）。
  final String targetUrl;

  /// 打开该入口时**是否要求平台已绑定**。
  ///
  /// Phase 0 的四个入口都是 `false`（规格 §8.4 的 **W4**：用户在校园系统页面自己登录，
  /// 我们不接触会话）。这与 `services/api` 的 `resolvePlatform()` 一致 ——
  /// 不传 `platform` 时服务端**不要求**绑定；传了才要求 `LINKED`（否则 409）。
  final bool requiresBinding;

  /// 客户端预校验结果（`null` = 通过）。
  ///
  /// UI 据此在**发请求之前**就拒绝，避免把明显非法的地址送去上游。
  String? get targetUrlProblem => campusTargetUrlProblem(targetUrl);

  bool get isTargetUrlAllowed => targetUrlProblem == null;

  Map<String, Object?> toJson() => <String, Object?>{
        'id': id,
        'title': title,
        'description': description,
        'platform': platform.wire,
        'targetUrl': targetUrl,
        'requiresBinding': requiresBinding,
      };

  @override
  bool operator ==(Object other) =>
      other is CampusWebEntry &&
      other.id == id &&
      other.title == title &&
      other.description == description &&
      other.platform == platform &&
      other.targetUrl == targetUrl &&
      other.requiresBinding == requiresBinding;

  @override
  int get hashCode =>
      Object.hash(id, title, description, platform, targetUrl, requiresBinding);

  @override
  String toString() => 'CampusWebEntry($id, ${platform.wire})';
}

/// 一次性 WebView 票据（规格 §8.4）。
///
/// 语义逐条来自 §8.4 的"票据语义"表：
///
/// | 属性 | 值 |
/// | --- | --- |
/// | 一次性 | 用后即焚，防重放 |
/// | 短时效 | 默认 **30 秒** |
/// | 绑定 host | 服务端签发时绑定 `targetUrl` 的 host |
/// | **不含 cookie** | 票据是**引用**，不是凭证 —— 客户端从未拿到 cookie |
///
/// [toString] 必须脱敏：票据值绝不进日志、错误信息或崩溃上报（规格 §10.3）。
final class WebViewTicket {
  const WebViewTicket({
    required this.ticket,
    required this.expiresInSec,
    required this.targetUrl,
    required this.platform,
  });

  /// 解析服务端响应。
  ///
  /// ⚠️ 规格 §8.4 的响应示例**只有** `ticket` / `expiresInSec` / `targetUrl`，
  /// **没有** `platform`。因此这里允许调用方（它当然知道自己请求的是哪个平台）
  /// 通过 [platform] 补上；响应里若带了 `platform` 则以响应为准。
  factory WebViewTicket.fromJson(
    Map<String, Object?> json, {
    CampusPlatform? platform,
  }) {
    final String? rawPlatform = readStringOrNull(json, 'platform');
    final CampusPlatform? resolved = rawPlatform == null || rawPlatform.isEmpty
        ? platform
        : CampusPlatform.fromWire(rawPlatform);
    return WebViewTicket(
      ticket: readString(json, 'ticket'),
      expiresInSec: readIntOr(json, 'expiresInSec', defaultTicketTtlSec),
      targetUrl: readString(json, 'targetUrl'),
      platform: resolved,
    );
  }

  /// 规格 §8.4 的固定时效：30 秒。
  static const int defaultTicketTtlSec = 30;

  /// 票据值本身。**只在换取一次性中转 URL 时使用一次**。
  final String ticket;

  final int expiresInSec;
  final String targetUrl;

  /// 该票据关联的平台；**可以为 null**（Phase 0 的 W4 直连不指定平台，
  /// 服务端因此不要求绑定 —— 见 `services/api` 的 `resolvePlatform`）。
  final CampusPlatform? platform;

  DateTime expiresAtFrom(DateTime issuedAt) =>
      issuedAt.toUtc().add(Duration(seconds: expiresInSec));

  bool isExpiredAt(DateTime issuedAt, DateTime now) =>
      !now.toUtc().isBefore(expiresAtFrom(issuedAt));

  Map<String, Object?> toJson() => <String, Object?>{
        'ticket': ticket,
        'expiresInSec': expiresInSec,
        'targetUrl': targetUrl,
        'platform': platform?.wire,
      };

  @override
  bool operator ==(Object other) =>
      other is WebViewTicket &&
      other.ticket == ticket &&
      other.expiresInSec == expiresInSec &&
      other.targetUrl == targetUrl &&
      other.platform == platform;

  @override
  int get hashCode => Object.hash(ticket, expiresInSec, targetUrl, platform);

  /// ⚠️ **票据脱敏**：这里刻意不打 [ticket] 的值。
  @override
  String toString() =>
      'WebViewTicket(${platform?.wire ?? 'none'}, expiresInSec=$expiresInSec, '
      'targetUrl=$targetUrl, ticket=<redacted>)';
}

/// 用票据换来的**一次性中转 URL**（规格 §8.4 的"换取方式"）。
///
/// [url] 里含票据引用，因此：
///   - 只允许立刻交给 `WebViewPort.openOneTimeUrl`；
///   - **不进入任何上抛对象**（[WebViewLaunchOutcome] 刻意没有 URL 字段）；
///   - [toString] 把它脱敏。
final class WebViewHandoff {
  const WebViewHandoff({
    required this.url,
    required this.targetUrl,
    required this.expiresAt,
  });

  /// 解析服务端响应。
  ///
  /// ⚠️ **这是客户端侧的形状假设**：规格 §8.4 只说了"服务端返回一个一次性 URL"，
  /// 没有给出该响应的字段名。本端按 `{ url, targetUrl, expiresAt }` 解析，
  /// 并已把它登记进交付说明（需后端确认）。
  factory WebViewHandoff.fromJson(
    Map<String, Object?> json, {
    required DateTime fallbackExpiresAt,
    String? targetUrl,
  }) =>
      WebViewHandoff(
        url: readString(json, 'url'),
        targetUrl: readStringOr(json, 'targetUrl', targetUrl ?? ''),
        // ⚠️ Phase 0（W4 直连）下服务端返回 `expiresAt: null` —— 此时用**票据自身的时效**
        // 兜底，绝不放宽成"永不过期"（宁可让用户重试一次）。
        expiresAt: readDateTimeOrNull(json, 'expiresAt') ?? fallbackExpiresAt,
      );

  final String url;
  final String targetUrl;
  final DateTime expiresAt;

  bool isExpiredAt(DateTime now) => !now.toUtc().isBefore(expiresAt.toUtc());

  Map<String, Object?> toJson() => <String, Object?>{
        'url': url,
        'targetUrl': targetUrl,
        'expiresAt': isoUtc(expiresAt),
      };

  @override
  String toString() =>
      'WebViewHandoff(targetUrl=$targetUrl, expiresAt=${isoUtc(expiresAt)}, '
      'url=<redacted>)';
}

/// 一次"打开校园系统"的结局。
enum WebViewLaunchStatus {
  opened('OPENED'),
  targetRejected('TARGET_REJECTED'),
  ticketUnavailable('TICKET_UNAVAILABLE'),
  handoffFailed('HANDOFF_FAILED');

  const WebViewLaunchStatus(this.wire);

  final String wire;

  bool get isOpened => this == WebViewLaunchStatus.opened;
}

/// 一次"打开校园系统"的结果。
///
/// ⚠️ **刻意不含票据、也不含中转 URL 字段** —— 票据用后即焚，
/// 一旦它出现在上抛对象里，UI 状态就会缓存它。这里只有状态、入口与脱敏后的原因。
final class WebViewLaunchOutcome {
  const WebViewLaunchOutcome({
    required this.status,
    required this.entry,
    this.problem,
  });

  final WebViewLaunchStatus status;
  final CampusWebEntry entry;

  /// 失败/拒绝的原因。**绝不包含票据或中转 URL**。
  final String? problem;

  bool get isOpened => status.isOpened;

  @override
  String toString() => 'WebViewLaunchOutcome(${status.wire}, entry=${entry.id}'
      '${problem == null ? '' : ', problem=$problem'})';
}

/// ⚠️ **入口目录与目标地址都是占位**（与 [campusDomainAllowlistIsPlaceholder] 同源：
/// U11「`*.shanghaitech.edu.cn` 下的实际域名」未关闭）。
///
/// 这个常量是**机器可见**的占位标记：确认实际域名后必须同时改为 `false`。
const bool phase0CampusWebEntriesArePlaceholder = true;

/// Phase 0 的四个直连入口（规格 §9.1：E云课堂 / 学生请假 / 学生活动 / 课程录播）。
///
/// 为什么放在 `domain` 而不是 mock 里：这是**客户端侧的能力目录**
/// （与 `kedayaModules` 同类），真实运行时的 WebView 页面也用它渲染入口；
/// 服务端仍必须按同一套白名单规则**再校验一次** `targetUrl`。
///
/// ⚠️ 端口一律 **443**：规格 §8.4 的示例写了 `https://ecourse.shanghaitech.edu.cn:8080/`，
/// 但契约 §11.18-B 第 3 条明确**禁止非 443 端口**。裁决晚于规格，因此以裁决为准，
/// 这里不放 `:8080`（该冲突已登记进交付说明）。
const List<CampusWebEntry> phase0CampusWebEntries = <CampusWebEntry>[
  CampusWebEntry(
    id: 'ecourse',
    title: 'E云课堂',
    description: '课程资料与回放。进入后请用学校账号**自行登录**（Phase 0 不做会话注入）。',
    platform: CampusPlatform.cpdaily,
    targetUrl: 'https://ecourse.shanghaitech.edu.cn/',
    requiresBinding: false,
  ),
  CampusWebEntry(
    id: 'leave',
    title: '学生请假',
    description: '请假申请与审批进度。进入后请用学校账号自行登录。',
    platform: CampusPlatform.cpdaily,
    targetUrl: 'https://student.shanghaitech.edu.cn/',
    requiresBinding: false,
  ),
  CampusWebEntry(
    id: 'activity',
    title: '学生活动',
    description: '活动报名与签到。进入后请用学校账号自行登录。',
    platform: CampusPlatform.cpdaily,
    targetUrl: 'https://student.shanghaitech.edu.cn/activity',
    requiresBinding: false,
  ),
  CampusWebEntry(
    id: 'elrc',
    title: '课程录播',
    description: '录播回看（纯外链，无任何会话注入）。',
    platform: CampusPlatform.cpdaily,
    targetUrl: 'https://elrc.shanghaitech.edu.cn/',
    requiresBinding: false,
  ),
];

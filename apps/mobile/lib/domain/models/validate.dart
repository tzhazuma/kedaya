/// 上科大身份校验（镜像 `packages/shared/src/validate.ts`）。
///
/// ⚠️ 这些规则是**前端预校验**，用于即时反馈；权威校验在后端。
/// 学校域名/学号规则变化时，先改 `packages/shared`，再同步本文件。
library;

/// 上科大邮箱域名白名单（学生 + 教工）。
const List<String> shanghaitechEmailDomains = <String>[
  'shanghaitech.edu.cn',
  'stu.shanghaitech.edu.cn',
];

/// 是否上科大邮箱。
bool isShanghaiTechEmail(String email) {
  final int at = email.lastIndexOf('@');
  if (at <= 0 || at == email.length - 1) return false;
  return shanghaitechEmailDomains
      .contains(email.substring(at + 1).toLowerCase());
}

/// 取邮箱域名部分，非法返回 null。
String? emailDomain(String email) {
  final int at = email.lastIndexOf('@');
  if (at <= 0 || at == email.length - 1) return null;
  return email.substring(at + 1).toLowerCase();
}

final RegExp _studentIdPattern = RegExp(r'^\d{8}$');
final RegExp _chinaMobilePattern = RegExp(r'^1[3-9]\d{9}$');
final RegExp _mobileInText = RegExp(r'1[3-9]\d{9}');
final RegExp _idCardInText = RegExp(r'\b\d{17}[\dXx]\b');
final RegExp _studentIdInText = RegExp(r'\b\d{8}\b');
final RegExp _emailInText = RegExp(r'[\w.+-]+@[\w-]+\.[\w.]+');

/// 学号粗校验：上科大学号为 8 位数字（启发式，真实规则由教务系统决定）。
bool isStudentId(String value) => _studentIdPattern.hasMatch(value.trim());

/// 手机号（中国大陆）。
bool isChinaMobile(String value) => _chinaMobilePattern.hasMatch(value.trim());

/// 是否疑似含敏感个人信息（前端提示用，**不是**安全边界）。
bool containsLikelyPii(String text) =>
    _mobileInText.hasMatch(text) ||
    _idCardInText.hasMatch(text) ||
    _studentIdInText.hasMatch(text) ||
    _emailInText.hasMatch(text);

/// 昵称/标题长度校验（按 Unicode 码点计数，与 TS 的 `[...value]` 一致）。
bool isLengthWithin(String value, int min, int max) {
  final int length = value.trim().runes.length;
  return length >= min && length <= max;
}

final RegExp _nonWord = RegExp(r'[^\w\s-]');
final RegExp _spacesAndUnderscore = RegExp(r'[\s_]+');
final RegExp _dashRun = RegExp(r'-+');
final RegExp _edgeDash = RegExp(r'^-|-$');

/// 生成 URL 友好的 slug（中文会被剔除，因此结果可能为空）。
String slugify(String input) => input
    .trim()
    .toLowerCase()
    .replaceAll(_nonWord, '')
    .replaceAll(_spacesAndUnderscore, '-')
    .replaceAll(_dashRun, '-')
    .replaceAll(_edgeDash, '');

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""可达鸭 Flutter 端 · 静态自检（替代验证）

本机**没有 Flutter SDK**（`flutter` / `dart` 都不存在），因此 `flutter analyze`
跑不了。这个脚本用纯文本分析覆盖能在本机验证的那部分：

  1. 相对 import 是否可解析（目标文件存在）
  2. 括号 / 花括号 / 方括号是否平衡（忽略字符串与注释）
  3. directives_ordering（dart: / package: / 相对 三组 + 组内字母序）
  4. 是否有未使用的 dart: 库 import
  5. 是否有 TODO / FIXME 占位
  6. 是否有硬编码 Color(0x…)（生成物 kedaya_tokens.dart 除外）
  7. domain 层是否 import 了框架（flutter / dio / riverpod …）
  8. application 层是否泄漏了 Ref（把 Ref 当字段/构造参数持有）

用法：
    /opt/homebrew/bin/python3 tool/selfcheck.py            # 检查 lib/ 与 test/
    /opt/homebrew/bin/python3 tool/selfcheck.py --verbose

退出码：0 = 全部通过；1 = 有违规项。
"""

from __future__ import annotations

import argparse
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 生成物：由 `npm run tokens` 同步，允许（也必须）出现 Color(0x…) 字面量。
GENERATED_ALLOWLIST = {
    os.path.join('lib', 'presentation', 'theme', 'kedaya_tokens.dart'),
}

# 契约 §7 硬规则 1：domain 层零框架依赖（只允许 dart:core + 自有模型）。
DOMAIN_ALLOWED_DART_LIBS = {'dart:core'}

# dart: 库 -> 该库导出的符号（用来判断 import 是否真的被用到）。
DART_LIB_SYMBOLS = {
    'dart:async': [
        'unawaited', 'StreamSubscription', 'Completer', 'Timer', 'StreamController',
        'scheduleMicrotask', 'StreamTransformer', 'Zone', 'FutureOr',
    ],
    'dart:convert': [
        'jsonDecode', 'jsonEncode', 'utf8', 'base64', 'JsonEncoder', 'JsonDecoder',
        'LineSplitter', 'ascii', 'latin1',
    ],
    'dart:math': ['Random', 'sqrt', 'pow', 'max(', 'min(', 'pi', 'sin(', 'cos(', 'log('],
    'dart:io': ['File', 'Directory', 'Platform', 'HttpClient', 'Socket', 'stdout', 'stderr'],
    'dart:typed_data': ['Uint8List', 'ByteData', 'ByteBuffer', 'Int8List', 'Float64List'],
    'dart:collection': [
        'LinkedHashMap', 'HashMap', 'Queue', 'SplayTreeMap', 'UnmodifiableListView',
        'ListQueue', 'LinkedHashSet',
    ],
    'dart:ui': ['Offset', 'Rect', 'Size', 'Color', 'Image', 'Canvas', 'Paint'],
}

IMPORT_RE = re.compile(r"""^\s*import\s+['"](?P<uri>[^'"]+)['"]""")
PART_RE = re.compile(r"""^\s*(part|export)\s+['"](?P<uri>[^'"]+)['"]""")
COLOR_LITERAL_RE = re.compile(r'Color\(\s*0x[0-9a-fA-F]{6,8}\s*\)')
TODO_RE = re.compile(r'\b(TODO|FIXME|XXX|HACK)\b')
# application 层不得把 Ref 当字段/构造参数持有（provider 体内用 ref 是允许的）。
REF_LEAK_RES = [
    re.compile(r'\b(final|late\s+final|var)?\s*\bRef\b\s+\w+\s*[;=]'),
    re.compile(r'\bRef\??\s+\w+\s*[,)]'),
    re.compile(r'\bthis\.ref\b'),
    re.compile(r'\brequired\s+this\.ref\b'),
]


class Finding:
    def __init__(self, check: str, path: str, line: int, message: str) -> None:
        self.check = check
        self.path = path
        self.line = line
        self.message = message

    def render(self) -> str:
        return f'  [{self.check}] {self.path}:{self.line}  {self.message}'


def dart_files(roots: list[str]) -> list[str]:
    out: list[str] = []
    for root in roots:
        for dirpath, dirnames, filenames in os.walk(os.path.join(ROOT, root)):
            dirnames[:] = [d for d in dirnames if d not in ('.dart_tool', 'build')]
            for name in sorted(filenames):
                if name.endswith('.dart'):
                    out.append(os.path.relpath(os.path.join(dirpath, name), ROOT))
    return sorted(out)


def read(path: str) -> str:
    with open(os.path.join(ROOT, path), 'r', encoding='utf-8') as handle:
        return handle.read()


def strip_strings_and_comments(source: str) -> str:
    """把字符串字面量与注释替换成等长空白，保留换行，供括号平衡检查使用。"""
    out: list[str] = []
    i = 0
    n = len(source)
    while i < n:
        ch = source[i]
        # 行注释
        if ch == '/' and i + 1 < n and source[i + 1] == '/':
            while i < n and source[i] != '\n':
                out.append(' ')
                i += 1
            continue
        # 块注释（Dart 支持嵌套）
        if ch == '/' and i + 1 < n and source[i + 1] == '*':
            depth = 0
            while i < n:
                if source[i] == '/' and i + 1 < n and source[i + 1] == '*':
                    depth += 1
                    out.append('  ')
                    i += 2
                    continue
                if source[i] == '*' and i + 1 < n and source[i + 1] == '/':
                    depth -= 1
                    out.append('  ')
                    i += 2
                    if depth == 0:
                        break
                    continue
                out.append('\n' if source[i] == '\n' else ' ')
                i += 1
            continue
        # 三引号字符串
        if ch in ('"', "'") and source[i:i + 3] in ('"""', "'''"):
            quote = source[i:i + 3]
            out.append('   ')
            i += 3
            while i < n and source[i:i + 3] != quote:
                out.append('\n' if source[i] == '\n' else ' ')
                i += 1
            out.append('   ')
            i += 3
            continue
        # 单引号字符串（含 r'' 原始串）
        if ch in ('"', "'"):
            quote = ch
            out.append(' ')
            i += 1
            while i < n and source[i] != quote:
                if source[i] == '\\':
                    out.append(' ')
                    i += 1
                    if i < n:
                        out.append('\n' if source[i] == '\n' else ' ')
                        i += 1
                    continue
                if source[i] == '\n':  # 未闭合字符串：交给括号检查去报错
                    break
                out.append(' ')
                i += 1
            out.append(' ')
            i += 1
            continue
        # 字符串插值 ${...} 里的括号必须保留，这里简化处理：整串按普通字符保留
        out.append(ch)
        i += 1
    return ''.join(out)


def check_imports_resolve(path: str, source: str) -> list[Finding]:
    findings: list[Finding] = []
    base = os.path.dirname(os.path.join(ROOT, path))
    for lineno, line in enumerate(source.splitlines(), start=1):
        match = IMPORT_RE.match(line) or PART_RE.match(line)
        if not match:
            continue
        uri = match.group('uri')
        if uri.startswith('package:kedaya/'):
            # 本包内的 package: import 也要能落到真实文件上（打错路径 analyze 会报错）。
            target = os.path.normpath(
                os.path.join('lib', uri[len('package:kedaya/'):])
            )
            if not os.path.exists(os.path.join(ROOT, target)):
                findings.append(
                    Finding('import-resolve', path, lineno, f'package: import 目标不存在: {uri}')
                )
            continue
        if uri.startswith('dart:') or uri.startswith('package:'):
            continue
        target = os.path.normpath(os.path.join(base, uri))
        if not os.path.exists(target):
            findings.append(
                Finding('import-resolve', path, lineno, f'相对 import 目标不存在: {uri}')
            )
    return findings


def check_balanced(path: str, source: str) -> list[Finding]:
    stripped = strip_strings_and_comments(source)
    pairs = {')': '(', ']': '[', '}': '{'}
    stack: list[tuple[str, int]] = []
    line = 1
    for ch in stripped:
        if ch == '\n':
            line += 1
            continue
        if ch in '([{':
            stack.append((ch, line))
            continue
        if ch in ')]}':
            if not stack:
                return [Finding('balanced', path, line, f'多余的闭合符号 "{ch}"')]
            opener, opened_at = stack.pop()
            if opener != pairs[ch]:
                return [
                    Finding(
                        'balanced', path, line,
                        f'"{ch}" 与第 {opened_at} 行的 "{opener}" 不匹配',
                    )
                ]
    if stack:
        opener, opened_at = stack[-1]
        return [Finding('balanced', path, opened_at, f'"{opener}" 未闭合')]
    return []


def import_group(uri: str) -> int:
    if uri.startswith('dart:'):
        return 0
    if uri.startswith('package:'):
        return 1
    return 2


def check_directives_ordering(path: str, source: str) -> list[Finding]:
    findings: list[Finding] = []
    entries: list[tuple[int, int, str]] = []  # (group, lineno, uri)
    for lineno, line in enumerate(source.splitlines(), start=1):
        match = IMPORT_RE.match(line)
        if match:
            entries.append((import_group(match.group('uri')), lineno, match.group('uri')))
    if len(entries) < 2:
        return findings

    groups = [group for group, _, _ in entries]
    if groups != sorted(groups):
        findings.append(
            Finding(
                'directives-ordering', path, entries[0][1],
                'import 分组顺序错误：应为 dart: → package: → 相对路径',
            )
        )

    index = 0
    while index < len(entries):
        group = entries[index][0]
        chunk: list[tuple[int, str]] = []
        while index < len(entries) and entries[index][0] == group:
            chunk.append((entries[index][1], entries[index][2]))
            index += 1
        uris = [uri for _, uri in chunk]
        if uris != sorted(uris):
            for pos in range(1, len(uris)):
                if uris[pos - 1] > uris[pos]:
                    findings.append(
                        Finding(
                            'directives-ordering', path, chunk[pos][0],
                            f'组内字母序错误: "{uris[pos - 1]}" 应排在 "{uris[pos]}" 之后',
                        )
                    )
                    break
    return findings


def check_unused_dart_import(path: str, source: str) -> list[Finding]:
    findings: list[Finding] = []
    body = '\n'.join(
        line for line in source.splitlines() if not IMPORT_RE.match(line)
    )
    for lineno, line in enumerate(source.splitlines(), start=1):
        match = IMPORT_RE.match(line)
        if not match:
            continue
        uri = match.group('uri')
        if uri not in DART_LIB_SYMBOLS:
            continue
        symbols = DART_LIB_SYMBOLS[uri]
        if not any(symbol in body for symbol in symbols):
            findings.append(
                Finding('unused-dart-import', path, lineno, f'"{uri}" 的符号未被使用')
            )
    return findings


# ---------------------------------------------------------------- 未使用 import
#
# `flutter analyze` 会把 unused_import 报成 warning（退出码非 0），本机跑不了
# analyze，所以这里做一个**保守的**文本启发式：
#   - 抽出被 import 文件里的顶层声明名（class / enum / mixin / extension /
#     顶层函数 / 顶层常量）；
#   - extension 额外抽出成员名（`context.kedayaColors` 这类用法不会写出扩展名，
#     只能靠 `.成员名` 判断）；
#   - 只要出现任意一个名字就认为"用到了"，否则报告。
# 宁可漏报也不误报：拿不准的一律不报。

DECL_RES = [
    re.compile(r'^(?:abstract\s+|final\s+|sealed\s+|base\s+|interface\s+)*'
               r'(?:class|enum|mixin|extension)\s+([A-Za-z_]\w*)', re.M),
    re.compile(r'^typedef\s+([A-Za-z_]\w*)', re.M),
    re.compile(r'^(?:[A-Za-z_][\w<>,\?\s]*\s+)?([a-z_]\w*)\s*\(', re.M),
    re.compile(r'^(?:const|final|var)\s+(?:[\w<>,\?\[\]\s]+?\s+)?([a-z_]\w*)\s*=', re.M),
    re.compile(r'^([a-z_]\w*)\s*=', re.M),
]
EXT_MEMBER_RE = re.compile(r'^\s+(?:[\w<>,\?\[\]\s]*\s+)?(?:get\s+)?([a-z_]\w*)\s*(?:=>|\()', re.M)


def declared_names(target: str) -> set[str]:
    """被 import 文件对外暴露的顶层名字（含 extension 成员）。"""
    try:
        source = read(target)
    except OSError:
        return set()
    names: set[str] = set()
    for pattern in DECL_RES:
        names.update(pattern.findall(source))
    # extension 成员：`context.kedayaColors` 这种用法不会写出扩展名。
    if re.search(r'^\s*extension\s+', source, re.M):
        names.update(EXT_MEMBER_RE.findall(source))
    names.discard('library')
    return {name for name in names if len(name) > 2}


def resolve_import(importer: str, uri: str) -> str | None:
    if uri.startswith('package:kedaya/'):
        return os.path.normpath(
            os.path.join('lib', uri[len('package:kedaya/'):])
        ).replace(os.sep, '/')
    if uri.startswith('dart:') or uri.startswith('package:'):
        return None
    base = os.path.dirname(importer)
    return os.path.normpath(os.path.join(base, uri)).replace(os.sep, '/')


# 第三方包的符号清单（本机没有 pub cache，无法从源码抽名字，所以手工登记）。
# 同样遵循"宁可漏报也不误报"：只要出现任意一个 token 就认为用到了。
PACKAGE_SYMBOLS = {
    'package:go_router/go_router.dart': [
        'context.push(', 'context.go(', 'context.pop(', 'GoRouter', 'GoRoute',
        'StatefulShellRoute', 'StatefulShellBranch', 'StatefulNavigationShell',
        'GoRouterState', 'RouteBase', 'NavigatorState',
    ],
    'package:flutter_riverpod/flutter_riverpod.dart': [
        'Provider', 'ref.', 'ConsumerWidget', 'ConsumerStatefulWidget', 'ConsumerState',
        'WidgetRef', 'AsyncValue', 'ProviderContainer', 'Notifier', 'AsyncNotifier',
        'Override', 'AsyncData', 'AsyncLoading', 'ProviderScope',
    ],
    'package:flutter/services.dart': [
        'Clipboard', 'ClipboardData', 'SystemChannels', 'MethodChannel',
    ],
    'package:flutter/foundation.dart': [
        'kDebugMode', 'debugPrint', 'kIsWeb', 'defaultTargetPlatform', 'kReleaseMode',
        'ValueChanged', 'ChangeNotifier', 'immutable', 'listEquals', 'compute',
        'AsyncCallback', 'VoidCallback',
    ],
    # `package:flutter/material.dart` **刻意不检查**：它几乎被每个 widget 文件
    # import，而它 re-export 的符号面太大（ThemeData / ColorScheme / …），
    # 任何不完整的清单都会产生误报。宁可漏报。
    'package:intl/intl.dart': ['DateFormat', 'NumberFormat'],
    'package:shared_preferences/shared_preferences.dart': ['SharedPreferences'],
    'package:dio/dio.dart': ['Dio', 'BaseOptions', 'Interceptor', 'Response'],
    'package:flutter_secure_storage/flutter_secure_storage.dart': ['FlutterSecureStorage'],
    'package:flutter_test/flutter_test.dart': [
        'test(', 'group(', 'expect(', 'WidgetTester', 'testWidgets(', 'setUp(',
        'tearDown(', 'addTearDown(', 'findsOneWidget', 'pumpWidget', 'isA<',
    ],
    'package:collection/collection.dart': [
        'firstOrNull', 'DeepCollectionEquality', 'groupBy',
    ],
}


def check_unused_import(path: str, source: str) -> list[Finding]:
    findings: list[Finding] = []
    body = '\n'.join(
        line for line in source.splitlines() if not IMPORT_RE.match(line)
    )
    for lineno, line in enumerate(source.splitlines(), start=1):
        match = IMPORT_RE.match(line)
        if not match:
            continue
        uri = match.group('uri')
        target = resolve_import(path, uri)
        if target is None:
            tokens = PACKAGE_SYMBOLS.get(uri)
            if tokens and not any(token in body for token in tokens):
                findings.append(
                    Finding(
                        'unused-import', path, lineno,
                        f'"{uri}" 的已知符号在文件里都没出现',
                    )
                )
            continue
        if not os.path.exists(os.path.join(ROOT, target)):
            continue
        names = declared_names(target)
        if not names:
            continue
        if not any(re.search(rf'\b{re.escape(name)}\b', body) for name in names):
            findings.append(
                Finding(
                    'unused-import', path, lineno,
                    f'"{uri}" 的公开名字在文件里都没出现',
                )
            )
    return findings


def check_todo(path: str, source: str) -> list[Finding]:
    findings: list[Finding] = []
    for lineno, line in enumerate(source.splitlines(), start=1):
        if TODO_RE.search(line):
            findings.append(Finding('todo', path, lineno, line.strip()[:80]))
    return findings


def check_hardcoded_color(path: str, source: str) -> list[Finding]:
    if path.replace(os.sep, '/') in {p.replace(os.sep, '/') for p in GENERATED_ALLOWLIST}:
        return []
    findings: list[Finding] = []
    for lineno, line in enumerate(source.splitlines(), start=1):
        if COLOR_LITERAL_RE.search(line):
            findings.append(
                Finding('hardcoded-color', path, lineno, '硬编码色值，应使用 KedaYaTokens/KedaYaColors')
            )
    return findings


def check_domain_purity(path: str, source: str) -> list[Finding]:
    if not path.replace(os.sep, '/').startswith('lib/domain/'):
        return []
    findings: list[Finding] = []
    for lineno, line in enumerate(source.splitlines(), start=1):
        match = IMPORT_RE.match(line)
        if not match:
            continue
        uri = match.group('uri')
        if uri.startswith('package:'):
            findings.append(
                Finding('domain-purity', path, lineno, f'domain 层禁止 import 框架: {uri}')
            )
        elif uri.startswith('dart:') and uri not in DOMAIN_ALLOWED_DART_LIBS:
            findings.append(
                Finding('domain-purity', path, lineno, f'domain 层只允许 dart:core，实际: {uri}')
            )
    return findings


def check_ref_leak(path: str, source: str) -> list[Finding]:
    normalized = path.replace(os.sep, '/')
    if '/application/' not in normalized and not normalized.startswith('lib/application/'):
        return []
    findings: list[Finding] = []
    for lineno, line in enumerate(source.splitlines(), start=1):
        stripped = line.strip()
        if stripped.startswith('//') or stripped.startswith('///'):
            continue
        for pattern in REF_LEAK_RES:
            if pattern.search(line):
                findings.append(
                    Finding('ref-leak', path, lineno, 'application 层对象持有 Ref（应只拿端口 + 回调）')
                )
                break
    return findings


CONST_HEAD_RE = re.compile(r'\bconst\s+(?:[A-Z]\w*\s*\(|<)')
# 这些表达式出现在 const 构造里一定是编译错误（它们不是编译期常量）。
RUNTIME_IN_CONST_RE = re.compile(
    r'\b(?:context\.|colors\.|ref\.|widget\.|state\.|Theme\.of|MediaQuery\.'
    r'|DateTime\.now|DateTime\.fromMillisecondsSinceEpoch|Navigator\.of|ScaffoldMessenger\.of)'
)


def check_const_expressions(path: str, source: str) -> list[Finding]:
    """`const` 构造 / const 字面量里引用了运行期表达式。

    手写 Dart 时最常见的编译错误之一：把 `KedaYaTokens.colorXxx`（const）改成
    `context.kedayaColors.xxx`（非 const）后忘了去掉外层的 `const`。
    本机没有 analyze，这个检查专门盯这一类。
    """
    findings: list[Finding] = []
    stripped = strip_strings_and_comments(source)
    lines = source.splitlines()
    for match in CONST_HEAD_RE.finditer(stripped):
        start = match.start()
        # 找到 const 头部对应的括号区间（列表字面量则以 [ 结尾）
        index = match.end() - 1
        opener = stripped[index]
        closer = {'(': ')', '[': ']'}.get(opener)
        if closer is None:
            continue
        depth = 0
        end = index
        while end < len(stripped):
            char = stripped[end]
            if char == opener:
                depth += 1
            elif char == closer:
                depth -= 1
                if depth == 0:
                    break
            end += 1
        body = stripped[index:end + 1]
        runtime = RUNTIME_IN_CONST_RE.search(body)
        if runtime is None:
            continue
        lineno = stripped.count('\n', 0, start) + 1
        snippet = lines[lineno - 1].strip()[:70] if lineno - 1 < len(lines) else ''
        findings.append(
            Finding(
                'const-runtime', path, lineno,
                f'const 构造里出现运行期表达式 "{runtime.group(0)}" —— 必须去掉 const（{snippet}）',
            )
        )
    return findings


CHECKS = [
    ('import-resolve', check_imports_resolve),
    ('balanced', check_balanced),
    ('directives-ordering', check_directives_ordering),
    ('unused-dart-import', check_unused_dart_import),
    ('unused-import', check_unused_import),
    ('const-runtime', check_const_expressions),
    ('todo', check_todo),
    ('hardcoded-color', check_hardcoded_color),
    ('domain-purity', check_domain_purity),
    ('ref-leak', check_ref_leak),
]


def main() -> int:
    parser = argparse.ArgumentParser(description='可达鸭 Flutter 端静态自检')
    parser.add_argument('--roots', nargs='*', default=['lib', 'test'])
    parser.add_argument('--verbose', action='store_true')
    args = parser.parse_args()

    files = dart_files(args.roots)
    findings: list[Finding] = []
    for path in files:
        source = read(path)
        for _, check in CHECKS:
            findings.extend(check(path, source))

    print('可达鸭 Flutter 端 · 静态自检')
    print(f'扫描根目录: {", ".join(args.roots)}   文件数: {len(files)}')
    print('-' * 72)

    if args.verbose:
        for name, _ in CHECKS:
            print(f'  ✓ 已执行检查: {name}')
        print('-' * 72)

    if not findings:
        print('全部检查通过：0 处违规。')
        return 0

    by_check: dict[str, list[Finding]] = {}
    for finding in findings:
        by_check.setdefault(finding.check, []).append(finding)
    for name, _ in CHECKS:
        items = by_check.get(name, [])
        if not items:
            continue
        print(f'{name}: {len(items)} 处')
        for item in items:
            print(item.render())
    print('-' * 72)
    print(f'合计 {len(findings)} 处违规。')
    return 1


if __name__ == '__main__':
    sys.exit(main())

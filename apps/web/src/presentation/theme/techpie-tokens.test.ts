/**
 * techpie 令牌纪律 + 静态安全扫描（契约 §6.2 / §11.5 / 规格 §10.3）。
 *
 * 四件事：
 * 1. **禁止手写色值** —— techpie 切片的全部源文件不得出现 hex / rgb / hsl / oklch；
 *    颜色只能来自 `@kedaya/design-tokens`（Tailwind 工具类 → `--kdy-*`）。
 * 2. **暗色可用** —— design-tokens 产物确实提供 `[data-theme="dark"]`，
 *    且 techpie 组件没有自己写一套暗色色值（`dark:` + 手写色值即违规）。
 * 3. **凭证不进日志/存储** —— techpie 切片里不得出现 `console.*`、
 *    `localStorage` / `sessionStorage` / `document.cookie`。
 * 4. **如实告知** —— WebView 页面逐字包含"学校系统提供页面 / 只转发一次性票据 /
 *    不接触登录凭证"的说明；`CAMPUS_BINDING_REQUIRED` 用引导语气而不是报错语气。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = fileURLToPath(new URL('.', import.meta.url));
/** apps/web/src */
const SRC = join(HERE, '..', '..');
/** apps/web */
const APP = join(SRC, '..');
/** 仓库根 */
const ROOT = join(APP, '..', '..');

const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(/;

/** techpie 切片的全部产出（不含测试文件） */
const TARGETS: readonly string[] = [
  'domain/models/techpie.ts',
  'domain/ports/techpie.ts',
  'application/techpie',
  'data/schemas/techpie.ts',
  'data/mock/fixtures/techpie.ts',
  'data/mock/techpie.repository.ts',
  'data/repositories/techpie.http.ts',
  'presentation/components/techpie',
  'app/(portal)/techpie',
  'app/(portal)/campus-card',
];

function collectFiles(target: string): string[] {
  const absolute = join(SRC, target);
  const stats = statSync(absolute);
  if (stats.isFile()) return [absolute];
  return readdirSync(absolute).flatMap((entry) => {
    const child = join(absolute, entry);
    if (statSync(child).isDirectory()) return collectFiles(relative(SRC, child));
    return child.endsWith('.test.ts') || child.endsWith('.test.tsx') ? [] : [child];
  });
}

const FILES = TARGETS.flatMap(collectFiles);

function read(absolute: string): string {
  return readFileSync(absolute, 'utf8');
}

/**
 * 去掉**纯注释行**后再扫描。
 *
 * 为什么需要：源码注释里会**讨论**禁止项（例如 keys.ts 的注释解释
 * "这里刻意没有任何票据 key"），直接对原文做正则匹配会把注释当成违规。
 * 只丢弃"整行都是注释"的行，不做正则剥离 —— 后者会误伤 `https://` 这类字符串。
 */
function codeOnly(source: string): string {
  return source
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      return !(trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*'));
    })
    .join('\n');
}

describe('扫描范围自检（防止"扫了个空目录"）', () => {
  it('覆盖模型 / 端口 / 用例 / 适配器 / 组件 / 页面', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(20);
    expect(FILES.some((file) => file.endsWith('techpie.ts'))).toBe(true);
    expect(FILES.some((file) => file.endsWith('techpie.repository.ts'))).toBe(true);
    expect(FILES.some((file) => file.endsWith('techpie.http.ts'))).toBe(true);
    expect(FILES.some((file) => file.endsWith('WebviewLauncher.tsx'))).toBe(true);
    expect(FILES.some((file) => file.endsWith('CampusCardPanel.tsx'))).toBe(true);
    expect(FILES.some((file) => file.endsWith('page.tsx'))).toBe(true);
  });
});

describe('令牌纪律：techpie 源码零手写色值', () => {
  it('没有任何 hex / rgb / hsl / oklch 字面量', () => {
    const offenders = FILES.map((file) => ({
      file: relative(SRC, file),
      source: read(file),
    })).flatMap(({ file, source }) =>
      source
        .split('\n')
        .map((line, index) => ({ file, line: index + 1, text: line }))
        .filter(({ text }) => COLOR_LITERAL.test(text)),
    );

    expect(offenders).toEqual([]);
  });

  it('组件只用令牌派生的工具类（bg-surface / text-muted / border-border …）', () => {
    const launcher = read(join(SRC, 'presentation/components/techpie/WebviewLauncher.tsx'));
    expect(launcher).toMatch(/\bbg-surface\b/);
    expect(launcher).toMatch(/\btext-muted\b/);
    expect(launcher).toMatch(/\bborder-border\b/);
    expect(launcher).toMatch(/\brounded-lg\b/);
    expect(launcher).not.toMatch(/style=\{\{/);

    const card = read(join(SRC, 'presentation/components/techpie/CampusCardPanel.tsx'));
    expect(card).toMatch(/\btext-danger\b/);
    expect(card).toMatch(/\btext-success\b/);
    expect(card).not.toMatch(/style=\{\{/);
  });
});

describe('暗色可用（契约 §11.5）', () => {
  const tokensCss = read(join(ROOT, 'packages', 'design-tokens', 'dist', 'tokens.css'));

  it('design-tokens 提供 [data-theme="dark"] 覆盖同名 --kdy-color-* 变量', () => {
    expect(tokensCss).toContain('[data-theme="dark"]');
    const darkBlock = tokensCss.slice(tokensCss.indexOf('[data-theme="dark"]'));
    expect(darkBlock).toContain('--kdy-color-brand:');
    expect(darkBlock).toContain('--kdy-color-surface:');
    expect(darkBlock).toContain('--kdy-color-text:');
    expect(darkBlock).toContain('--kdy-color-danger:');
  });

  it('同时支持 prefers-color-scheme 自动跟随（且不覆盖显式浅色）', () => {
    expect(tokensCss).toContain('@media (prefers-color-scheme: dark)');
    expect(tokensCss).toContain(':root:not([data-theme="light"])');
  });

  it('techpie 组件没有自己写一套暗色色值（dark: + 手写色值即违规）', () => {
    const offenders = FILES.map((file) => ({ file: relative(SRC, file), source: read(file) })).filter(
      ({ source }) => /dark:[^"'`\s]*(#|rgb|hsl|oklch)/i.test(source),
    );
    expect(offenders.map((item) => item.file)).toEqual([]);
  });

  it('techpie 组件也没有内联 color/background 样式', () => {
    const offenders = FILES.map((file) => ({ file: relative(SRC, file), source: read(file) })).filter(
      ({ source }) => /style=\{\{[^}]*(color|background)/i.test(source),
    );
    expect(offenders.map((item) => item.file)).toEqual([]);
  });
});

describe('静态扫描：凭证不进日志 / 不进浏览器存储（规格 §10.3）', () => {
  it('techpie 切片里没有任何 console 调用（只能用脱敏 logger）', () => {
    const offenders = FILES.map((file) => ({ file: relative(SRC, file), source: read(file) })).filter(
      ({ source }) =>
        /\bconsole\s*\.\s*(log|debug|info|warn|error|trace)\s*\(/.test(codeOnly(source)),
    );
    expect(offenders.map((item) => item.file)).toEqual([]);
  });

  it('techpie 切片里没有任何浏览器存储写入（凭证不落盘）', () => {
    const offenders = FILES.map((file) => ({ file: relative(SRC, file), source: read(file) })).filter(
      ({ source }) =>
        /\blocalStorage\b|\bsessionStorage\b|document\s*\.\s*cookie|indexedDB/i.test(
          codeOnly(source),
        ),
    );
    expect(offenders.map((item) => item.file)).toEqual([]);
  });

  it('presentation 层不直接发请求（网络只走 data/api/client）', () => {
    const offenders = FILES.filter((file) => file.includes('presentation'))
      .map((file) => ({ file: relative(SRC, file), source: read(file) }))
      .filter(({ source }) => /\bfetch\s*\(|axios|XMLHttpRequest/.test(codeOnly(source)));
    expect(offenders.map((item) => item.file)).toEqual([]);
  });

  it('webview 相关文件里没有把票据拼进 URL 的写法', () => {
    const offenders = FILES.map((file) => ({ file: relative(SRC, file), source: read(file) })).filter(
      ({ source }) =>
        /\?ticket=\$\{|\bticket=\$\{|searchParams\s*\.\s*set\s*\(\s*['"]ticket/.test(
          codeOnly(source),
        ),
    );
    expect(offenders.map((item) => item.file)).toEqual([]);
  });

  it('techpie / campusCard 的 query key 里没有票据 / 付款码（凭证不进缓存）', () => {
    // 注意：`faq.tickets` 是**客服工单**，与"一次性票据"无关，因此只扫描
    // techpie 之后的那一段（TechPie 切片自己的命名空间）。
    const keys = codeOnly(read(join(SRC, 'presentation/query/keys.ts')));
    const techpieSection = keys.slice(keys.indexOf('techpie: {'));
    expect(techpieSection.length).toBeGreaterThan(0);
    expect(techpieSection).not.toMatch(/ticket/i);
    expect(techpieSection).not.toMatch(/paymentCode/i);
    expect(techpieSection).not.toMatch(/payload/i);
    // 该命名空间里只允许这四个 key + campusCard 的三个
    expect(techpieSection).toContain("links:");
    expect(techpieSection).toContain("capabilities:");
    expect(techpieSection).toContain("card:");
    expect(techpieSection).toContain("transactions:");
  });

  it('日志脱敏模块是白名单实现（默认拒绝），且被 techpie 用例真实引用', () => {
    const redact = read(join(SRC, 'platform/redact.ts'));
    expect(redact).toContain('LOG_SAFE_FIELDS');
    expect(redact).toContain('白名单');
    const webview = read(join(SRC, 'application/techpie/webviewTicket.ts'));
    expect(webview).toContain('techpieTraceLogger');
    expect(webview).not.toContain('console.');
  });
});

describe('如实告知与引导语气（交付要求）', () => {
  const launcher = read(join(SRC, 'presentation/components/techpie/WebviewLauncher.tsx'));
  const capabilities = read(join(SRC, 'presentation/components/techpie/TechpieCapabilityList.tsx'));
  const webviewPage = read(join(SRC, 'app/(portal)/techpie/webview/page.tsx'));

  it('WebView 页面渲染逐字一致的"学校系统提供页面"说明', () => {
    expect(launcher).toContain('{WEBVIEW_HONEST_NOTICE}');
    expect(webviewPage).toContain('接下来的页面由学校系统提供，请在那里登录；可达鸭只转发一次性的访问票据，不接触你的登录凭证。');
  });

  it('说明里包含"不接触登录凭证"与"一次性"两个关键承诺', () => {
    const noticeSource = read(join(SRC, 'application/techpie/webviewTicket.ts'));
    expect(noticeSource).toContain('不接触你的登录凭证');
    expect(noticeSource).toContain('一次性');
  });

  it('CAMPUS_BINDING_REQUIRED 用引导（info/status）而不是报错（danger/alert）', () => {
    // 引导分组用 tone="info" + role="status"
    expect(capabilities).toContain('data-testid="techpie-capability-binding-required"');
    expect(capabilities).toContain('这是引导，不是错误');
    expect(capabilities).toMatch(/tone="info"/);
    // 该分组里不得出现 danger
    const bindingSection = capabilities.slice(
      capabilities.indexOf('techpie-capability-binding-required'),
      capabilities.indexOf('groups.available'),
    );
    expect(bindingSection).not.toContain('tone="danger"');
  });

  it('打开新标签页不依赖 window.open 的返回值（noopener 下它按规范返回 null）', () => {
    // 真实浏览器验证踩到的坑：`window.open(url,'_blank','noopener')` 返回 null，
    // 于是"标签页明明打开了，提示却说请手动打开"。这条断言把修法钉住。
    expect(codeOnly(launcher)).not.toMatch(/window\.open\([^)]*\)\s*!==\s*null/);
    expect(launcher).toContain('noopener,noreferrer');
    expect(launcher).toContain('若浏览器拦截了新标签页');
  });

  it('WebView 目标来自服务端清单，页面不提供自定义 URL 输入', () => {
    expect(launcher).not.toMatch(/type="url"/);
    expect(launcher).not.toMatch(/placeholder="[^"]*https/);
    expect(launcher).toContain('不得自行拼接任意 URL');
  });

  it('白名单占位状态在 UI 上如实标注（不假装它已完整）', () => {
    expect(launcher).toContain('CAMPUS_TARGET_ALLOWLIST_IS_PLACEHOLDER');
    expect(capabilities).toContain('CAMPUS_TARGET_ALLOWLIST_IS_PLACEHOLDER');
    expect(launcher).toContain('内容为占位');
  });
});

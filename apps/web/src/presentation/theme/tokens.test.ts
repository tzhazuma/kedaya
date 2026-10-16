/**
 * 令牌纪律测试（契约 §6.2 / §11.5）—— **禁止手写色值** 的机器守卫。
 *
 * 两件事：
 * 1. forum / faq 切片的所有源文件里不得出现 hex / rgb / hsl / oklch 色值字面量；
 *    颜色只能来自 `@kedaya/design-tokens`（Tailwind 工具类，最终解析到 `--kdy-*`）。
 * 2. design-tokens 产物确实提供暗色（`[data-theme="dark"]` + `prefers-color-scheme`），
 *    否则「支持暗色」只是一句空话。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = fileURLToPath(new URL('.', import.meta.url));
/** apps/web/src */
const SRC = join(HERE, '..', '..');

const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(/;

/** forum / faq 切片的所有产出（不含测试文件） */
const TARGETS: readonly string[] = [
  'domain/models/forum.ts',
  'domain/models/faq.ts',
  'application/forum',
  'application/faq',
  'data/schemas/forum.ts',
  'data/schemas/faq.ts',
  'data/mock/fixtures/forum.ts',
  'data/mock/fixtures/faq.ts',
  'data/mock/forum.repository.ts',
  'data/mock/faq.repository.ts',
  'data/repositories/forum.http.ts',
  'data/repositories/faq.http.ts',
  'presentation/components/forum',
  'presentation/components/faq',
  'app/(portal)/forum',
  'app/(portal)/faq',
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

describe('令牌纪律：forum / faq 源码零手写色值', () => {
  const files = TARGETS.flatMap(collectFiles);

  it('扫描范围覆盖 forum / faq 的主要源文件（防止"扫了个空目录"）', () => {
    expect(files.length).toBeGreaterThanOrEqual(20);
    expect(files.some((file) => file.endsWith('ForumPostList.tsx'))).toBe(true);
    expect(files.some((file) => file.endsWith('FaqBrowser.tsx'))).toBe(true);
    expect(files.some((file) => file.endsWith('forum.http.ts'))).toBe(true);
  });

  it('没有任何 hex / rgb / hsl / oklch 字面量', () => {
    const offenders = files
      .map((file) => ({ file: relative(SRC, file), source: readFileSync(file, 'utf8') }))
      .flatMap(({ file, source }) =>
        source
          .split('\n')
          .map((line, index) => ({ file, line: index + 1, text: line }))
          .filter(({ text }) => COLOR_LITERAL.test(text)),
      );

    expect(offenders).toEqual([]);
  });

  it('样式类只用令牌派生的工具类（抽查 forum / faq 组件）', () => {
    const component = readFileSync(join(SRC, 'presentation/components/forum/ForumPostList.tsx'), 'utf8');
    // 令牌工具类：颜色 / 圆角 / 字号 / 阴影
    expect(component).toMatch(/\bbg-surface\b/);
    expect(component).toMatch(/\btext-muted\b/);
    expect(component).toMatch(/\bborder-border\b/);
    expect(component).toMatch(/\brounded-lg\b/);
    // 不允许内联 style 写颜色
    expect(component).not.toMatch(/style=\{\{/);
  });
});

describe('暗色令牌确实可达（契约 §11.5）', () => {
  const tokensCss = readFileSync(
    join(SRC, '..', '..', '..', 'packages', 'design-tokens', 'dist', 'tokens.css'),
    'utf8',
  );

  it('提供 [data-theme="dark"] 覆盖同名 --kdy-color-* 变量', () => {
    expect(tokensCss).toContain('[data-theme="dark"]');
    const darkBlock = tokensCss.slice(tokensCss.indexOf('[data-theme="dark"]'));
    expect(darkBlock).toContain('--kdy-color-brand:');
    expect(darkBlock).toContain('--kdy-color-surface:');
    expect(darkBlock).toContain('--kdy-color-text:');
  });

  it('同时支持 prefers-color-scheme 自动跟随（且不覆盖显式浅色）', () => {
    expect(tokensCss).toContain('@media (prefers-color-scheme: dark)');
    expect(tokensCss).toContain(':root:not([data-theme="light"])');
  });
});

/**
 * 找搭子令牌纪律与硬约束守卫（契约 §6.2 / §11.5 / §11.10-G）。
 *
 * 四件事必须能被机器检查，而不是靠人工点页面：
 * 1. buddy 切片的**全部源码零手写色值**（颜色只来自 `@kedaya/design-tokens`）；
 * 2. 暗色令牌确实可达（`[data-theme="dark"]` 覆盖同名 `--kdy-color-*`）；
 * 3. **不做交友/约会板块**（契约 §11.10-G）：源码里不得出现该板块的英文标识；
 * 4. presentation **不得直接发请求**（契约 §7 硬规则 3：网络只走 `data/api/`）；
 * 5. 发布表单**没有自由文本标签输入**（规格 §3.2 的封闭标签硬要求）。
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

const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(/;

/** buddy 切片的全部产出（不含测试文件） */
const TARGETS: readonly string[] = [
  'domain/models/buddy.ts',
  'domain/ports/buddy.ts',
  'application/buddy',
  'data/schemas/buddy.ts',
  'data/mock/fixtures/buddy.ts',
  'data/mock/buddy.repository.ts',
  'data/repositories/buddy.http.ts',
  'presentation/components/buddy',
  'app/(portal)/buddy',
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
const readSource = (target: string): string => readFileSync(join(SRC, target), 'utf8');

describe('令牌纪律：buddy 源码零手写色值', () => {
  it('扫描范围覆盖 buddy 的主要源文件（防止"扫了个空目录"）', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(20);
    expect(FILES.some((file) => file.endsWith('buddy.repository.ts'))).toBe(true);
    expect(FILES.some((file) => file.endsWith('buddy.http.ts'))).toBe(true);
    expect(FILES.some((file) => file.endsWith('BuddyPostList.tsx'))).toBe(true);
    expect(FILES.some((file) => file.endsWith('BuddyComposer.tsx'))).toBe(true);
    expect(FILES.some((file) => file.endsWith('page.tsx'))).toBe(true);
  });

  it('没有任何 hex / rgb / hsl / oklch 字面量', () => {
    const offenders = FILES.map((file) => ({
      file: relative(SRC, file),
      source: readFileSync(file, 'utf8'),
    })).flatMap(({ file, source }) =>
      source
        .split('\n')
        .map((line, index) => ({ file, line: index + 1, text: line }))
        .filter(({ text }) => COLOR_LITERAL.test(text)),
    );

    expect(offenders).toEqual([]);
  });

  it('列表与卡片只用令牌工具类，且不为颜色写内联 style', () => {
    const list = readSource('presentation/components/buddy/BuddyPostList.tsx');
    expect(list).toMatch(/\bbg-surface\b/);
    expect(list).toMatch(/\btext-muted\b/);
    expect(list).toMatch(/\bborder-border\b/);
    expect(list).toMatch(/\brounded-lg\b/);

    const card = readSource('presentation/components/buddy/BuddyPostCard.tsx');
    expect(card).toMatch(/\bbg-brand\b/);
    expect(card).toMatch(/\bbg-surface-alt\b/);
    // style 只用于进度条宽度（尺寸），不得写颜色
    expect(card).not.toMatch(/style=\{\{[^}]*color/i);
  });

  it('推荐页用令牌徽章表达理由，不自己造颜色', () => {
    const recommendations = readSource('presentation/components/buddy/BuddyRecommendations.tsx');
    expect(recommendations).toMatch(/\bKdyBadge\b/);
    expect(recommendations).toMatch(/\bbg-brand-soft\b/);
    expect(recommendations).not.toMatch(/style=\{\{/);
  });

  it('组件没有自己写一套暗色色值（dark: 变体里也不出现字面色值）', () => {
    const offenders = FILES.map((file) => ({
      file: relative(SRC, file),
      source: readFileSync(file, 'utf8'),
    })).filter(({ source }) => /dark:[^"'`\s]*(#|rgb|hsl|oklch)/i.test(source));
    expect(offenders.map((o) => o.file)).toEqual([]);
  });
});

describe('暗色令牌可达（契约 §11.5）', () => {
  const tokensCss = readFileSync(
    join(APP, '..', '..', 'packages', 'design-tokens', 'dist', 'tokens.css'),
    'utf8',
  );

  it('提供 [data-theme="dark"] 覆盖同名 --kdy-color-* 变量（消费方代码零改动）', () => {
    expect(tokensCss).toContain('[data-theme="dark"]');
    const darkBlock = tokensCss.slice(tokensCss.indexOf('[data-theme="dark"]'));
    expect(darkBlock).toContain('--kdy-color-brand:');
    expect(darkBlock).toContain('--kdy-color-surface:');
    expect(darkBlock).toContain('--kdy-color-text-muted:');
  });

  it('同时支持 prefers-color-scheme 自动跟随', () => {
    expect(tokensCss).toContain('@media (prefers-color-scheme: dark)');
    expect(tokensCss).toContain(':root:not([data-theme="light"])');
  });
});

describe('契约 §11.10-G：不做交友/约会板块', () => {
  const FORBIDDEN_SECTION = ['dat', 'ing'].join('');

  it('buddy 源码里不出现该板块的英文标识（只有三个板块）', () => {
    const offenders = FILES.map((file) => ({
      file: relative(SRC, file),
      source: readFileSync(file, 'utf8'),
    })).filter(({ source }) => new RegExp(`\\b${FORBIDDEN_SECTION}\\b`, 'i').test(source));
    expect(offenders.map((o) => o.file)).toEqual([]);
  });

  it('板块枚举恰好三个，且不含该标识', () => {
    const model = readSource('domain/models/buddy.ts');
    expect(model).toContain("export const BUDDY_SECTIONS: readonly BuddySection[] = ['academic', 'daily', 'sport'];");
    expect(model).toContain('不实现约会/交友板块');
  });
});

describe('契约 §7 硬规则 3：presentation 不得直接发请求', () => {
  it('buddy 的组件里没有 fetch / axios / XMLHttpRequest', () => {
    const components = FILES.filter((file) => file.includes('presentation/components/buddy'));
    expect(components.length).toBeGreaterThan(5);
    const offenders = components
      .map((file) => ({ file: relative(SRC, file), source: readFileSync(file, 'utf8') }))
      .filter(({ source }) => /\bfetch\s*\(|axios|XMLHttpRequest/.test(source));
    expect(offenders.map((o) => o.file)).toEqual([]);
  });

  it('组件通过仓储工厂取端口（getRepositories / getMockBuddyRepository）', () => {
    const list = readSource('presentation/components/buddy/BuddyPostList.tsx');
    expect(list).toContain("from '@/data/repositories'");
    expect(list).toMatch(/getRepositories\(\)\.buddy/);
    expect(list).toMatch(/getMockBuddyRepository\(\)/);
  });
});

describe('规格 §3.2：发布表单是封闭标签选择器，没有自由文本标签输入', () => {
  it('发布表单用 BuddyTagPicker，且没有把输入框的值当标签', () => {
    const composer = readSource('presentation/components/buddy/BuddyComposer.tsx');
    expect(composer).toContain('BuddyTagPicker');
    expect(composer).not.toMatch(/tags:\s*event\.target\.value/);
    // 描述是自由文本，但标签不是：标签只能来自 TagPicker 的 onChange
    expect(composer).toMatch(/onChange=\{\(tags\) => patch\(\{ tags \}\)\}/);
  });

  it('标签选择器本身不渲染任何文本输入控件', () => {
    const picker = readSource('presentation/components/buddy/BuddyTagPicker.tsx');
    expect(picker).toContain('type="checkbox"');
    expect(picker).not.toContain('type="text"');
    expect(picker).not.toContain('<textarea');
    expect(picker).not.toContain('<input type="search"');
  });
});

describe('隐私硬要求：页面上能看到的说明（规格 §6）', () => {
  it('隐私面板覆盖公开 / 不公开 / 联系方式 / 可撤回四件事', () => {
    const notice = readSource('presentation/components/buddy/BuddyPrivacyNotice.tsx');
    expect(notice).toContain('summary.publicNotice');
    expect(notice).toContain('summary.hiddenNotice');
    expect(notice).toContain('summary.contactExchange');
    expect(notice).toContain('summary.withdrawal');
    expect(notice).toContain('buddy-privacy-table');
  });

  it('列表页与详情页都挂了隐私说明', () => {
    expect(readSource('presentation/components/buddy/BuddyPostList.tsx')).toContain(
      '<BuddyPrivacyNotice',
    );
    expect(readSource('presentation/components/buddy/BuddyPostDetailView.tsx')).toContain(
      '<BuddyPrivacyNotice',
    );
  });

  it('推荐页显式展示匹配模式说明（rule 模式不假装个性化推荐）', () => {
    const recommendations = readSource('presentation/components/buddy/BuddyRecommendations.tsx');
    expect(recommendations).toContain('matchModeNotice');
    expect(recommendations).toContain('matchModeLabel');
  });

  it('资料页显式展示撤回说明（关闭 / 删除两条路径）', () => {
    const editor = readSource('presentation/components/buddy/BuddyProfileEditor.tsx');
    expect(editor).toContain('资料可撤回');
    expect(editor).toContain('删除匹配资料');
    expect(editor).toContain('buddy-match-enabled');
  });
});

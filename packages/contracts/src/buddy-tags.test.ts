import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BUDDY_TAGS,
  CAMPUS_LOCATIONS,
  MAX_ACTIVITY_TAGS,
  MAX_INTEREST_TAGS,
  MAX_POST_TAGS,
  MAX_PREFERRED_AREAS,
  SKILL_LEVELS,
  TAG_KEYS,
  activeTags,
  isKnownLocation,
  isKnownTag,
  isSkillLevel,
  skillRank,
  tagLabel,
  unknownTags,
} from './buddy-tags';

const REPO_ROOT = join(__dirname, '..', '..', '..');

describe('buddy 封闭标签表（唯一真相）', () => {
  it('表非空且 key 唯一（重复 key 会让 Map 静默丢项）', () => {
    expect(BUDDY_TAGS.length).toBeGreaterThanOrEqual(50);
    const keys = BUDDY_TAGS.map((t) => t.key);
    expect(new Set(keys).size, '存在重复 key').toBe(keys.length);
    expect(TAG_KEYS).toHaveLength(BUDDY_TAGS.length);
  });

  it('每个标签都有非空的中文显示名与合法分组', () => {
    const groups = new Set(['sport', 'study', 'meal', 'travel', 'interest']);
    for (const tag of BUDDY_TAGS) {
      expect(tag.key, 'key 必须非空').toBeTruthy();
      expect(tag.label, `${tag.key} 缺 label`).toBeTruthy();
      expect(groups.has(tag.group), `${tag.key} 分组非法: ${tag.group}`).toBe(true);
    }
  });

  it('key 一律小写 kebab-case（大写或空格会让跨端比较失败）', () => {
    for (const tag of BUDDY_TAGS) {
      expect(tag.key, `${tag.key} 不是 kebab-case`).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it('别名唯一且不与任何 key 冲突（否则搜索会歧义）', () => {
    const keys = new Set(TAG_KEYS);
    const seen = new Map<string, string>();
    for (const tag of BUDDY_TAGS) {
      for (const alias of tag.aliases ?? []) {
        expect(keys.has(alias), `别名 ${alias} 与某个 key 冲突`).toBe(false);
        const owner = seen.get(alias);
        expect(owner === undefined || owner === tag.key, `别名 ${alias} 同时属于 ${owner} 与 ${tag.key}`).toBe(true);
        seen.set(alias, tag.key);
      }
    }
  });

  it('当前没有下架标签（如实记录；若有，下架路径需要补测试）', () => {
    const retired = BUDDY_TAGS.filter((t) => t.isActive === false);
    expect(retired, '权威表当前无下架标签；新增下架标签时请同时补下架路径测试').toHaveLength(0);
    expect(activeTags()).toHaveLength(BUDDY_TAGS.length);
  });

  it('校验辅助函数行为正确', () => {
    expect(isKnownTag('badminton')).toBe(true);
    expect(isKnownTag('not-a-real-tag')).toBe(false);
    expect(unknownTags(['badminton', 'nope', 'also-nope'])).toEqual(['nope', 'also-nope']);
    expect(unknownTags([])).toEqual([]);
    expect(tagLabel('badminton')).toBe('羽毛球');
    // 未知 key 退回 key 本身（不抛错、不返回 undefined）
    expect(tagLabel('nope')).toBe('nope');
  });

  it('数量上限与规格 §3.2 一致', () => {
    expect(MAX_INTEREST_TAGS).toBe(20);
    expect(MAX_ACTIVITY_TAGS).toBe(10);
    expect(MAX_POST_TAGS).toBe(8);
    expect(MAX_PREFERRED_AREAS).toBe(5);
  });

  it('技能水平与排序一致且单调', () => {
    expect(SKILL_LEVELS).toEqual(['beginner', 'casual', 'regular', 'competitive']);
    for (const l of SKILL_LEVELS) expect(isSkillLevel(l)).toBe(true);
    expect(isSkillLevel('expert')).toBe(false);
    expect(isSkillLevel(123)).toBe(false);
    const ranks = SKILL_LEVELS.map((l) => skillRank(l));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(new Set(ranks).size, '等级必须有区分度').toBe(ranks.length);
    // 未知等级排在最前（保守：不会误判为"够格"）
    expect(skillRank('unknown-level')).toBeLessThan(ranks[0] as number);
  });

  it('校园地点白名单可用（并标注它仍是占位）', () => {
    expect(CAMPUS_LOCATIONS.length).toBeGreaterThan(5);
    expect(isKnownLocation(CAMPUS_LOCATIONS[0] as string)).toBe(true);
    expect(isKnownLocation(`  ${CAMPUS_LOCATIONS[0]}  `), '应容错首尾空白').toBe(true);
    expect(isKnownLocation('不存在的楼')).toBe(false);
  });
});

/**
 * ⚠️ 这是一条**跨端防漂移守卫**，不是普通的单元测试。
 *
 * 它存在的理由是一个**真实发生过的缺陷**：四个端各自维护了一份标签表，
 * 实测互不相同（服务端 62 / 小程序 62 / **Web 46**），
 * 导致 **Web 用户选到的 23 个标签会被后端 `UNKNOWN_TAG` 拒**。
 *
 * 收敛到唯一真相之后，光"改了代码"还不够 —— 还得**防止有人再复制一份**。
 * 所以这里直接扫源码：三端的 buddy 领域文件里**不得**出现标签字面量。
 *
 * 这类"扫描源码的测试"通常是坏味道（脆弱、依赖目录布局）。
 * 但这里的风险是**跨端契约漂移**，而漂移的代价是"用户提交被拒"这种用户可见故障 ——
 * 值得用一条会失败的测试把它钉住。同理 `openapi.test.ts` 也扫 YAML。
 */
describe('防漂移守卫：三端不得各自声明标签表', () => {
  const TARGETS = [
    { name: 'web', path: 'apps/web/src/domain/models/buddy.ts' },
    { name: 'miniapp', path: 'apps/miniapp/src/domain/models/buddy.ts' },
    { name: 'server', path: 'services/api/src/modules/buddy/domain/tags.ts' },
  ] as const;

  it.each(TARGETS)('$name 从唯一真相取表，且不含标签字面量', ({ path }) => {
    let src: string;
    try {
      src = readFileSync(join(REPO_ROOT, path), 'utf8');
    } catch {
      // 该端尚未实现 buddy 时不失败（但一旦存在就必须合规）
      return;
    }

    // 1) 必须从 @kedaya/contracts 取表
    expect(src, `${path} 必须从 @kedaya/contracts 取标签表`).toContain('@kedaya/contracts');

    // 2) 不得出现 `{ key: '...' }` 形式的**标签或地点**字面量
    //    （服务端 re-export 文件里不该有任何数据；两端派生文件里同理）
    //
    //    ⚠️ 这条守卫真的抓到过东西：第一次运行时它立刻在 Web 里发现了
    //    **15 处** `{ key: 'gym', label: '体育馆' }` —— 那是 Web 自拟的**校园地点**表，
    //    而它的命名空间（英文 slug）与服务端白名单（中文名）**完全不相交**。
    //    也就是说 Web 用户选的任何地点，服务端都会判为不在白名单。
    //    这正是"扫描源码的测试"值得存在的原因：光看 diff 不会发现两个命名空间不相交。
    const literals = src.match(/\{\s*key:\s*'[a-z0-9-]+'/g) ?? [];
    expect(
      literals.length,
      `${path} 里出现了 ${literals.length} 处标签/地点字面量 —— 只能有一份真相` +
        `（@kedaya/contracts/src/buddy-tags.ts）。` +
        `如果这是有意的新副本，请改为 import，否则跨端必然漂移。`,
    ).toBe(0);
  });
});

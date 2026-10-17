import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 架构不变式 **I1 / I2 / I3**（契约 §11.4 + 裁决 §11.18-H / §11.22-A / §11.22-B）
 *
 * 这个文件的存在本身就是设计的一部分。ADR 0004 §2.2 的结论是：
 *
 * > **"一个只有文档保护的边界，在一次紧急修 bug 时就会消失。"**
 *
 * 所以每条不变式都要有**会失败的测试**，而不是一段注释。
 * 这里的测试是**静态扫描**：它们不依赖运行时行为，
 * 因此能拦住"有人为了赶进度顺手绕过去"这种情况。
 *
 * | 不变式 | 内容 |
 * | --- | --- |
 * | **I1** | `KedaYaIdentitySession` **及 `/auth/*` 的全部响应**不含 8 个禁用键（§11.22-A 精确化） |
 * | **I2** | `modules/auth/data/**` **不 import** `campus-session.port` |
 * | **I3** | 全仓 `cookieHeaderFor(` 的**全部调用点**都在 `webview-session/` 内（豁免面**只有 `*.spec.ts`**） |
 *
 * I4 / I5 是行为不变式，在 `test/techpie-http.spec.ts` 里用真实 HTTP 验证。
 */

/* ------------------------------------------------------------------ *
 * 扫描工具
 * ------------------------------------------------------------------ */

/** 仓库根（本文件在 services/api/test/ 下） */
const API_DIR = join(__dirname, '..');
const REPO_ROOT = join(API_DIR, '..', '..');

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', '.turbo', 'build', '.next']);

function walk(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

const SOURCE_EXT = /\.(ts|tsx|mts|cts|mjs)$/;

function sourceFiles(root: string): string[] {
  return walk(root).filter((file) => SOURCE_EXT.test(file) && !file.endsWith('.d.ts'));
}

/** 相对仓库根的路径（用于断言与报错信息，避免把绝对路径写进测试输出） */
const rel = (file: string): string => relative(REPO_ROOT, file);

/** 8 个禁用键名（契约 §11.4 I1）—— 刻意在测试里独立抄一遍，防止实现被改后测试跟着漂 */
const FORBIDDEN_KEYS = [
  'cookie',
  'cookies',
  'session',
  'sessionToken',
  'tgc',
  'castgc',
  'ticket',
  'tenant',
] as const;

/** 从 `export interface X { … }` 里抽出声明的键名 */
function declaredKeys(source: string, interfaceName: string): string[] {
  const match = new RegExp(`export interface ${interfaceName} \\{([\\s\\S]*?)\\n\\}`).exec(source);
  expect(match, `找不到 ${interfaceName} 的声明`).not.toBeNull();
  return [...match![1]!.matchAll(/^\s*(\w+)\s*[?]?:/gm)].map((item) => item[1]!);
}

describe('架构不变式 I1–I3（契约 §11.4）', () => {
  /* ================================================================ *
   * I1 —— 一级身份会话与 `/auth/*` 的序列化不含 8 个禁用键
   * ================================================================ */

  describe('I1 · 一级身份不得夹带二级凭证（§11.22-A：约束对象是 `/auth/*`）', () => {
    const authDomainSource = readFileSync(join(API_DIR, 'src/modules/auth/domain/auth.domain.ts'), 'utf8');

    it('8 个禁用键**全部**被一级身份的词形护栏覆盖（正则，比白名单更强）', () => {
      // 合并同学分支后，一级身份的护栏从「8 键白名单」变成了「词形正则」——
      // 前者只挡恰好 8 个键，后者挡**任何**含 cookie/session/token 等词根的键（更强）。
      // 但必须验证它确实覆盖了契约 §11.4 I1 点名的那 8 个。
      // 正则可能跨行书写（长正则为了可读性会折行），因此要取**整个定义块**，
      // 而不是只取含 `FORBIDDEN_IDENTITY_KEY =` 的那一行。
      const start = authDomainSource.indexOf('FORBIDDEN_IDENTITY_KEY =');
      expect(start, 'FORBIDDEN_IDENTITY_KEY 必须有一条定义').toBeGreaterThan(-1);
      const def = authDomainSource.slice(start, authDomainSource.indexOf(';', start) + 1);
      expect(def.toLowerCase()).toMatch(/cookie/);
      for (const key of ['cookie', 'session', 'tgc', 'ticket', 'tenant']) {
        expect(def.toLowerCase(), `I1 禁用键 \`${key}\` 未被护栏覆盖`).toContain(key);
      }
      // `cookies` / `sessionToken` / `castgc` 分别由 cookie / session / tgc 的**词根**覆盖
      for (const derived of ['cookies', 'sessionToken', 'castgc']) {
        const root = derived === 'cookies' ? 'cookie' : derived === 'sessionToken' ? 'session' : 'tgc';
        expect(def.toLowerCase(), `派生键 \`${derived}\` 应由词根 \`${root}\` 覆盖`).toContain(root);
      }
    });

    it('护栏是**运行时**断言，不是文档约定（assertIdentityOnly 真实存在且会抛错）', async () => {
      const { assertIdentityOnly } = await import('../src/modules/auth/domain/auth.domain');
      expect(typeof assertIdentityOnly).toBe('function');
      // 干净的身份 → 原样返回
      const clean = { provider: 'SHTU_CAS' as const, externalId: 'e1', realName: '同学' };
      expect(() => assertIdentityOnly(clean)).not.toThrow();
      // 夹带 session → 抛错（不是静默放行）
      expect(() =>
        assertIdentityOnly({ ...clean, session: 'x' } as unknown as typeof clean),
      ).toThrow();
    });

    it('`/auth/campus-bindings` 的 wire 类型 `CampusBindingSummary` 与 8 个禁用键不相交', () => {
      const summaryFile = join(API_DIR, 'src/modules/auth/campus-binding-summary.ts');
      const declared = declaredKeys(readFileSync(summaryFile, 'utf8'), 'CampusBindingSummary');

      // `lastRenewedAt`（冻结 OpenAPI 里的**可选**字段）本轮刻意不下发：
      // Phase 0 的上游没有续期能力（`CampusSessionPort.renew` 直接抛
      // `RENEW_NOT_SUPPORTED`），编一个时间等于谎称"已续期"。
      // 可空字段为空时省略键（§11.22-D）。
      expect(declared.sort()).toEqual(['bound', 'expiresAt', 'platform']);

      for (const forbidden of FORBIDDEN_KEYS) {
        expect(declared.map((key) => key.toLowerCase())).not.toContain(forbidden.toLowerCase());
      }
    });

    it('port 类型 `CampusBindingState` 的键名集合也与 8 个禁用键不相交（P0-8 的静态侧）', () => {
      const portFile = join(API_DIR, 'src/modules/techpie/domain/ports/campus-session.port.ts');
      const declared = declaredKeys(readFileSync(portFile, 'utf8'), 'CampusBindingState');

      expect(declared.sort()).toEqual([
        'expiresAt',
        'externalUserId',
        'id',
        'lastSyncAt',
        'phase',
        'provider',
        'status',
      ]);
      for (const forbidden of FORBIDDEN_KEYS) {
        expect(declared.map((key) => key.toLowerCase())).not.toContain(forbidden.toLowerCase());
      }
    });

    it('`GET /auth/session` 的投影只有 4 个字段，且是**显式逐字段**组装', () => {
      const controller = readFileSync(join(API_DIR, 'src/modules/auth/auth.controller.ts'), 'utf8');
      const start = controller.indexOf("@Get('session')");
      expect(start, 'GET /auth/session 必须存在（I1/I5 依赖它）').toBeGreaterThan(-1);
      const ret = controller.indexOf('return {', start);
      const body = controller.slice(ret, controller.indexOf('\n  }', ret));
      for (const field of ['userId: user.id', 'name: user.displayName', 'avatarUrl: user.avatarUrl', 'department: user.department']) {
        expect(body, `session 投影缺字段 \`${field}\``).toContain(field);
      }
      // 禁止展开整个 user 对象：那样将来给 UserRecord 加字段会**自动**泄漏出去
      expect(body).not.toMatch(/return \{[^}]*\.\.\./s);
    });

    it('`/auth/session` **不碰任何上游**（I5 的前提：它是纯本地读取）', () => {
      const controller = readFileSync(join(API_DIR, 'src/modules/auth/auth.controller.ts'), 'utf8');
      const start = controller.indexOf("@Get('session')");
      const body = controller.slice(start, controller.indexOf('\n  }', controller.indexOf('return {', start)));
      // 不得调用 campusSession / authPort 之类会打上游的东西
      expect(body).not.toMatch(/campusSession\.|authPort\.|campusSessionPort\./);
    });
  });

  describe('I2 · modules/auth/data/** 与 campus-session.port 的隔离', () => {
    const authDataDir = join(API_DIR, 'src/modules/auth/data');
    const files = sourceFiles(authDataDir);

    it('扫描范围非空（否则这条不变式是空转）', () => {
      expect(files.length).toBeGreaterThan(0);
    });

    it('没有任何文件 import 路径里出现 `campus-session.port`', () => {
      const offenders: string[] = [];
      for (const file of files) {
        const text = readFileSync(file, 'utf8');
        for (const match of text.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
          if (match[1]!.includes('campus-session.port')) offenders.push(`${rel(file)} → ${match[1]}`);
        }
      }
      expect(offenders).toEqual([]);
    });

    it('[已知偏离] 合并同学分支后 I2/I3 在 auth 模块内被回退 —— 记录而非掩盖', () => {
      // ⚠️ 这是一个**已知的架构回归**，由合并 feat/wechat-auth-account-self-service 引入。
      //
      // 我们的不变式要求（契约 §11.4）：
      //   I2：`modules/auth/data/**` 不得 import `campus-session.port`
      //   I3：`cookieHeaderFor(` 的调用点全在 `webview-session/` 内（cookie 只能一个出口）
      //
      // 同学的 auth 自带一套 `CampusSessionPort` + `acquireSession`，
      // 且 `prisma-campus-session.adapter.ts` 就放在 `auth/data/` 下 —— 两条都不满足。
      //
      // 本测试**断言这个偏离确实存在**，理由：
      //   1. 假装它不存在，比记录它更危险 —— 后来者会以为不变量还成立；
      //   2. 它给出了明确的修复目标（把两套 CampusSessionPort 合并成 techpie 那一套）。
      //
      // 修复后本测试应当失败 —— 那时请把它改成断言**没有**这两个文件/调用。
      const authDomainSource = readFileSync(
        join(API_DIR, 'src/modules/auth/domain/auth.domain.ts'),
        'utf8',
      );
      const authData = readdirSync(join(API_DIR, 'src/modules/auth/data'));
      expect(authData, '已知偏离：auth/data 仍持有校园会话适配器').toContain(
        'prisma-campus-session.adapter.ts',
      );
      const authService = readFileSync(join(API_DIR, 'src/modules/auth/auth.service.ts'), 'utf8');
      expect(authService, '已知偏离：auth 仍有 acquireSession 这个取会话明文的出口').toContain(
        'acquireSession',
      );
      // 修复目标：全仓只应剩 techpie 那一套 CampusSessionPort
      expect(authDomainSource).toContain('CampusSessionPort'); // ← 待删除
    });

    it('能力层的实现确实在 techpie/data 下（"搬走"不等于"删掉"）', () => {
      expect(existsSync(join(API_DIR, 'src/modules/techpie/data/campus-session.service.ts'))).toBe(true);
      const text = readFileSync(join(API_DIR, 'src/modules/techpie/data/campus-session.service.ts'), 'utf8');
      expect(text).toContain('implements CampusSessionPort');
    });
  });

  /* ================================================================ *
   * I3 —— cookie 的唯一出口（豁免面**只有** `*.spec.ts`）
   * ================================================================ */

  describe('I3 · `cookieHeaderFor(` 的调用点全在 webview-session/ 内', () => {
    /**
     * ⚠️ 扫描是**裸子串**匹配，因此它是**完备**的：
     * 「`cookieHeaderFor(` 出现」⟺「有人真的在调用它」。
     *
     * 之所以能做到这一点，是因为端口声明与实现都刻意写成
     * 「属性 + 函数类型」（`cookieHeaderFor: (…) => …`）而不是方法简写。
     */
    const allFiles = sourceFiles(REPO_ROOT);

    /**
     * ⚠️ 豁免面**恰好**是 `*.spec.ts`（契约 §11.22-B）。
     *
     * §11.22-B 的原话：豁免面**只有** `*.spec.ts`
     * （**不能**是"任何测试相关文件"或目录级豁免）。
     * 因此这里刻意**不**写成 `*.test.ts` / `__tests__` / `testing/` ——
     * 一旦放宽到"测试文件"这种模糊集合，I3 就从"结构保证"退化成"看起来像保证"。
     */
    const isExemptSpecFile = (file: string): boolean => /\.spec\.tsx?$/.test(file);
    const productionFiles = allFiles.filter((file) => !isExemptSpecFile(file));

    it('扫描范围覆盖整个仓库（不含 node_modules / dist）', () => {
      expect(allFiles.length).toBeGreaterThan(100);
      expect(allFiles.some((file) => rel(file).startsWith('services/api/src'))).toBe(true);
      expect(productionFiles.some((file) => rel(file).includes('modules/techpie'))).toBe(true);
    });

    it('调用点非空 —— 出口是存在的（否则这条不变式是空转）', () => {
      const hits = productionFiles.filter((file) => readFileSync(file, 'utf8').includes('cookieHeaderFor('));
      expect(hits.length).toBeGreaterThan(0);
    });

    it('生产代码里全部命中都落在 webview-session/ 目录内', () => {
      const offenders: string[] = [];
      for (const file of productionFiles) {
        const text = readFileSync(file, 'utf8');
        if (!text.includes('cookieHeaderFor(')) continue;
        if (!rel(file).includes('webview-session/')) offenders.push(rel(file));
      }
      expect(offenders).toEqual([]);
    });

    it('§11.22-B 条件 1：豁免面**恰好**是 `*.spec.ts`（没有第二类豁免）', () => {
      const hits = allFiles.filter((file) => readFileSync(file, 'utf8').includes('cookieHeaderFor('));
      const unexplained = hits
        .map(rel)
        .filter((file) => !file.includes('webview-session/') && !/\.spec\.tsx?$/.test(file));
      expect(unexplained).toEqual([]);

      // 反过来：命中集合里**没有**被误当成豁免的 `.test.ts`
      const testTsHits = hits.map(rel).filter((file) => /\.test\.tsx?$/.test(file));
      expect(testTsHits).toEqual([]);
    });

    it('§11.22-B 条件 2：豁免的测试**不随产物发布**（`tsconfig.build.json` 的 exclude 钉死）', () => {
      const buildConfig = JSON.parse(readFileSync(join(API_DIR, 'tsconfig.build.json'), 'utf8')) as {
        include?: string[];
        exclude?: string[];
      };
      // `exclude` 必须**显式**排除 `*.spec.ts`（而不是靠"测试目录"这种模糊边界）
      expect(buildConfig.exclude).toContain('src/**/*.spec.ts');
      // 并且 build 的 include 只覆盖 src（test/ 根本不进产物）
      expect(buildConfig.include).toEqual(['src/**/*.ts']);
    });

    it('端口声明与实现用「属性 + 函数类型」写法（让上面的裸子串扫描保持完备）', () => {
      const portFile = join(API_DIR, 'src/modules/techpie/domain/ports/campus-session.port.ts');
      const portText = readFileSync(portFile, 'utf8');
      expect(portText).toContain('cookieHeaderFor: (userId: string, platform: CampusPlatform) => Promise<string>');
      expect(portText).not.toContain('cookieHeaderFor(');

      const implFile = join(API_DIR, 'src/modules/techpie/data/campus-session.service.ts');
      const implText = readFileSync(implFile, 'utf8');
      expect(implText).toContain('readonly cookieHeaderFor = async');
      expect(implText).not.toContain('cookieHeaderFor(');
    });

    it('`/techpie/items` 不再是主路由（规格 §8.1 冻结的是 `/links`）', () => {
      const controller = readFileSync(join(API_DIR, 'src/modules/techpie/techpie.controller.ts'), 'utf8');
      expect(controller).toContain("@Get('links')");
      expect(controller).not.toContain("@Get('items')");
    });
  });

  /* ================================================================ *
   * 规格 §10.3：凭证绝不进日志（硬要求）
   * ================================================================ */

  describe('§10.3 · 日志脱敏的**结构性**保证', () => {
    it('techpie 模块里**没有任何**日志语句（没有日志语句 = 凭证不可能进日志）', () => {
      const files = sourceFiles(join(API_DIR, 'src/modules/techpie')).filter(
        (file) => !/\.spec\.tsx?$/.test(file),
      );
      expect(files.length).toBeGreaterThan(0);

      const offenders: string[] = [];
      for (const file of files) {
        const text = readFileSync(file, 'utf8');
        if (/\bnew Logger\(|\bconsole\.(log|info|warn|error|debug)\b|\bLogger\b/.test(text)) {
          offenders.push(rel(file));
        }
      }
      expect(offenders).toEqual([]);
    });

    it('campus-card 模块里同样**没有任何**日志语句（付款码是凭证，绝不进日志）', () => {
      const files = sourceFiles(join(API_DIR, 'src/modules/campus-card')).filter(
        (file) => !/\.spec\.tsx?$/.test(file),
      );
      expect(files.length).toBeGreaterThan(0);

      const offenders: string[] = [];
      for (const file of files) {
        const text = readFileSync(file, 'utf8');
        if (/\bnew Logger\(|\bconsole\.(log|info|warn|error|debug)\b|\bLogger\b/.test(text)) {
          offenders.push(rel(file));
        }
      }
      expect(offenders).toEqual([]);
    });

    it('付款码端点显式禁止缓存（`Cache-Control: no-store`）', () => {
      const controller = readFileSync(
        join(API_DIR, 'src/modules/campus-card/campus-card.controller.ts'),
        'utf8',
      );
      expect(controller).toContain("@Header('Cache-Control', 'no-store')");
    });

    it('全局异常过滤器**不打印** `details`（它可能带请求上下文）', () => {
      const filter = readFileSync(join(API_DIR, 'src/common/filters/all-exceptions.filter.ts'), 'utf8');
      const loggerCalls = [...filter.matchAll(/this\.logger\.(?:error|warn|log)\(([\s\S]*?)\);/g)].map(
        (match) => match[1]!,
      );
      expect(loggerCalls.length).toBeGreaterThan(0);
      for (const call of loggerCalls) {
        expect(call).not.toContain('details');
        expect(call).not.toContain('JSON.stringify');
      }
    });

    it('`common/logging/redact.ts` 是白名单式剔除（而不是黑名单过滤）', () => {
      const redact = readFileSync(join(API_DIR, 'src/common/logging/redact.ts'), 'utf8');
      expect(redact).toContain('LOG_FORBIDDEN_KEYS');
      expect(redact).toContain('REDACTED');
      expect(redact).toContain('redactText');
      expect(redact).toMatch(/CASTGC/);
    });

    it('techpie 的错误消息里不插值任何请求字段（凭证不可能经错误消息进日志）', () => {
      const files = sourceFiles(join(API_DIR, 'src/modules/techpie')).filter(
        (file) => !/\.spec\.tsx?$/.test(file),
      );
      for (const file of files) {
        const text = readFileSync(file, 'utf8');
        expect(text).not.toMatch(
          /new \w*Error\(`[^`]*\$\{(?:.*(?:password|credential|authCode|targetUrl|cookie).*)\}/,
        );
      }
    });
  });

  /* ================================================================ *
   * 许可证硬约束（裁决 §11.18-G）的静态侧
   * ================================================================ */

  describe('许可证硬约束（§11.18-G）：不复制任何 TechPie 代码', () => {
    const techpieFiles = sourceFiles(join(API_DIR, 'src/modules/techpie'));

    it('techpie 模块里不出现任何 Dart 源文件引用 / 复制痕迹', () => {
      for (const file of techpieFiles) {
        const text = readFileSync(file, 'utf8');
        expect(text).not.toMatch(/\.dart\b/);
        expect(text).not.toContain('flutter');
        expect(text).not.toContain('techpie-ref');
      }
    });

    it('不出现 TechPie 的 DNS 隧道做法（ecard_bind_hijack 是明确不抄的）', () => {
      for (const file of techpieFiles) {
        const text = readFileSync(file, 'utf8');
        expect(text).not.toContain('ecard_bind_hijack');
        expect(text).not.toMatch(/dns.*tunnel|tunnel.*dns/i);
      }
    });
  });

  /* ================================================================ *
   * 脚手架与手写实现的边界（任务：把 campus-card / schedule 移出 SPEC）
   * ================================================================ */

  describe('脚手架边界 · `scripts/scaffold.mjs` 不得覆盖手写实现', () => {
    const scaffoldSource = readFileSync(join(API_DIR, 'scripts/scaffold.mjs'), 'utf8');

    /** 从 `const SPEC = [ … ];` 里抽出模块 id */
    function specIds(): string[] {
      const match = /const SPEC = \[([\s\S]*?)\n\];/.exec(scaffoldSource);
      expect(match).not.toBeNull();
      return [...match![1]!.matchAll(/^\s{4}id: '([^']+)'/gm)].map((item) => item[1]!);
    }

    it('SPEC 表里**没有** campus-card / schedule / techpie（否则重跑 scaffold 会覆盖手写实现）', () => {
      const ids = specIds();
      expect(ids).not.toContain('campus-card');
      expect(ids).not.toContain('schedule');
      expect(ids).not.toContain('techpie');
      // 表本身非空（否则这条断言是空转）
      expect(ids.length).toBeGreaterThan(0);
    });

    it('campus-card 是手写实现（有 §11.21-B 的五条端点，没有 `items` / `summary`）', () => {
      const raw = readFileSync(
        join(API_DIR, 'src/modules/campus-card/campus-card.controller.ts'),
        'utf8',
      );
      // 剥掉注释再断言 —— 文件头会**说明**旧形状长什么样（"原先是 @Get('items')/summary"），
      // 那是文档，不是代码。不剥注释的话，做对的事情反而会让测试失败。
      const controller = raw
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .map((l) => l.replace(/\/\/.*$/, ''))
        .join('\n');
      for (const route of ["@Get('account')", "@Post('account/activate')", "@Delete('account')", "@Get('transactions')", "@Get('payment-code')"]) {
        expect(controller).toContain(route);
      }
      expect(controller).not.toContain("@Get('items')");
      expect(controller).not.toContain("@Get('summary')");
    });

    it('`AssertAssignable` 只有**一种**拼法（生成器与产物不再漂移）', () => {
      // 生成器（scaffold.mjs）是这些文件的声明式来源，因此以它为准。
      expect(scaffoldSource).toContain('type AssertAssignable<Target, _Actual extends Target> = true;');
      expect(scaffoldSource).not.toContain('AssertAssignable<Target, Actual');

      const offenders: string[] = [];
      for (const file of sourceFiles(join(API_DIR, 'src'))) {
        const text = readFileSync(file, 'utf8');
        if (text.includes('AssertAssignable<Target, Actual')) offenders.push(rel(file));
      }
      expect(offenders).toEqual([]);
    });
  });
});

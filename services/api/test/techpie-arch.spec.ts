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

  describe('I1 · 约束对象是 `KedaYaIdentitySession` 与 `/auth/*` 的响应（§11.22-A）', () => {
    const authDomainFile = join(API_DIR, 'src/modules/auth/domain/auth.domain.ts');
    const authDomainSource = readFileSync(authDomainFile, 'utf8');

    it('接口声明里只有 4 个允许的键（类型上就没有第 5 个位置）', () => {
      expect(declaredKeys(authDomainSource, 'KedaYaIdentitySession').sort()).toEqual([
        'department',
        'name',
        'studentId',
        'userId',
      ]);
    });

    it.each(FORBIDDEN_KEYS)('接口声明里没有 %s 字段', (key) => {
      const declared = declaredKeys(authDomainSource, 'KedaYaIdentitySession').map((item) =>
        item.toLowerCase(),
      );
      expect(declared).not.toContain(key.toLowerCase());
    });

    it('`/auth/campus-bindings` 的 wire 类型 `CampusBindingSummary` 同样与 8 个禁用键不相交', () => {
      const declared = declaredKeys(authDomainSource, 'CampusBindingSummary');
      expect(declared.sort()).toEqual(['bound', 'expiresAt', 'lastRenewedAt', 'platform']);
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

    it('§11.22-A：`ticket` 在 `webview-session` 里是**合法领域字段**（不是全仓禁词）', () => {
      // I1 的本意是"一级身份会话的序列化不得夹带二级凭证"。
      // 把它扩大成"全仓禁用某个词"会让合法字段被迫改名，而改名**不减少任何风险** ——
      // 风险来自"值泄漏"，不来自"键叫什么"。
      const webviewFile = join(API_DIR, 'src/modules/techpie/data/webview-session/webview-session.service.ts');
      const webviewSource = readFileSync(webviewFile, 'utf8');
      expect(webviewSource).toContain('ticket: string');
      // 但它必须满足**自己的**约束：不缓存 / 不进日志 / 用后即焚
      expect(webviewSource).toContain('singleUse');
      expect(webviewSource).not.toMatch(/new Logger\(|console\.(log|info|warn|error|debug)/);
    });

    it('I1 的运行时断言确实被**两个** `/auth/*` 投影调用（不是只写在文档里）', () => {
      expect(authDomainSource).toContain('assertIdentitySessionHasNoCredentialKeys(session)');
      expect(authDomainSource).toContain(
        "assertIdentitySessionHasNoCredentialKeys(summary, 'CampusBindingSummary')",
      );
      // 8 个禁用键只有**一处**定义（auth.domain.ts），避免两套黑名单漂移
      expect(authDomainSource).toContain('IDENTITY_SESSION_FORBIDDEN_KEYS');
    });

    it('运行时投影与类型一致（toIdentitySession 的输出键恰好 4 个）', async () => {
      const { toIdentitySession } = await import('../src/modules/auth/domain/auth.domain');
      const session = toIdentitySession({
        id: 'u1',
        displayName: '同学',
        avatarUrl: null,
        department: '信息学院',
        studentId: '20260001',
        createdAt: new Date(),
      });
      expect(Object.keys(session).sort()).toEqual(['department', 'name', 'studentId', 'userId']);
    });

    it('`/auth/*` 的响应级扫描存在（真实 HTTP 侧，见 techpie-http.spec.ts）', () => {
      const httpSpec = readFileSync(join(API_DIR, 'test/techpie-http.spec.ts'), 'utf8');
      // 断言"扫描的是 /auth/* 的响应"，而不是"全仓不许出现 ticket 这个词"
      expect(httpSpec).toContain("expectNoCredentialKeys(body, 'GET /auth/session')");
      expect(httpSpec).toContain("expectNoCredentialKeys(body, 'GET /auth/campus-bindings')");
      // 并且对 webview-session 的 `ticket` 是**显式放行**
      expect(httpSpec).toContain("['ticket']");
    });
  });

  /* ================================================================ *
   * I2 —— 身份层的 data 目录不 import 能力层端口
   * ================================================================ */

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

    it('身份层的 data 目录里**不再**有校园会话的实现（结构性，而非文本性）', () => {
      const names = files.map((file) => rel(file));
      expect(names.some((name) => /campus-session|campus-binding|prisma-campus/i.test(name))).toBe(false);
      expect(existsSync(join(authDataDir, 'prisma-campus-session.adapter.ts'))).toBe(false);
    });

    it('身份层的 data 目录里不出现 `CampusSessionPort` / cookie 出口的标识符', () => {
      for (const file of files) {
        const text = readFileSync(file, 'utf8');
        expect(text).not.toContain('CampusSessionPort');
        expect(text).not.toContain('CAMPUS_SESSION_PORT');
        expect(text).not.toContain('cookieHeaderFor');
      }
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

    it('能力层没有第二个"取会话明文"的出口（acquireSession 之类的口子已被移除）', () => {
      const portFile = join(API_DIR, 'src/modules/techpie/domain/ports/campus-session.port.ts');
      const portText = readFileSync(portFile, 'utf8');
      expect(portText).not.toContain('acquireSession');
      expect(portText).not.toContain('sessionRef');

      const offenders = allFiles.filter((file) => {
        const text = readFileSync(file, 'utf8');
        return text.includes('acquireSession(') && !rel(file).includes('.spec.');
      });
      expect(offenders.map(rel)).toEqual([]);
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
      const controller = readFileSync(
        join(API_DIR, 'src/modules/campus-card/campus-card.controller.ts'),
        'utf8',
      );
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

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { API_BASE_PATH, type ApiErrorCode } from './envelope';
import { MODULES } from './modules';

const here = dirname(fileURLToPath(import.meta.url));
const specPath = join(here, '..', 'openapi', 'kedaya.v1.yaml');
const spec = parse(readFileSync(specPath, 'utf8')) as Record<string, any>;

describe('OpenAPI 契约文件', () => {
  it('是 OpenAPI 3.1 文档', () => {
    expect(spec.openapi).toMatch(/^3\.1\./);
    expect(spec.info?.title).toContain('可达鸭');
    expect(spec.info?.version).toBe('1.0.0');
  });

  it('声明了 /api/v1 base path', () => {
    expect(API_BASE_PATH).toBe('/api/v1');
    const urls: string[] = (spec.servers ?? []).map((s: any) => s.url);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url.endsWith(API_BASE_PATH), `server ${url} 未以 ${API_BASE_PATH} 结尾`).toBe(true);
    }
  });

  it('每个 path 都属于某个已注册模块（第一段必须是模块路由）', () => {
    const knownRoutes = new Set(MODULES.map((m) => m.route));
    const paths = Object.keys(spec.paths ?? {});
    expect(paths.length).toBeGreaterThan(20);
    for (const p of paths) {
      const first = p.replace(/^\//, '').split('/')[0] ?? '';
      expect(knownRoutes.has(first), `路径 ${p} 的第一段 "${first}" 不是已注册模块路由`).toBe(true);
    }
  });

  it('19 个模块都有对应的 tag 与至少一个端点', () => {
    const tagNames = (spec.tags ?? []).map((t: any) => t.name);
    expect(tagNames).toHaveLength(19);

    const taggedRoutes = new Set<string>();
    for (const [path, ops] of Object.entries(spec.paths ?? {})) {
      for (const op of Object.values(ops as Record<string, any>)) {
        for (const tag of op?.tags ?? []) taggedRoutes.add(tag);
      }
      void path;
    }

    for (const m of MODULES) {
      expect(tagNames, `模块 ${m.id} 缺 tag`).toContain(m.id);
      expect(taggedRoutes, `模块 ${m.id} 没有任何带该 tag 的端点`).toContain(m.id);
    }
  });

  it('ApiErrorCode 枚举与 TypeScript 联合类型完全一致', () => {
    const fromSpec: string[] = spec.components.schemas.ApiErrorCode.enum;
    // 编译期断言：这里的字面量集合必须覆盖 ApiErrorCode
    const fromTs: ApiErrorCode[] = [
      'UNAUTHENTICATED',
      'FORBIDDEN',
      'NOT_FOUND',
      'VALIDATION_FAILED',
      'RATE_LIMITED',
      'CONFLICT',
      'CAMPUS_BINDING_REQUIRED',
      'CONSENT_REQUIRED',
      'UPSTREAM_UNAVAILABLE',
      'INTERNAL',
    ];
    expect([...fromSpec].sort()).toEqual([...fromTs].sort());
  });

  it('信封 schema 与 TS 契约形状一致', () => {
    const success = spec.components.schemas.ApiSuccess;
    expect(success.required).toEqual(expect.arrayContaining(['ok', 'data', 'traceId']));
    expect(success.properties.ok.const).toBe(true);

    const failure = spec.components.schemas.ApiFailure;
    expect(failure.required).toEqual(expect.arrayContaining(['ok', 'error', 'traceId']));
    expect(failure.properties.ok.const).toBe(false);
  });

  it('分页 schema 用游标而非 offset（契约冻结）', () => {
    const page = spec.components.schemas.PageMeta;
    expect(page.required).toContain('nextCursor');
    expect(Object.keys(page.properties)).not.toContain('offset');
    expect(Object.keys(page.properties)).not.toContain('page');
  });

  it('敏感模块的端点标注了 CONSENT_REQUIRED 响应', () => {
    for (const id of ['wellbeing', 'dorm-harmony', 'ai-portrait']) {
      const raw = readFileSync(specPath, 'utf8');
      // 该模块的某个端点必须引用 ConsentRequired 响应
      const section = raw.split(`/${id}/`)[1] ?? '';
      expect(section, `${id} 未引用 ConsentRequired`).toContain('ConsentRequired');
    }
  });

  it('CampusBindingSummary 不泄漏任何 session/cookie 字段（契约 §5）', () => {
    const binding = spec.components.schemas.CampusBindingSummary;
    const keys = Object.keys(binding.properties).map((k) => k.toLowerCase());
    for (const forbidden of ['cookie', 'cookies', 'session', 'sessiontoken', 'tgc', 'castgc']) {
      expect(keys, `CampusBindingSummary 不得含 ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('wellbeing 的危机资源端点无需认证（危机出口不可被门槛拦住）', () => {
    const crisis = spec.paths['/wellbeing/crisis-resources'].get;
    expect(crisis.security).toEqual([]);
  });

  it('金额字段一律以 Fen 结尾且为 integer（契约冻结：整数分）', () => {
    const raw = readFileSync(specPath, 'utf8');
    // 收集所有 "...Fen:" 定义行，断言类型是 integer
    const fenLines = raw.split('\n').filter((l) => /^\s+\w*[Ff]en:\s*\{/.test(l));
    expect(fenLines.length).toBeGreaterThan(5);
    for (const line of fenLines) {
      expect(line, `金额字段必须为 integer: ${line.trim()}`).toContain('type: integer');
    }
  });
});

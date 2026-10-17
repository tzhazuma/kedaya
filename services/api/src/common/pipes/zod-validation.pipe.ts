import { Body, Injectable, Optional, Query, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';
import { ValidationError } from '../errors/app-error';
import { zodIssuesToDetails } from '../errors/zod-details';

/**
 * 全站唯一的校验实现（契约 §2 冻结 Zod 4.6.7）。
 *
 * 本项目**不使用** class-validator / class-transformer：
 *   · `@nestjs/common` 把它们声明为 optional peer，纯 Zod 不会引入任何额外依赖；
 *   · Zod schema 同时是 TS 类型来源（`z.infer`），避免 DTO 类 + 装饰器双重维护；
 *   · 校验失败统一抛 `ValidationError`，由 AllExceptionsFilter 翻成
 *     `VALIDATION_FAILED` + 字段级 details。
 */
export function parseWith<T>(schema: ZodType<T>, value: unknown, what = '请求参数'): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ValidationError(`${what}不合法`, zodIssuesToDetails(result.error));
  }
  return result.data;
}

/**
 * 全局注册的 Zod 管道（`APP_PIPE`）。不带 schema 时是透传形态 ——
 * 它保证整条管道只有一个校验入口；真正的逐路由校验由
 * `@ZodBody` / `@ZodQuery` 复用同一个 `parseWith`。
 *
 * 构造函数参数必须是 `@Optional()`：`app.module.ts` 用
 * `{ provide: APP_PIPE, useClass: ZodValidationPipe }` 注册它，
 * 此时容器需要能**无参**实例化 —— 没有 `@Optional()` 会得到
 * "Nest can't resolve dependencies of the ZodValidationPipe" 而起不来。
 */
@Injectable()
export class ZodValidationPipe<T = unknown> implements PipeTransform<unknown, T> {
  constructor(
    @Optional() private readonly schema?: ZodType<T>,
    @Optional() private readonly what = '请求参数',
  ) {}

  transform(value: unknown): T {
    if (!this.schema) return value as T;
    return parseWith(this.schema, value, this.what);
  }
}

/** `@ZodBody(schema)` —— 校验并收窄请求体类型 */
export const ZodBody = <T>(schema: ZodType<T>, what = '请求体') =>
  Body(new ZodValidationPipe(schema, what));

/** `@ZodQuery(schema)` —— 校验并收窄查询参数类型 */
export const ZodQuery = <T>(schema: ZodType<T>, what = '查询参数') =>
  Query(new ZodValidationPipe(schema, what));

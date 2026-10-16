import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { ZodValidationPipe } from '../src/common/pipes/zod-validation.pipe';

/**
 * **AppModule 真的能被装配**（架构回归测试）
 *
 * ## 这个测试为什么存在
 *
 * 实现 `buddy` 时，为了做真实 HTTP e2e，需要把 `APP_PIPE` 也注册进测试模块 ——
 * 结果立刻炸了：
 *
 * ```
 * Error: Nest can't resolve dependencies of the ZodValidationPipe (?, Object).
 * ```
 *
 * 根因：`ZodValidationPipe` 的构造函数是 `(schema?: ZodType, what = '请求参数')`，
 * 那两个是**可选配置**而非依赖；而 Nest 对 `useClass` 提供者一律按
 * `design:paramtypes` 做依赖注入，解析 `Object` 失败 → **整个应用起不来**。
 *
 * 也就是说：在本次修复之前，`src/app.module.ts` **无法装配**，
 * `npm start` 起不来，而当时**没有任何测试覆盖这件事**
 * （各模块的 e2e 都自己搭 `@Module`，绕开了 AppModule）。
 *
 * 这个测试把"AppModule 能装配"钉死。它只做 `compile()`（不 `init()`），
 * 因此**不需要数据库**：PrismaService 的连接是懒的（`onModuleInit` 里才连），
 * 而 `compile()` 只实例化提供者。
 */
describe('AppModule 装配（架构回归）', () => {
  it('20 个模块 + 3 个全局提供者可以被 Nest 解析', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  }, 60_000);

  it('全局管道是**实例**而不是待注入的类（这正是原先失败的原因）', () => {
    const pipe = new ZodValidationPipe();
    // 不带 schema 时是透传形态 —— 全局管道本来就该是透传的，
    // 逐路由校验由 @ZodBody / @ZodQuery 复用同一个 parseWith。
    expect(pipe.transform({ any: 'value' })).toEqual({ any: 'value' });
  });
});

/**
 * vitest 全局 setup。
 *
 * 必须在任何 Nest 代码之前加载 `reflect-metadata`：
 * Nest 的依赖注入靠 `Reflect.defineMetadata` / `getMetadata`。
 *
 * 另外说明一个**重要工程决策**：本项目的服务/控制器全部使用
 * **显式 `@Inject(TOKEN)`**，而不是依赖 `design:paramtypes`。
 * 原因是 vitest（rolldown/oxc 转译）不做 `emitDecoratorMetadata`，
 * 若靠参数类型元数据注入，测试环境会直接 DI 失败。
 * 显式 token 让「测试环境」与「tsc 构建产物」行为完全一致。
 */
import 'reflect-metadata';

// 测试用的最小环境变量（避免 ConfigService 取到 undefined 而抛错）
process.env.JWT_SECRET ??= 'test-secret-please-change-me-32-chars';
process.env.JWT_ACCESS_TTL ??= '900';
process.env.JWT_REFRESH_TTL ??= '2592000';
process.env.CAMPUS_SESSION_ENC_KEY ??= '0'.repeat(64);
process.env.CAMPUS_CAS_URL ??= 'https://cas.shanghaitech.edu.cn/cas';
process.env.CAMPUS_SSO_CLIENT_ID ??= 'kedaya-test';
process.env.DATABASE_URL ??= 'postgresql://kedaya:kedaya@localhost:5432/kedaya';
process.env.WELLBEING_CRISIS_HOTLINE ??= '021-12320-5';
// wildlife：位置模糊化密钥（≥32 字节）。缺失时 WildlifeModule **故意**启动失败
// （规格 §9.7 / T14）—— 那条行为由 wildlife 自己的测试显式清空变量来验证。
process.env.WILDLIFE_FUZZ_SECRET ??= 'test-wildlife-fuzz-secret-32-bytes-min!!';

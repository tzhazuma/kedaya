import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json, urlencoded } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { API_BASE_PATH, TRACE_HEADER } from '@kedaya/contracts';

import { AppModule } from './app.module';
import { createEdgeTokenMiddleware } from './common/edge-token.middleware';
import { TraceMiddleware } from './common/middleware/trace.middleware';

/** 请求体上限：base64 图片比原图大 ~33%，8 MB 足够 2 MB 的图 + JSON 外壳 */
const JSON_BODY_LIMIT = '8mb';

/**
 * 可达鸭后端启动入口。
 *
 * 契约 §6.1 的 HTTP 约定在这里落地：
 *   · Base path `/api/v1`（`setGlobalPrefix`）
 *   · `X-KedaYa-Trace` 中间件（生成/透传 traceId，回写响应头）
 *   · Swagger 挂 `/api/v1/docs`
 * 统一响应信封与错误码由 AppModule 里的全局拦截器/过滤器负责。
 */
async function bootstrap(): Promise<void> {
  // bodyParser: false —— 关掉 Nest 默认的 100 KB 请求体上限，改由下面显式注册。
  // 图片走 base64 JSON（见 media.controller.ts 的取舍说明），默认上限会直接 413。
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  // ---- 请求体解析（显式注册，便于控制上限与开关 logger）----
  app.use(
    json({
      limit: JSON_BODY_LIMIT,
      // ⚠️ webhook 验签需要**原始字节**：JSON 重新序列化会改空格与键序，
      // 导致签名必然不匹配。只对 webhook 路径保留 rawBody，
      // 其他路由不额外占内存（图片走 base64 时体积不小）。
      verify: (req, _res, buf) => {
        const url = (req as { url?: string }).url ?? '';
        if (url.includes('/group-bot/webhook/')) {
          (req as { rawBody?: Buffer }).rawBody = buf;
        }
      },
    }),
  );
  app.use(urlencoded({ extended: true, limit: '1mb' }));

  // ---- 契约 §6.1：全局前缀 api/v1 ----
  app.setGlobalPrefix(API_BASE_PATH.replace(/^\//, ''));

  // ---- traceId 中间件 ----
  // 刻意用 app.use() 而不是 MiddlewareConsumer.forRoutes('*')：
  // Express 5 的 path-to-regexp v8 不再接受裸 '*' 通配符
  // （会抛 "Unexpected * at ..."）。app.use 不经过路径匹配，最稳。
  const traceMiddleware = app.get(TraceMiddleware);
  app.use((req: Request, res: Response, next: NextFunction) =>
    traceMiddleware.use(req, res, next),
  );

  // ---- 公网边缘令牌（可选）----
  // 后端经 Cloudflare quick tunnel 暴露在公网，那是**公开 URL**。
  // 设了 `API_EDGE_TOKEN` 就要求所有请求带 `x-edge-token`（`/health` 豁免）。
  // 未设置时完全放行 —— 本地开发与内网部署零影响。
  app.use(createEdgeTokenMiddleware(config.get<string>('API_EDGE_TOKEN')));

  // ---- CORS ----
  const configuredOrigins = (config.get<string>('CORS_ORIGINS') ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({
    origin: configuredOrigins.length > 0 ? configuredOrigins : true,
    credentials: true,
    // 让浏览器端 JS 能读到追踪 id
    exposedHeaders: [TRACE_HEADER],
  });

  /**
   * 健康检查 —— 微信云托管 / 负载均衡都要求配置探测路径。
   *
   * 三条刻意的设计：
   *   1. 路径是 `/health`，**不带** `/api/v1` 前缀，也**不走**统一信封
   *      （探测方只关心 HTTP 200，套一层 `{ok,data}` 只会让配置更容易写错）；
   *   2. 用 adapter 直接注册，不经过 Nest 的路由表 —— 这样它不受全局前缀与
   *      全局拦截器影响，也就不会因为业务层改动而失效；
   *   3. 只探**进程存活**，刻意不查数据库：数据库短暂抖动时，
   *      探针失败会让平台反复重启容器，把小故障放大成雪崩。
   *      数据库连通性由业务请求自己暴露（5xx + 日志）。
   */
  app.use('/health', (_req: Request, res: Response) => {
    res.status(200).json({ ok: true, uptimeSec: Math.round(process.uptime()) });
  });

  // ---- Swagger：/api/v1/docs ----
  const swaggerConfig = new DocumentBuilder()
    .setTitle('可达鸭 KedaYa API')
    .setDescription(
      '上海科技大学统一校园服务平台（第三方非官方）。' +
        '所有响应统一为 ApiEnvelope：成功 { ok:true, data, traceId } / 失败 { ok:false, error, traceId }。',
    )
    .setVersion('v1')
    .addBearerAuth()
    .addGlobalParameters({
      name: TRACE_HEADER,
      in: 'header',
      required: false,
      description: '链路追踪 id（不传则服务端生成，并回写到同名响应头）',
    })
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup(`${API_BASE_PATH}/docs`, app, document);

  const port = Number(config.get<string>('PORT') ?? 3000);
  await app.listen(port);

  logger.log(`可达鸭 API 已启动 → http://localhost:${port}${API_BASE_PATH}`);
  logger.log(`Swagger 文档       → http://localhost:${port}${API_BASE_PATH}/docs`);
}

void bootstrap();

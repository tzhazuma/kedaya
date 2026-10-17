import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import { API_BASE_PATH, TRACE_HEADER } from '@kedaya/contracts';

import { AppModule } from './app.module';
import { TraceMiddleware } from './common/middleware/trace.middleware';

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
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

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

  const port = Number(config.get<string>('PORT') ?? 3001);
  await app.listen(port);

  logger.log(`可达鸭 API 已启动 → http://localhost:${port}${API_BASE_PATH}`);
  logger.log(`Swagger 文档       → http://localhost:${port}${API_BASE_PATH}/docs`);
}

void bootstrap();

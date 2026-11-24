import { ConfigModule } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";

import { WechatOfficialAccountService } from "./application/wechat-official-account.service";
import { WechatModule } from "./wechat.module";

/**
 * 回归：`WechatOfficialAccountService` 的 `fetcher` 曾经写成
 * `private readonly fetcher: typeof fetch = fetch`。
 *
 * 单元测试都是直接 `new`，所以一直绿；但 Nest 会把**默认参数**当成必填依赖去解析
 * index 1，`AppModule` 启动时直接 `UnknownDependenciesException`（2026-11-24 在
 * 10.19.138.148 部署时才发现）。这条测试用真实的 Nest 容器编译一次模块，
 * 把"能不能被解析"变成 CI 能看见的断言。
 */
describe("WechatModule 的依赖装配", () => {
  it("Nest 能解析出 WechatOfficialAccountService", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        WechatModule,
      ],
    }).compile();

    expect(moduleRef.get(WechatOfficialAccountService)).toBeInstanceOf(
      WechatOfficialAccountService,
    );

    await moduleRef.close();
  });
});

import { describe, expect, it, vi } from "vitest";

import { WechatOfficialAccountService } from "./wechat-official-account.service";

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function page(articleId: string, title: string) {
  return {
    article_id: articleId,
    update_time: 1_700_000_000,
    content: {
      news_item: [
        {
          title,
          digest: "摘要",
          url: `https://mp.weixin.qq.com/s/${articleId}`,
          content:
            "<p>11月25日 14:00 在信息学院 1-101 举办讲座</p><p>请报名</p>",
        },
      ],
    },
  };
}

describe("认证公众号官方同步", () => {
  it("用 authorizer_access_token 分页读取，正文只转为当次抽取行", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          total_count: 21,
          item_count: 20,
          item: [page("a1", "讲座一")],
        }),
      )
      .mockResolvedValueOnce(
        response({
          total_count: 21,
          item_count: 1,
          item: [page("a2", "讲座二")],
        }),
      );
    const service = new WechatOfficialAccountService(
      {
        get: (key: string) =>
          key === "WECHAT_OFFICIAL_ACCOUNTS"
            ? JSON.stringify([
                {
                  key: "shtu",
                  name: "上海科技大学",
                  authorizerAccessToken: "authorized",
                },
              ])
            : undefined,
      } as never,
      fetcher,
    );

    const articles = await service.listPublished("shtu");
    expect(articles.map((article) => article.articleId)).toEqual(["a1", "a2"]);
    expect(articles[0]?.bodyLines.join("\n")).toContain("11月25日");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[0]).toContain("access_token=authorized");
    expect(
      JSON.parse((fetcher.mock.calls[0]?.[1] as RequestInit).body as string),
    ).toMatchObject({ offset: 0, count: 20, no_content: 0 });
    expect(
      JSON.parse((fetcher.mock.calls[1]?.[1] as RequestInit).body as string),
    ).toMatchObject({ offset: 20 });
  });

  it("未配置账号和权限不足都给出明确错误", async () => {
    const empty = new WechatOfficialAccountService(
      { get: () => undefined } as never,
      vi.fn(),
    );
    await expect(empty.listPublished("unknown")).rejects.toThrow(
      "未配置公众号",
    );

    const fetcher = vi
      .fn()
      .mockResolvedValue(
        response({ errcode: 48001, errmsg: "api unauthorized" }),
      );
    const service = new WechatOfficialAccountService(
      {
        get: () =>
          JSON.stringify([
            {
              key: "shtu",
              name: "上海科技大学",
              authorizerAccessToken: "authorized",
            },
          ]),
      } as never,
      fetcher,
    );
    await expect(service.listPublished("shtu")).rejects.toThrow("48001");
  });

  it("账号公开信息不包含 appSecret 或访问令牌", () => {
    const service = new WechatOfficialAccountService(
      {
        get: () =>
          JSON.stringify([
            {
              key: "shtu",
              name: "上海科技大学",
              appId: "secret-id",
              appSecret: "secret",
              authorizerAccessToken: "token",
            },
          ]),
      } as never,
      vi.fn(),
    );
    expect(service.accounts()).toEqual([{ key: "shtu", name: "上海科技大学" }]);
  });
});

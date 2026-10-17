# data —— 适配器层

契约 §7：实现 `domain/ports` 的接口。**只有本层可以发网络请求**。

```
data/
├── api/client.ts        # 唯一 HTTP 出口：/api/v1 + Bearer + X-KedaYa-Trace + Idempotency-Key
├── schemas/             # zod 传输层校验（含与 domain 模型的双向类型断言）
├── repositories/        # 端口实现（http）+ 运行时工厂
└── mock/                # 内存适配器（无后端可跑）+ 数据集
```

## 切换 mock / 真实后端

| 环境变量 | 作用 |
| --- | --- |
| `NEXT_PUBLIC_KEDAYA_USE_MOCK` | 默认 `true`（走 mock）；设为 `false` 走 HTTP |
| `NEXT_PUBLIC_KEDAYA_API_BASE` | 默认 `/api/v1` |
| `NEXT_PUBLIC_KEDAYA_DEMO_TOKEN` | 演示用 Bearer token（**仅演示**，真实登录走契约 §5 身份层） |

## 契约对齐

- 列表一律游标分页（`cursor` / `limit`），不用 offset。
- 金额一律整数分（`priceFen`），时间一律 ISO-8601 UTC 字符串。
- 错误一律 `ApiError { code, message, details? }`，错误码取自冻结的 `ApiErrorCode`。
- mock 出站数据也过 zod 校验，避免"mock 能跑、后端一接就炸"。

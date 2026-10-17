# platform —— 平台差异适配

契约 §7：`platform/` 放"同一份逻辑、不同平台实现不同"的东西。

| 文件 | 内容 | 状态 |
| --- | --- | --- |
| `env.ts` | 构建期公开环境变量（`NEXT_PUBLIC_*`）、运行模式（mock/http） | ✅ |
| `share.ts` | Web Share API → 剪贴板兜底 | ✅（未接入 UI） |
| `analytics.ts` | 本地埋点环形缓冲 + 可注入 sink（**不接任何第三方 SDK**，契约 §9 隐私优先） | ✅（未接入 UI） |

## 尚未实现（Web 端平台能力）

- `scanner`：小程序端用 `Taro.scanCode`；Web 端需 `BarcodeDetector` / 摄像头权限流程，未实现。
- `notification`：小程序订阅消息 / 原生推送；Web 端需 `Notification.requestPermission()` 流程，未实现。
- `storage`：契约 §8 的"启动时 hydrate 缓存"目前只做了主题偏好（`localStorage`），
  业务缓存（拼单列表离线优先）未实现 —— 见 `apps/web/README.md`「未实现」。

# 交付状态总览

> 2026-11-25。只写**已验证**的事实；没验证的写「未验证」，做不到的写「不做的原因」。

## 1. 安装包（`mobile-v0.1.7`，已发布）

| 平台 | 资产 | 大小 | 状态 |
| --- | --- | --- | --- |
| Android | `kedaya-0.1.7-android-universal-debug-signed.apk` | 64 MB | debug 签名，可装可跑，不能上架 |
| iOS | `kedaya-0.1.7-ios-unsigned.zip` | 11.7 MB | **未签名** `Runner.app`，需在你 Mac 上重签 |
| Windows x64 | `setup.exe` + `portable.zip` | 11.7 / 13.8 MB | 可用 |
| Windows arm64 | `portable-experimental.zip` | 13.1 MB | 实验性，未真机验证 |
| Linux x64 | `tar.gz` + `deb` | 20.3 / 16.1 MB | 可用 |
| Linux arm64 | `tar.gz` + `deb` | 20.3 / 16.2 MB | 交叉编译 + qemu 跑过 AOT |
| macOS arm64 | `dmg` + `zip` | 25.0 / 21.8 MB | 未签名，首次打开需右键 |
| HarmonyOS | `release-unsigned.hap` | 26.2 MB | **未签名**，`hdc install` 会被拒 |
| 微信小程序 | `miniapp-weapp.zip` | 1.9 MB | 导入开发者工具可用；上传需真实 AppID |
| 校验 | `SHA256SUMS` × 4 | — | 各平台独立 |

macOS / iOS 的本地构建步骤见 `docs/build/apple.md`；鸿蒙见 `docs/build/harmonyos.md`
（注意：`jbr\bin` 必须进 PATH，否则报 `00308018`）；小程序见 `docs/build/miniapp.md`。

## 2. 验证证据（2026-11-25 实跑）

| 包 | 结果 |
| --- | --- |
| `@kedaya/api` | **1838 通过 / 3 失败 / 15 跳过**（3 个失败是 `techpie-arch` 既有基线） |
| `@kedaya/web` | **846 通过 / 1 失败**（`buddy-tokens` 既有基线） |
| `@kedaya/miniapp` | **1492 通过 / 0 失败** |
| `apps/mobile`（Flutter） | **1246 通过 / 0 失败**，`flutter analyze` 0 issue |
| `@kedaya/miniapp` 构建 | `build:weapp` + `verify:weapp` 通过；主包 1.73 MiB（上限 2） |
| HAP | `flutter build hap --release` 通过，`pack.info` 版本 0.1.7+8 |

两条既有红灯**不是本次引入**，但会让 `main` 的 CI 一直是红的：

- `services/api/test/buddy-http.spec.ts` 4 例：依赖真实 Postgres，本地无库被跳过、CI 跑真库时失败；
- `apps/web/src/presentation/theme/buddy-tokens.test.ts` 1 例：`buddy` 组件里扫到了请求字样。

## 3. 功能矩阵（按端）

| 能力 | 小程序 | Web | Flutter |
| --- | --- | --- | --- |
| 校园活动：列表 / 详情 / 手动新建 | ✅ | — | ✅ |
| 公众号**单篇**导入 | ✅ | ✅（无状态） | ✅ |
| 公众号**历史页**批量导入 | ✅ | — | ✅ |
| 校园邮箱绑定 / 同步 / 提升 | ✅ | — | ✅ |
| 活动导出日历（ICS） | ✅ | ✅（导出） | ✅ |
| 提醒（站内信） | ✅ | — | ✅ |
| 校园卡：绑定码 / 余额 / 流水 / 付款码 | mock | — | 注入密钥后可用 |
| ELRC 录播 / OA 场馆 / CAS 登录 | — | — | ✅ |
| 知枢五页（日报 / JARVIS / 资料库 / 知乎 / QQ） | ✅ | — | ✅ |

## 4. 明确做不到的（不是「还没做」）

| 事项 | 原因 |
| --- | --- |
| **自动**抓取任意公众号的历史文章 | 微信无公开接口；那一页只存在于微信客户端内部的会话（`wap_sid2`），从外部拿等于逆向客户端。本项目的做法是**解析用户自己保存的页面**，不抓取、不带 Cookie |
| 读取用户关注的公众号列表 | 同上，且微信未开放该数据 |
| 校园卡真实余额（默认构建） | 需要 `secrets.KEDAYA_ECARD_BIND_TOKEN`；且 `ecard.shanghaitech.edu.cn` 在校外解析不到，需校内网 |
| 小程序上传发布 | 需要真实小程序 AppID + 已备案服务器域名 |
| 微信订阅消息 / APNs / FCM / HMS 真实下发 | 代码与登记流程已有，缺各自的模板 ID、证书与厂商配置 |

## 5. 交给用户的三件事

1. **校内网**跑一次校园卡绑定（`Settings → Secrets` 配 `KEDAYA_ECARD_BIND_TOKEN` 后出包）；
2. **你的 Mac** 上按 `docs/build/apple.md` 重签 iOS / macOS 产物；
3. **微信公众平台**提供小程序 AppID 与备案域名。

# 交付状态总览

> 2026-11-25。只写**已验证**的事实；没验证的写「未验证」，做不到的写「不做的原因」。

## 1. 安装包（`mobile-v0.1.8`，已发布）

| 平台 | 资产 | 大小 | 状态 |
| --- | --- | --- | --- |
| Android | `kedaya-0.1.8-android-universal-debug-signed.apk` | 64 MB | debug 签名，可装可跑，不能上架 |
| iOS | `kedaya-0.1.8-ios-unsigned.zip` | 11.7 MB | **未签名** `Runner.app`，需在你 Mac 上重签 |
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
| `@kedaya/api` | **1842 通过 / 0 失败 / 15 跳过** |
| `@kedaya/web` | **847 通过 / 0 失败** |
| `@kedaya/miniapp` | **1496 通过 / 0 失败** |
| `apps/mobile`（Flutter） | **1251 通过 / 0 失败**，`flutter analyze` 0 issue |
| `@kedaya/miniapp` 构建 | `build:weapp` + `verify:weapp` 通过；主包 1.73 MiB（上限 2） |
| HAP | `flutter build hap --release` 通过，`module.json` 为 `versionName 0.1.8 / versionCode 9` |

2026-11-25 修掉两处「假红灯」：`techpie-arch.spec.ts` 与 `buddy-tokens.test.ts`
用 `/` 比较路径，而 Windows 上 `path.relative` 产出 `\`，于是本地恒红、Linux CI 恒绿。
归一化后本地与 CI 一致，两套测试都是 0 失败。

**仍红的是 CI 侧**：`services/api/test/buddy-http.spec.ts` 4 例依赖真实 Postgres，
本地无库被跳过、CI 跑真库时失败——这不是本地能复现的问题。
另有 `npm run lint -w @kedaya/api` 5 项既有未使用变量。

## 3. 功能矩阵（按端）

| 能力 | 小程序 | Web | Flutter |
| --- | --- | --- | --- |
| 校园活动：列表 / 详情 / 手动新建 | ✅ | — | ✅ |
| 公众号**单篇**导入 | ✅ | ✅（无状态） | ✅ |
| 公众号**历史页**批量导入 | ✅ | — | ✅ |
| 校园邮箱绑定 / 同步 / 提升 | ✅ | — | ✅ |
| 活动导出日历（ICS） | ✅ | ✅（导出） | ✅ |
| 提醒（站内信） | ✅ | — | ✅ |
| 校园卡：绑定码 / 余额 / 流水 / 付款码 | mock | — | 注入 `KEDAYA_ECARD_BIND_TOKEN` 后可绑定；真实数据需校园网 |
| ELRC 录播 / OA 场馆 / CAS 登录 | — | — | ✅ |
| 知枢五页（日报 / JARVIS / 资料库 / 知乎 / QQ） | ✅ | — | ✅ |

## 4. 明确做不到的（不是「还没做」）

| 事项 | 原因 |
| --- | --- |
| **自动**抓取任意公众号的历史文章 | 微信无公开接口；那一页只存在于微信客户端内部的会话（`wap_sid2`），从外部拿等于逆向客户端。本项目的做法是**解析用户自己保存的页面**，不抓取、不带 Cookie |
| 读取用户关注的公众号列表 | 同上，且微信未开放该数据 |
| 校园卡真实余额（默认构建） | 需要 `secrets.KEDAYA_ECARD_BIND_TOKEN`；且 `ecard.shanghaitech.edu.cn` 在本机被代理伪解析到别的学校（见 `docs/campus-integration-status.md` §3.3 复测），需校园网 |
| 校园邮箱真实同步 | 2026-11-25 实测：`imap.shanghaitech.edu.cn:993` TLS 正常（证书 `*.shanghaitech.edu.cn`，DigiCert），但 `LOGIN` 对 `tangzhh2026@…`、`tangzhh2026`、学号三种用户名都返回 `NO LOGIN Login error or password error` —— **邮箱密码与 eGate 不同，或需要客户端专用密码** |
| 公众号历史列表自动获取 | 微信 4.x 的内置 webview 不开 CDP 调试端口（9222 上是 Edge，不是微信）；手机端需抓包或 root 读缓存，均越界 |
| 小程序上传发布 | 需要真实小程序 AppID + 已备案服务器域名 |
| 微信订阅消息 / APNs / FCM / HMS 真实下发 | 代码与登记流程已有，缺各自的模板 ID、证书与厂商配置 |

## 5. 交给用户的三件事

1. **校内网**跑一次校园卡绑定（`Settings → Secrets` 配 `KEDAYA_ECARD_BIND_TOKEN` 后出包）；
2. **你的 Mac** 上按 `docs/build/apple.md` 重签 iOS / macOS 产物；
3. **微信公众平台**提供小程序 AppID 与备案域名。

# 微信小程序构建与导入

产物：`kedaya-<version>-miniapp-weapp.zip`（只有 `dist/` + `project.config.json` + `README.txt`，
不含源码与 `node_modules`，1.9 MB）。

这个包**不是安装包**：微信小程序没有可分发安装文件的概念，它由微信开发者工具上传、
经微信审核后由用户在微信里打开。因此这个 zip 的用途是「让别人一步导入、直接点上传」。

---

## 1. 从源码构建

```bash
npm ci
npm run build:weapp
npm run verify:weapp -w @kedaya/miniapp
```

`verify:weapp` 会断言主包体积（上限 2 MiB）、全部分包页面齐全、构建指纹一致。
2026-11-25 的实测：主包 1.73 MiB、wildlife 分包 0.98 MiB、537 个模块工厂。

## 2. 打包成可导入的 zip

```bash
npm run build:weapp
mkdir -p stage && cp -r dist stage/dist && cp project.config.json stage/
(cd stage && zip -qr ../kedaya-<version>-miniapp-weapp.zip .)
```

## 3. 导入微信开发者工具

1. 解压；
2. 微信开发者工具 → **导入项目** → 选这个目录；
3. `AppID` 填**你自己的**小程序 AppID。

`project.config.json` 里的 `appid` 是游客占位值（`touristappid` 系）：
游客模式只能看界面，**不能上传、不能在真机预览、不能调云能力**。

个人 AppID 建议写进 `project.private.config.json`（仓库已 `gitignore`），
不要改公共的 `project.config.json`，否则会污染其他人的配置。

## 4. 上传前还缺什么

| 依赖 | 状态 | 说明 |
| --- | --- | --- |
| 小程序 AppID | **未提供** | 仓库里是占位值，须由项目所有者提供 |
| 服务器域名备案 | **未配置** | `request` 合法域名必须是小程序后台登记过的备案域名；本地调试可勾「不校验合法域名」 |
| 业务域名（`web-view`） | 不使用 | 公众号链接只复制、不开 `web-view`，因此不需要业务域名备案 |
| 微信订阅消息模板 | **未申请** | 无真实模板 ID 时，推送渠道在小程序里显示为「未接通」 |

**这四项都不是代码问题**，是账号/资质问题：拿到 AppID 后，第 1–3 项在微信后台各点几下即可，
第 4 项需要申请模板并等审核。

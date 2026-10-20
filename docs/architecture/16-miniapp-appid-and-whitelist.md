# 16 · 小程序真实 appid 与服务器域名白名单：怎么拿到、怎么配

> 2026-10-20。回答：「白名单的话请你给出如何去获得真实appid，以及进行请求白名单，你看看能不能帮我操作」。

---

## 0. 先说结论：**这两步我替你做不了，但我可以给你最省事的路径**

| 步骤 | 我能做 | 你做 |
| --- | --- | --- |
| 拿到真实 appid | ❌ | ✅ 5 分钟 |
| 配 downloadFile 白名单 | ❌ | ✅ 3 分钟 |
| 把 appid 写进项目配置 | ✅ | — |
| 验证白名单生效 | ✅ | — |

**为什么我做不了**：两个动作都需要**微信账号身份**（注册 / 管理员扫码），
而在我这个环境里：

- `wechatwebdevtools` 的 CLI 需要手动在 IDE 里开启 **Service Port** 才能用
  （实测：`cli islogin` 返回 `IDE service port disabled`）；
- `mp.weixin.qq.com` 后台登录必须**管理员本人微信扫码**；
- 就算拿到 appid + secret，`wxa/modify_domain_directly` **只对「第三方平台」账号开放**，
  普通小程序账号调不了（见 §3）。

---

## 1. 拿到真实 appid（5 分钟）

**如果你们已经有小程序**：管理员在
`mp.weixin.qq.com` → 设置 → 基本设置 → **AppID(小程序ID)**，形如 `wx` + 16 位十六进制。

**如果还没有**（大概率是这个情况）：去
[`mp.weixin.qq.com/cgi-bin/registermidpage`](https://mp.weixin.qq.com/cgi-bin/registermidpage)
注册，选「小程序」。

| 项 | 说明 |
| --- | --- |
| 主体类型 | 选 **个人**最快（当天可下号）；选「企业/组织」需要营业执照或学校证明 |
| 一个邮箱只能注册一个 | 别用已绑定公众号的邮箱 |
| 名称 | 建议先用「可达鸭校园服务」这类不侵权的名字；**别叫「可达鸭」**（任天堂已注册，见 ADR 0005） |
| 服务类目 | 选「教育 → 在线教育」或「工具 → 效率」都可以 |

下号后你会拿到 **AppID** 与 **AppSecret**。

### 拿到之后给我

把 AppID 告诉我即可（**AppSecret 不要贴在这里**，它是账号级最高权限凭据）。
或者你自己写进 `apps/miniapp/project.private.config.json`（该文件已在 `.gitignore` 里）：

```json
{
  "appid": "wx你的真实appid",
  "projectname": "kedaya-miniapp"
}
```

我会把它接进构建配置，并**确认它没有被提交进仓库**。

---

## 2. 配 downloadFile 白名单（3 分钟，纯点点点）

**只有这一条路对普通小程序账号有效。** 开发者工具**做不到** ——
它的 CLI 命令列表里没有任何 domain 命令；`project.config.json` 的
`urlCheck: false` 只是「工具内跳过校验」，真机预览和正式版仍受白名单约束。

### 操作路径

```
mp.weixin.qq.com
  → 登录（管理员扫码）
  → 左侧「开发」→「开发管理」
  → 上方「开发设置」
  → 找到「服务器域名」
  → 点「修改」
```

然后在 **downloadFile 合法域名** 里加：

```
https://map.niyiwei.com
```

几条注意：

| 注意 | 说明 |
| --- | --- |
| **只能填 https** | http 会被拒 |
| **不要带路径** | 填 `https://map.niyiwei.com`，不是 `https://map.niyiwei.com/api/x` |
| **每月最多改 50 次** | 想好一次改完 |
| **域名要备案** | 国内主体的小程序要求域名已 ICP 备案；未备案的加不上 |
| 每月额度与「第三方平台 API」分开 | 后台改不计入 API 的 50 次额度 |

### 如果你要一次多配几个

我们涉及的外部域名（按需加）：

| 域名 | 用途 | 必须? |
| --- | --- | --- |
| `https://map.niyiwei.com` | 一图通授权的 54 张照片 | ✅ 不加则真机全空 |
| `https://api.kedaya.app`（或你们的实际 API 域名） | 我们的后端 | ✅ |
| `https://ids.shanghaitech.edu.cn` | 统一身份认证跳板（webview） | 用 webview 才需要 |

> ⚠️ `web-view` 用的是**业务域名**，不是服务器域名。两处要分别配。
> 业务域名还要求把一个校验文件放到对方服务器根目录 —— **校园域名我们做不了**，
> 所以 web-view 打校园站这条路在小程序里是不通的；这条路留给原生端。

---

## 3. 为什么不能用 API 自动配（我试过了）

| 接口 | 限制（官方文档原文） |
| --- | --- |
| `POST /wxa/modify_domain_directly` | 「支持『第三方平台』账号类型代调用……**其他账号类型如无特殊说明，均不可调用**」 |
| `POST /wxa/modify_domain` | 同上，旧接口，同样受限 |

我写了 `tools/set-miniapp-domains.mjs` 实现这条路：**万一**你们有第三方平台资质，
它可以直接配；没有的话，它会把微信的错误码翻译成「下一步该干什么」，
然后明确告诉你「去后台点哪里」。**它不会假装成功。**

```bash
# 只读：看看现在配了什么
WX_APPID=wx... WX_SECRET=... node tools/set-miniapp-domains.mjs --get

# 试运行：只打印将发送的请求体
WX_APPID=wx... WX_SECRET=... node tools/set-miniapp-domains.mjs --add map.niyiwei.com --dry-run
```

---

## 4. 配完之后

告诉我一声，我会：

1. 把真实 appid 接进 `project.config.json`（或让 `project.private.config.json` 覆盖）
2. 重新构建，确认 54 张照片的 URL 都在 whitelist 覆盖范围内
3. 出一份「真机验收清单」给你

---

## 5. 如果你**现在就想在真机看到照片**（不等白名单）

两个临时办法：

| 办法 | 做法 | 代价 |
| --- | --- | --- |
| A. 真机调试模式 | 开发者工具 → 预览 → 手机上打开后，在右上角菜单里开「打开调试」 → 重新进入 | 只对**你自己**有效，别人扫码看不到图 |
| B. 图片走我们的代理 | 服务端加 `/media/proxy?url=...` 转发 `mmbiz`/`niyiwei` 图片 | 需要改代码（约半天），且要考虑版权与缓存 |

**A 是零成本验证**：先确认「代码是对的」，白名单只是最后一道发行门槛。

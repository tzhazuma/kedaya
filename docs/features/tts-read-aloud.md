# 朗读（TTS）—— sherpa-onnx + `vits-piper-zh_CN-xiao_ya-medium`

> 2026-10-31 新建。模块 id 无（这是**能力**，不是业务模块）。

---

## 0. 一句话

把站内的长文本用语音读出来。模型是 `sherpa-onnx` 的
`vits-piper-zh_CN-xiao_ya-medium`（1 个音色，22050 Hz）。

---

## 1. ⚠️ 最重要的架构决策：TTS 跑在**服务端**

模型本体是 **60.3 MB 的 ONNX**。三个客户端都放不下：

| 端 | 约束 | 结论 |
| --- | --- | --- |
| 微信小程序 | 主包上限 **2 MiB**，我们已用 **1.66 MiB** | 放不下 |
| Flutter APK | 已经 **54.5 MB** | 再加 60 MB 不合理 |
| Web | 首屏要下 60 MB | 不可接受 |

所以：**服务端合成一次，客户端只取音频 URL**。一个模型实例服务所有用户，
还能跨用户复用缓存。

### 为什么不做「端上合成」

Flutter 确实有 `sherpa_onnx` 的 Dart 包（还能离线用），但：
- APK 从 54.5 MB 涨到 115 MB
- iOS/鸿蒙要各带一份
- 端上 CPU 与内存占用不可控

**离线朗读是个好特性，但不是这一轮该做的。** 如果将来要做，
路径是「Flutter 端可选下载语音包」，而不是打包进 APK。

---

## 2. 为什么是「先 POST 拿 id，再 GET 取音频」

`GET /tts?text=...` 看起来更简单，但：

1. **URL 长度限制** —— 反代/网关常见 2–8 KB，长文本会被截断
2. **播放器只会发 GET** —— `<audio>` / `InnerAudioContext` / Flutter 播放器
   的 `src` 都只能是 URL，带不上 POST body

所以拆两步：

```
POST /api/v1/tts/synthesize  { text, speed? }
  → { audioId, url, sampleRate, durationMs, byteLength, cached }

GET  /api/v1/tts/audio/:audioId
  → audio/wav（Cache-Control: public, max-age=86400, immutable）
```

---

## 3. 鉴权：为什么合成要登录、取音频不用

| 端点 | 鉴权 | 理由 |
| --- | --- | --- |
| `POST /synthesize` | **必须登录** | 合成是 CPU 密集操作；不设门槛一个匿名脚本就能打满 |
| `GET /audio/:id` | **公开** | 播放器带不上 `Authorization` 头；`audioId` 是内容哈希，而朗读的内容本来就是公开的（FAQ 答案、茶歇说明…） |
| `GET /status` | 公开 | 运维/健康检查用 |

---

## 4. 错误码：把「部署问题」与「输入问题」分开

| 码 | HTTP | 含义 |
| --- | --- | --- |
| `text-empty` | 400 | 没有可朗读的内容 |
| `text-too-long` | 400 | 超过 500 字 |
| `speed-out-of-range` | 400 | 语速不在 0.5–2.0 |
| **`model-unavailable`** | **503** | **模型没下载 —— 部署问题** |
| `synthesis-failed` | 400 | 这次合成失败 |
| `audio-not-found` | 404 | 音频不存在/已清理 |

### 为什么 `model-unavailable` 的文案必须给出命令

```
朗读模型未安装（这是部署问题，不是你的输入问题）。
服务端需运行 `node tools/fetch-tts-model.mjs`。
```

这句话有两个硬要求（**有测试守着**）：
1. 必须含 `fetch-tts-model` —— 否则运维不知道跑什么
2. **不能含「网络」** —— 说成网络问题会让用户去查自己的网，白费时间

---

## 5. 长文怎么处理

单次上限 500 字（约 30–40 秒音频）。更长的文本用 `splitForTts` 切段：

```
优先级：句末标点（。！？；\n） > 逗号（，、,） > 空格 > 硬切
```

⚠️ **不在英文单词中间切**：`RTF` 被切成 `RT` + `F` 会读成「啊提艾弗」。

客户端逐段合成、逐段播放，用户听到的是连续朗读，而不是「文本太长」的报错。

---

## 6. 缓存

- key = `sha256(speed + '|' + text)` 的前 32 位十六进制
- 上限：**200 条 / 256 MB**，LRU 淘汰
- 命中时不返回 WAV（调用方从缓存读），避免重复占内存

FAQ 答案、茶歇说明这类文本会被很多人朗读，跨用户复用是纯赚。

---

## 7. 模型怎么装

```bash
node tools/fetch-tts-model.mjs            # 下载到 services/api/models/
node tools/fetch-tts-model.mjs --check    # 只检查（CI 用，exit 0/1）
node tools/fetch-tts-model.mjs --force    # 重新下载
```

模型目录 `services/api/models/` 在 `.gitignore` 里 —— **60 MB 不进仓库**。
它是部署产物，不是源码。

可用 `TTS_MODEL_DIR` 环境变量覆盖路径（生产常挂只读卷）。

---

## 8. 一个关键的健壮性设计：**没有模型时 API 照常工作**

`sherpa-onnx-node` 是原生插件（33 MB 的 `.node` 二进制）。
如果写成模块级 `import`，那么任何没有对应平台二进制的环境
（CI、只跑单测的开发机）**整个 API 都起不来**。

所以：
- 用 `await import('sherpa-onnx-node')`（动态）
- 失败时 `synthesize()` 返回 `model-unavailable`，**不抛到模块层**

结果是：**没有模型时只有朗读这一个功能报 503，其余 20+ 个模块完全正常。**

---

## 9. 落地位置

| 层 | 文件 | 内容 |
| --- | --- | --- |
| 契约 | `packages/contracts/src/tts.ts` | 限制、错误码、wire 类型、`splitForTts`、`validateTtsRequest` |
| 契约测试 | `packages/contracts/src/tts.test.ts` | **17 条** |
| 服务 | `services/api/src/modules/tts/application/tts.service.ts` | 懒加载、缓存、WAV 编码 |
| 服务测试 | `.../tts.service.spec.ts` | **18 条**（无模型也能跑） |
| 集成测试 | `.../tts.integration.spec.ts` | **6 条**（有模型才跑，CI 自动跳过） |
| 控制器 | `services/api/src/modules/tts/tts.controller.ts` | 3 个端点 |
| 控制器测试 | `.../tts.controller.spec.ts` | **8 条** |
| HTTP 测试 | `services/api/test/tts-http.spec.ts` | **6 条**（真实 Nest 管道） |
| 类型声明 | `services/api/src/types/sherpa-onnx-node.d.ts` | 包不带类型，只手写用到的那一小块 |
| 小程序组件 | `apps/miniapp/src/presentation/components/KdyReadAloud/` | 朗读按钮 |
| 下载工具 | `tools/fetch-tts-model.mjs` | 拉模型 |

---

## 10. 实测数据

| 指标 | 值 |
| --- | --- |
| 模型加载 | **745 ms** |
| 合成 8.44 秒音频 | **0.68 秒** |
| **RTF** | **0.080**（12.5 倍实时） |
| 采样率 | 22050 Hz 单声道 16-bit |
| 音频峰值 / RMS | 20139 / 2458（非静音，有测试断言） |
| 模型体积 | 60.3 MB onnx + 2.0 MB lexicon + 0.2 MB FST |

---

## 11. 已知空缺

| 项 | 状态 |
| --- | --- |
| Web 端朗读按钮 | ❌ 未接（API 已就绪，`<audio>` 直接播 `url`） |
| Flutter 端朗读 | ❌ 未接（同上，`audioplayers` 播 URL） |
| 流式合成（边说边出） | ❌ 未做（现在整段合成完才播） |
| 多音色 / 多语言 | ❌ 只有 1 个中文女声 |
| 音频持久化 | ❌ 只在内存缓存，进程重启即失效 |
| 端上离线合成 | ❌ 见 §1 |

---

## 12. 顺带修掉的一个定时炸弹（与 TTS 无关）

跑全量时发现 `contact-exchange.domain.spec.ts` 有 1 个失败，**与本次改动无关**：

fixture 的 `expiresAt` 是 `2026-10-24`（绝对日期），而测试传 `new Date()` 当 `now`。
所以从 **2026-10-24 起**这条 `PENDING` 请求被惰性判成 `EXPIRED`，
`decideReject()` 返回 `allowed: false` —— 测试从那天起永远失败，**代码一行没改**。

修法：加固定 `const NOW = new Date('2026-10-18T00:00:00Z')`，替换 6 处裸 `new Date()`。
这与该文件其它用例（第 145 / 171 行）已有的约定一致。

> 这是**第三次**遇到同一类问题（前两次是 `buddy.ts` 的 `localAt` 时区、
> 和 `localAt` 的 UTC 偏移）。教训：**测试 fixture 里不该出现绝对日期**。

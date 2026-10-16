# @kedaya/design-tokens

可达鸭**设计令牌** —— 三端共享的视觉唯一真相。

## 核心规则

> **任何一端都不允许手写色值。** 所有颜色、间距、圆角、字号必须来自本包。

## 唯一真相来源

```
tokens.json          ← 只有这个文件需要手改
```

其余全部由生成器派生，**不要手改**：

```
tokens.json ──┬──> src/tokens.generated.ts    Web / 小程序 / 后端（TS）
              ├──> dist/tokens.css            CSS 变量 --kdy-*（Next.js）
              ├──> dist/tokens.scss           SCSS 变量 $kdy-*（Taro 小程序）
              ├──> dist/tokens.js             运行时 ESM
              └──> dart/kedaya_tokens.dart    Flutter KedaYaTokens
```

## 重新生成

```bash
npm run tokens                              # 仓库根目录
npm run generate -w @kedaya/design-tokens   # 或直接跑这个
```

## 命名规则（冻结）

`--kdy-<group>-<kebab-key>`，camelCase 键转 kebab-case：

| tokens.json | CSS | SCSS | Dart |
| --- | --- | --- | --- |
| `color.brandStrong` | `--kdy-color-brand-strong` | `$kdy-color-brand-strong` | `KedaYaTokens.colorBrandStrong` |
| `space.4` | `--kdy-space-4` | `$kdy-space-4` | `KedaYaTokens.space4` |
| `radius.lg` | `--kdy-radius-lg` | `$kdy-radius-lg` | `KedaYaTokens.radiusLg` |
| `fontSize.xxl` | `--kdy-font-size-xxl` | `$kdy-font-size-xxl` | `KedaYaTokens.fontSizeXxl` |

## 各端用法

### Next.js（Web）

```css
/* globals.css */
@import "tailwindcss";
@import "@kedaya/design-tokens/css";

@theme {
  --color-brand: var(--kdy-color-brand);
  --color-ink: var(--kdy-color-ink);
  /* … */
}
```

### Taro（微信小程序）

```scss
@import "@kedaya/design-tokens/scss";

.card {
  background: $kdy-color-surface;
  border-radius: $kdy-radius-lg;
  padding: $kdy-space-4;
}
```

### TypeScript

```ts
import { tokens, cssVar, px } from '@kedaya/design-tokens';

tokens.color.brand;        // '#FFC53D'
cssVar('color', 'brand');  // 'var(--kdy-color-brand)'
px('space', '4');          // '16px'
```

### Flutter

```dart
import 'package:kedaya/../kedaya_tokens.dart';  // 复制 dart/kedaya_tokens.dart 到 lib/

Container(
  color: KedaYaTokens.colorSurface,
  padding: const EdgeInsets.all(KedaYaTokens.space4),
  child: Text('拼单', style: TextStyle(fontSize: KedaYaTokens.fontSizeMd)),
)
```

## 令牌分组

| 组 | 数量 | 说明 |
| --- | --- | --- |
| `color` | 16 | 品牌黄 + 中性色 + 语义色（success/warning/danger/info） |
| `space` | 11 | 4px 基准栅格 |
| `radius` | 5 | sm 4 → pill 999 |
| `fontSize` | 7 | xs 12 → display 32 |
| `lineHeight` | 3 | tight / normal / loose |
| `fontWeight` | 4 | regular 400 → bold 700 |
| `shadow` | 3 | sm / md / lg |
| `fontFamily` | 2 | sans（中文优先）/ mono |
| `zIndex` | 6 | 层级 |

## 品牌色

| 令牌 | 值 | 用途 |
| --- | --- | --- |
| `color.brand` | `#FFC53D` | 可达鸭黄，主色 |
| `color.brandStrong` | `#F08F2A` | 强调 / 按压态 |
| `color.brandSoft` | `#FFF3B8` | 浅底 / 标签背景 |
| `color.ink` | `#1B2436` | 深色背景 / 吉祥物帽色 |

## 加新令牌

1. 改 `tokens.json`
2. `npm run tokens`
3. 提交 `tokens.json` **和**生成产物（四端都要能无构建直接消费）

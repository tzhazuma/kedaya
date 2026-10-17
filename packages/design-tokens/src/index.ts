/**
 * @kedaya/design-tokens
 *
 * 可达鸭设计令牌。唯一真相来源是 `tokens.json`；
 * 本目录下的 `tokens.generated.ts` 和包内的 `dist/*` 全部由
 * `scripts/generate.mjs` 生成，**不要手改**。
 *
 * 重新生成：
 *   npm run tokens              # 仓库根目录
 *   npm run generate -w @kedaya/design-tokens
 */

export {
  tokens,
  cssVar,
  px,
  darkColor,
  type Tokens,
  type ThemeName,
  type ColorToken,
  type SpaceToken,
  type RadiusToken,
  type FontSizeToken,
} from './tokens.generated.js';

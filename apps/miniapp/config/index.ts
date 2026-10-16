import path from 'node:path'

import { defineConfig, type UserConfigExport } from '@tarojs/cli'
import type { IProjectConfig } from '@tarojs/taro/types/compile'

import devConfig from './dev'
import prodConfig from './prod'

/**
 * 设计令牌 SCSS 入口。
 *
 * 契约 §6.2：所有端从 `@kedaya/design-tokens` 派生，**禁止手写色值**。
 * 这里通过 Taro 的 `sass.resource` 把令牌变量全局注入到每一个 `.scss` 文件，
 * 于是组件样式可以直接写 `$kdy-color-brand` / `$kdy-space-4`，无需逐个文件 import。
 *
 * 该入口文件本身只做一件事：`@import` 设计令牌包的派生产物
 * `packages/design-tokens/dist/tokens.scss`。
 */
const TOKENS_SCSS = path.resolve(__dirname, '..', 'src', 'presentation', 'theme', 'tokens.scss')

const baseConfig: UserConfigExport<'webpack5'> = {
  projectName: 'kedaya-miniapp',
  date: '2026-10-16',
  designWidth: 750,
  deviceRatio: { 640: 2.34 / 2, 750: 1, 828: 1.81 / 2, 375: 2 },
  sourceRoot: 'src',
  outputRoot: 'dist',
  plugins: [],
  defineConstants: {},
  copy: { patterns: [], options: {} },
  framework: 'react',
  /**
   * webpack5 是唯一编译器（契约 §2）。
   * 显式关闭 prebundle：它会把预打包产物写进共享的 node_modules 缓存目录，
   * 而本仓库多个工作流并行安装/构建，必须避免对共享目录的隐式写入。
   */
  compiler: { type: 'webpack5', prebundle: { enable: false } },
  cache: { enable: false },
  sass: { resource: [TOKENS_SCSS] },
  mini: {
    /**
     * 必须把 workspace 里的 TS 包纳入 babel-loader 的处理范围。
     *
     * Taro 默认的 script rule 只 include `sourceDir`（apps/miniapp/src），
     * 而 `@kedaya/contracts` / `@kedaya/shared` / `@kedaya/design-tokens` 的
     * `main` 直接指向 **TS 源码**（`./src/index.ts`）。webpack 解析符号链接后拿到的是
     * packages 下各包 src 目录里的真实路径，落在 sourceDir 之外 → 没有 loader →
     * `ModuleParseError: Unexpected token` on `export type ApiErrorCode =`。
     *
     * ⚠️ 这个选项在 **`mini.compile`** 下，**不是**顶层 `compile`：
     *   - `mini.compile.include`  → any[]，真正会 unshift 进 script rule 的 include
     *     （见 @tarojs/taro 的 types/compile/config/mini.d.ts）
     *   - 顶层 `compile.include`  → 属于 IPrebundle（预打包）语义，放这里会被静默忽略
     * 我们踩过一次：写在顶层时构建仍然报 ModuleParseError。
     */
    compile: {
      include: [path.resolve(__dirname, '..', '..', '..', 'packages')],
    },
    postcss: {
      pxtransform: { enable: true, config: {} },
      cssModules: { enable: false },
    },
  },
  h5: {
    publicPath: '/',
    staticDirectory: 'static',
    output: {
      filename: 'js/[name].[hash:8].js',
      chunkFilename: 'js/[name].[chunkhash:8].js',
    },
    miniCssExtractPluginOption: {
      ignoreOrder: true,
    },
    postcss: {
      autoprefixer: { enable: true, config: {} },
      cssModules: { enable: false },
    },
  },
}

/**
 * Taro 传给配置函数的 `merge` 签名（与 @tarojs/cli 内部的 WebpackMerge 一致）。
 * 这里显式声明是因为 `UserConfigExport` 是一个「对象 | Promise | 函数」的联合类型，
 * TS 无法从联合里推导出回调参数类型，会报 implicit any。
 */
type MergeFn = (...configs: Array<object | null | undefined>) => object

export default defineConfig<'webpack5'>((merge: MergeFn) => {
  // `merge` 的返回类型被标注为 `object`，而 defineConfig 的回调要求返回 IProjectConfig，
  // 因此这里显式断言一次（Taro 官方模板同样依赖这个宽松签名）。
  if (process.env.NODE_ENV === 'development') {
    return merge({}, baseConfig, devConfig) as IProjectConfig<'webpack5'>
  }
  return merge({}, baseConfig, prodConfig) as IProjectConfig<'webpack5'>
})

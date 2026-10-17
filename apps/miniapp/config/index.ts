import fs from 'node:fs'
import path from 'node:path'

import { defineConfig, type UserConfigExport } from '@tarojs/cli'
import type { IProjectConfig } from '@tarojs/taro/types/compile'
import type Config from 'webpack-chain'

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

/**
 * 定位 monorepo 的 `packages/` 目录（workspace 的 TS 源码根）。
 *
 * 为什么不能只用 `__dirname` 推导：Taro 加载 TS 配置时会先转译/打包，
 * `__dirname` 不保证仍是 `apps/miniapp/config`。一旦推错，症状是
 * `ModuleParseError: Unexpected token`（workspace 里的 TS 包没进 babel-loader），
 * 很难一眼看出根因。这里改成「多候选 + 存在性校验 + 明确报错」。
 */
function resolveWorkspacePackages(): string {
  const candidates: string[] = []

  // 1) 最可靠：从已安装的 workspace 包反查真实路径（走 node_modules 符号链接）
  if (typeof require === 'function') {
    try {
      const resolved = require.resolve('@kedaya/contracts')
      candidates.push(path.resolve(path.dirname(resolved), '..', '..'))
    } catch {
      // 忽略，走下面的相对路径候选
    }
  }

  // 2) 相对位置：从 apps/miniapp 运行，或从仓库根运行
  candidates.push(path.resolve(process.cwd(), '..', '..', 'packages'))
  candidates.push(path.resolve(process.cwd(), 'packages'))

  // 3) 兜底：仍按 config/ 目录推导
  try {
    candidates.push(path.resolve(__dirname, '..', '..', '..', 'packages'))
  } catch {
    // __dirname 不可用时跳过
  }

  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'shared', 'src', 'index.ts'))) return dir
  }

  throw new Error(
    `无法定位 monorepo 的 packages 目录（已尝试：${candidates.join(' | ')}）。` +
      '请从 apps/miniapp 目录运行 taro build，或检查 node_modules 里的 @kedaya/* 是否已安装。',
  )
}

const WORKSPACE_PACKAGES = resolveWorkspacePackages()

/**
 * 给 workspace 里的 TS 包挂一条 babel-loader 规则。
 *
 * Taro 文档里的 `compile.include` 在本仓库的 4.3.0 上不生效（实测 script rule 的
 * include 没有被改到），因此小程序与 H5 两个平台都通过各自的 `webpackChain` 显式加规则。
 */
function addWorkspaceTsRule(chain: Config): void {
  chain.module
    .rule('kedaya-workspace-ts')
    .test(/\.[jt]sx?$/)
    .include.add(WORKSPACE_PACKAGES)
    .end()
    .use('babel')
    .loader('babel-loader')
    .options({ compact: false })
}

const baseConfig: UserConfigExport<'webpack5'> = {
  projectName: 'kedaya-miniapp',
  date: '2026-10-16',
  /**
   * 设计基准 375（= iPhone 逻辑宽度）。
   *
   * 本仓库的样式（含 `@kedaya/design-tokens` 派生的 SCSS）是按 **Web 语义的 px** 写的：
   * `font-size: 14px` 期望渲染成 14pt。Taro 的 pxtransform 会把 px 转成 rpx：
   * `rpx = px * 750 / designWidth`。若 designWidth = 750，14px → 14rpx ≈ 7pt（只有一半大）；
   * designWidth = 375 时 14px → 28rpx = 14pt，才与设计稿一致。
   */
  designWidth: 375,
  deviceRatio: { 640: 1.17, 750: 1, 828: 0.905, 375: 2 },
  sourceRoot: 'src',
  /**
   * 输出目录。默认 `dist`（小程序）；H5 预览用 `TARO_OUTPUT_ROOT=dist-h5` 另出一份，
   * 避免两个平台的产物互相覆盖（也方便 CI 只保留需要的那一份）。
   */
  outputRoot: process.env.TARO_OUTPUT_ROOT ?? 'dist',
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
  /**
   * workspace 里的 TS 包必须过 babel-loader。
   *
   * Taro 默认的 script rule 只 include `sourceDir`（apps/miniapp/src），
   * 而 `@kedaya/contracts` / `@kedaya/shared` / `@kedaya/design-tokens` 的
   * `main` 直接指向 **TS 源码**（`./src/index.ts`）。webpack 解析符号链接后拿到的是
   * packages 下各包 src 的真实路径，落在 sourceDir 之外 → 没有 loader →
   * `ModuleParseError: Unexpected token`（构建直接失败）。
   *
   * 注意：Taro 文档里的 `compile.include` 在本仓库的 4.3.0 上**不生效**
   * （MiniWebpackModule 会 unshift，但实测 script rule 的 include 没被改到），
   * 所以改在 `mini.webpackChain` 里**显式**给 packages 挂一条 babel-loader 规则。
   * 这条规则只处理 packages/**，与 Taro 自己的 script rule 互不干扰。
   */
  mini: {
    postcss: {
      pxtransform: { enable: true, config: {} },
      cssModules: { enable: false },
    },
    webpackChain(chain: Config) {
      addWorkspaceTsRule(chain)
    },
  },
  h5: {
    webpackChain(chain: Config) {
      addWorkspaceTsRule(chain)
      /**
       * npm 把部分 @tarojs 包装在了 apps/miniapp/node_modules（嵌套），
       * 而 @tarojs/taro-h5 在根 node_modules，默认解析会找不到
       * `@tarojs/plugin-framework-react` / `@tarojs/router`。
       * 显式把 app 自己的 node_modules 放到解析链最前面。
       */
      chain.resolve.modules.add(path.resolve(process.cwd(), 'node_modules')).add('node_modules')
    },
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

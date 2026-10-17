import path from 'node:path'
import type Chain from 'webpack-chain'

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
const TOKENS_SCSS = path.resolve(
  __dirname,
  '..',
  'src',
  'presentation',
  'theme',
  'tokens.scss',
)

const baseConfig: UserConfigExport<'webpack5'> = {
  projectName: 'kedaya-miniapp',
  date: '2026-10-16',
  designWidth: 375,
  deviceRatio: { 640: 2.34 / 2, 750: 1, 828: 1.81 / 2, 375: 2 },
  sourceRoot: 'src',
  outputRoot: 'dist',
  alias: {
    '@taroify/core': path.dirname(
      require.resolve('@taroify/core/package.json'),
    ),
    /**
     * 接管 Taroify 图标样式入口（见 src/presentation/theme/taroify-icon-style.ts）。
     *
     * 原入口的 @font-face 指向 `//at.alicdn.com/...`：真机需要配置合法域名、
     * 协议相对地址在部分基础库不解析。接管后先加载官方样式（保留字形映射），
     * 再追加 base64 内联字体覆盖它，图标即可离线渲染。
     *
     * 之所以用 alias 而不是在 app.scss 里覆盖：app.scss 编译为 `app-origin.wxss`，
     * 而 `app.wxss` 是 `@import "./app-origin.wxss"` 在前、`@import "./common.wxss"` 在后，
     * 官方样式在 common.wxss 里，写在 app.scss 反而会被后加载的官方规则反超。
     */
    '@taroify/icons/style/index.js': path.resolve(
      __dirname,
      '..',
      'src',
      'presentation',
      'theme',
      'taroify-icon-style.ts',
    ),
  },
  plugins: [],
  defineConstants: {},
  copy: {
    patterns: [{ from: 'src/assets/tabs', to: 'dist/assets/tabs' }],
    options: {},
  },
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
   * 必须把 workspace 里的 TS 包纳入 babel-loader 的处理范围。
   *
   * Taro 默认的 script rule 只 include `sourceDir`（apps/miniapp/src），
   * 而 `@kedaya/contracts` / `@kedaya/shared` / `@kedaya/design-tokens` 的
   * `main` 直接指向 **TS 源码**（`./src/index.ts`）。webpack 解析符号链接后拿到的是
   * packages 下各包 src 目录里的真实路径，落在 sourceDir 之外 → 没有 loader →
   * `ModuleParseError: Unexpected token`。
   *
   * Taro 为此提供了 `mini.compile.include` / `h5.compile.include`，
   * 它会 unshift 进 script rule 的 include 列表。
   */
  mini: {
    /**
     * ⚠️ 这段别名**不能删**（删了 `build:weapp` 会在引入 Taroify `Popup` 时直接编译失败）。
     *
     * 原因：Taro 给小程序端设的别名是 `react-dom$` / `react-dom/client$` → `@tarojs/react`
     * （见 `@tarojs/plugin-framework-react` 的 `setAlias`）。别名值是**裸包名**，
     * 于是 webpack 会**从引用方所在目录**去解析它。
     * 在本仓库（npm workspaces）里，Taroify 的 `react-transition-group` 被提升到了
     * **根 `node_modules`**，而根目录下没有 `@tarojs/react`（它只装在 `apps/miniapp`）。
     * 结果：`react-transition-group` 里那一句 `react-dom` 解析失败 →
     * `Module not found: @tarojs/react`，整个构建挂掉。
     *
     * 修法是把别名换成**绝对路径**：绝对路径不依赖引用方位置，
     * 根目录下、workspace 包里的代码都能解析到同一份。
     * （`react$` 不需要处理 —— Taro 用的是 `resolveSync` 的结果，本来就是绝对路径。）
     */
    webpackChain(chain: Chain) {
      const taroReact = require.resolve('@tarojs/react')
      chain.resolve.alias.set('react-dom$', taroReact)
      chain.resolve.alias.set('react-dom/client$', taroReact)
    },
    // compile 是平台配置，放在顶层会被 runner 忽略。
    compile: {
      include: [path.resolve(__dirname, '..', '..', '..', 'packages')],
    },
    postcss: {
      pxtransform: { enable: true, config: {} },
      cssModules: { enable: false },
    },
  },
  h5: {
    // workspace 依赖可能位于本端 node_modules；H5 运行时从根依赖引用时也应解析到同一份。
    webpackChain(chain: Chain) {
      chain.resolve.alias.set(
        '@tarojs/plugin-framework-react/dist/runtime',
        require.resolve('@tarojs/plugin-framework-react/dist/runtime'),
      )
    },
    compile: {
      include: [path.resolve(__dirname, '..', '..', '..', 'packages')],
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

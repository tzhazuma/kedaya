import path from 'node:path'
import type Chain from 'webpack-chain'

import { defineConfig, type UserConfigExport } from '@tarojs/cli'
import type { IProjectConfig } from '@tarojs/taro/types/compile'

import devConfig from './dev'
import prodConfig from './prod'
import { CoherentBuildPlugin } from './coherent-build'

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
    /**
     * 地图 marker 图标。
     *
     * `<map>` 的 `marker.iconPath` 只接受「小程序根目录下的路径 / 临时路径 / 网络图片」，
     * **不支持** webpack 内联的 base64 data URI。因此这些小 PNG 必须**原样拷贝**到
     * `dist/assets/wildlife/`，代码里以 `/assets/wildlife/*.png` 引用。
     *
     * `from` 相对 appPath（`apps/miniapp`），`to` 也相对 appPath
     * （见 `WebpackPlugin.getCopyWebpackPlugin` 的 `context: appPath`）。
     *
     * 吉祥物（可达鸭贴图）走同一条路：`theme/mascot.ts` 以
     * `/assets/mascot/duck.png` 引用，避免被 webpack 内联成 base64 塞进主包 JS。
     *
     * ⚠️ **校园底图（`campus.jpg`，约 1 MB）刻意放在 wildlife 分包目录里**：
     * 微信**主包上限 2 MiB**，主包当前已用到 1.4 MiB，一份 1 MB 的底图
     * 会把主包顶穿、直接传不上去；放进分包则由**分包**体积（上限 2 MiB）承担。
     * 因此它不能跟着 `src/assets/wildlife` 一起拷到 `dist/assets/`（那是主包目录），
     * 只能拷进 `presentation/pages/wildlife/assets/`。
     * 引用它的三页（地图 / 上报 / 轨迹）都在同一分包里，符合微信「分包只能引用自己包内文件」的约束。
     * `scripts/verify-weapp-build.cjs` 会同时守住主包与这个分包的上限。
     */
    patterns: [
      { from: 'src/assets/wildlife', to: 'dist/assets/wildlife' },
      { from: 'src/assets/mascot', to: 'dist/assets/mascot' },
      {
        from: 'src/presentation/pages/wildlife/assets',
        to: 'dist/presentation/pages/wildlife/assets',
      },
    ],
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
    /**
     * 依赖解析必须能看到**本端**的 `node_modules`。
     *
     * npm 的 workspace 提升会把 `@taroify/core` 的传递依赖（如
     * `react-transition-group`）装到**仓库根**的 `node_modules`，
     * 而从根目录向上查找时**永远到不了** `apps/miniapp/node_modules`
     * —— 于是 `react-transition-group/esm` 里 `import 'react-dom'`
     * 这条链（被 Taro 别名成 `@tarojs/react`）在根目录解析失败：
     *
     *   resolve 'react-dom' in '.../node_modules/react-transition-group/esm'
     *     aliased with mapping 'react-dom': '@tarojs/react'
     *     → /node_modules/@tarojs/react doesn't exist
     *
     * 把本端 node_modules 放进解析路径，Taroify 的弹层/选择器才能正常打包。
     */
    webpackChain(chain: Chain) {
      chain.resolve.modules
        .prepend(path.resolve(__dirname, '..', 'node_modules'))
        // 保留默认的「逐级向上找 node_modules」语义（`react` 之类被提升到仓库根）。
        .add('node_modules')

      /**
       * 构建指纹（`// kedaya-build:<hash>`，见 `config/coherent-build.ts`）。
       *
       * `scripts/verify-weapp-build.cjs` 与 `scripts/publish-weapp.cjs` 靠它判断
       * 「这份 dist 是同一次完整构建的产物」：所有分包 chunk 的指纹必须一致，
       * 否则微信会复用旧的文件缓存、出现「页面已更新但代码没更新」。
       *
       * ⚠️ 这个插件**必须**挂上，否则 `npm run verify:weapp` 会在
       * `missing build fingerprint` 上直接失败 —— 插件文件本身不生效。
       */
      chain.plugin('kedaya-coherent-build').use(CoherentBuildPlugin)
    },
    postcss: {
      pxtransform: { enable: true, config: {} },
      cssModules: { enable: false },
    },
    /**
     * 小程序端同样按 h5 的方式忽略 CSS chunk 顺序告警。
     *
     * 分包（subPackages）下，同一个公共样式会被多个 chunk 同时引用，
     * 引用顺序取决于页面依赖图 —— 顺序不同会让 `mini-css-extract-plugin`
     * 直接**报错中断构建**（`Conflicting order`），而站点样式本身并不依赖
     * 这个顺序（各页面样式类名互不重叠，公共部分在 `common.wxss`）。
     */
    miniCssExtractPluginOption: {
      ignoreOrder: true,
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

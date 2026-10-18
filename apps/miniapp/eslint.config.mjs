import js from '@eslint/js'
import tseslint from 'typescript-eslint'

/**
 * ESLint 10 flat config（契约 §2 冻结 ESLint 10.12.0）。
 *
 * 与根仓库的关系：根目录当前**没有** ESLint 配置，本文件是小程序作用域内的唯一配置，
 * 通过 `npm run lint -w @kedaya/miniapp` 运行。
 * `typescript-eslint@8.71` 的 peerDependencies 已声明支持 `eslint@^10`。
 */

const nodeGlobals = {
  process: 'readonly',
  console: 'readonly',
  module: 'writable',
  exports: 'writable',
  require: 'readonly',
  __dirname: 'readonly',
  Buffer: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
}

/** 微信小程序宿主注入的全局对象（只在 weapp 编译产物里存在） */
const weappGlobals = {
  wx: 'readonly',
  App: 'readonly',
  Page: 'readonly',
  Component: 'readonly',
  Behavior: 'readonly',
  getApp: 'readonly',
  getCurrentPages: 'readonly',
}

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      // H5 产物单独落 dist-h5/（见 config/index.ts 的 outputRoot），同样是构建产物、不参与 lint
      'dist-h5/**',
      '.temp/**',
      '.swc/**',
      'node_modules/**',
      '*.config.js',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...nodeGlobals, ...weappGlobals },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error',
      'no-console': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    // domain 与 application 层：严格禁止任何框架 import
    files: ['src/domain/**/*.ts', 'src/application/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@tarojs/*',
                'react',
                'react-dom',
                '../../data/*',
                '../data/*',
                '**/data/**',
              ],
              message:
                'domain / application 不得依赖框架或具体 adapter（契约 §7）。',
            },
          ],
        },
      ],
    },
  },
  {
    // 契约 §7 硬规则：domain / application 层零框架依赖，且不得直接依赖 data adapter。
    // 依赖倒置由 domain/ports 承载；presentation / data / platform 不受此限制。
    files: ['src/domain/**/*.ts', 'src/application/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@tarojs/*',
                'react',
                'react-dom',
                '**/data/**',
                '../../data/*',
                '../data/*',
              ],
              message:
                'domain / application 不得依赖框架或具体 adapter，请通过 domain/ports 做依赖倒置（契约 §7）。',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/presentation/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@tarojs/components',
              importNames: [
                'Button',
                'Input',
                'Textarea',
                'Switch',
                'Slider',
                'Checkbox',
                'Radio',
                'Picker',
                'Progress',
              ],
              message:
                '标准 UI 控件统一使用 Taroify 或 Kdy 封装，参见 apps/miniapp/AGENTS.md。',
            },
          ],
          patterns: [
            {
              group: [
                '@nutui/*',
                'taro-ui',
                'taro-ui/*',
                '@antmjs/vantui',
                '@antmjs/vantui/*',
              ],
              message: '小程序固定使用 Taroify，不引入第二套 UI 组件库。',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: nodeGlobals,
    },
    rules: {
      'no-undef': 'error',
    },
  },
  {
    // CommonJS 脚本（微信发布 / 构建校验 / 锁文件）只能用 `require()` 加载模块 ——
    // 关掉这条 TS 规则；空 catch 在这些"尽力清理"的工具代码里是刻意写法（见 build-weapp.cjs 的 release()）。
    // ⚠️ 只对 `.cjs` 放开，`.mjs` 仍按 ESM 严格要求禁用 require。
    files: ['**/*.cjs'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
)

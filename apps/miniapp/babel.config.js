// Taro 官方 Babel 预设 —— React 运行时 + TypeScript + webpack5 编译器。
// 契约 §2 冻结：Taro 4.3.0 / React 19 / TS 5.9.3。
module.exports = {
  presets: [
    [
      'taro',
      {
        framework: 'react',
        ts: true,
        compiler: 'webpack5',
      },
    ],
  ],
}

// 检查发布包，而不是仅检查 TS 类型：微信环境没有 Node process。
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, '../dist');
const vm = require('node:vm');
const { parse } = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const factories = {};
let fingerprint;
for (const file of fs.readdirSync(root, { recursive: true }).filter(name => name.endsWith('.js'))) {
  const code = fs.readFileSync(path.join(root, file), 'utf8');
  assert.ok(!/process\.env\.TARO_APP_/.test(code), `${file}: found uncompiled environment access`);
  assert.ok(!/KEDAYA_(?:EXPORTS|UNDEFINED_JSX|MISSING_MODULE)/.test(code), `${file}: temporary diagnostics remain`);
  const stamp = code.match(/\/\/ kedaya-build:([a-f0-9]+)/)?.[1];
  assert.ok(stamp, `${file}: missing build fingerprint`);
  fingerprint ??= stamp;
  assert.equal(stamp, fingerprint, `${file}: mixed build generations`);
  if (code.includes('webpackJsonp') && file !== 'runtime.js') {
    const wx = { webpackJsonp: { push: chunk => Object.assign(factories, chunk[1]) } };
    vm.runInNewContext(code, { wx, require() {}, App() {}, Page() {}, Component() {} }, { filename: file });
  }
}
// Check actual emitted export names, including minified React component imports.
const modules = new Map(Object.entries(factories).map(([id, factory]) => {
  const ast = parse(`(${factory.toString()})`);
  return [id, { ast, outer: ast.program.body[0].expression, exports: new Set() }];
}));
for (const module of modules.values()) {
  const requireName = module.outer.params[2]?.name;
  traverse(module.ast, { CallExpression(path) {
    const { callee, arguments: args } = path.node;
    if (callee.type === 'MemberExpression' && callee.object.name === requireName && callee.property.name === 'd' && args[1]?.type === 'ObjectExpression')
      for (const prop of args[1].properties) if (prop.key) module.exports.add(prop.key.name ?? prop.key.value);
  } });
}
let componentImports = 0;
// Register real emitted factories without executing native APIs or UI code.
for (const [id, { ast, outer }] of modules) {
  const argument = outer.params[2]?.name;
  if (!argument) continue;
  let binding;
  traverse(ast, {
    FunctionExpression(path) { if (path.node === outer) binding = path.scope.getBinding(argument); },
    CallExpression(path) {
      const { callee, arguments: args } = path.node;
      const jsx = callee.type === 'SequenceExpression' ? callee.expressions.at(-1) : callee;
      const component = args[0];
      if (jsx?.type === 'MemberExpression' && ['jsx', 'jsxs'].includes(jsx.property.name) && component?.type === 'MemberExpression' && !component.computed) {
        const imported = path.scope.getBinding(component.object.name)?.path.node;
        const call = imported?.type === 'VariableDeclarator' ? imported.init : null;
        if (call?.type === 'CallExpression' && call.callee.name === argument && call.arguments[0]?.type === 'NumericLiteral') {
          const target = modules.get(String(call.arguments[0].value));
          if (target?.exports.size) {
            assert.ok(target.exports.has(component.property.name), `Module ${id}: undefined JSX component import ${call.arguments[0].value}.${component.property.name}`);
            componentImports++;
          }
        }
      }
      if (callee.type !== 'Identifier' || callee.name !== argument || args[0]?.type !== 'NumericLiteral' || path.scope.getBinding(argument) !== binding) return;
      assert.ok(factories[args[0].value], `Module ${id} references missing module ${args[0].value}`);
    },
  });
}
for (const marker of ['spot', 'sighting', 'sensitive', 'track'])
  assert.ok(fs.existsSync(path.join(root, `assets/wildlife/marker-${marker}.png`)), `Missing marker icon: ${marker}`);
const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
// 页面路由既可能在主包（`app.pages`），也可能在分包（`app.subPackages[].pages`）。
// wildlife 三页都在分包里 —— 只看 `app.pages` 会漏判，这里合并后再断言。
const subpackages = app.subPackages ?? [];
const subpackageRoots = subpackages.map(entry => `${entry.root}/`);
const allPages = [
  ...app.pages,
  ...subpackages.flatMap(entry => entry.pages.map(page => `${entry.root}/${page}`)),
];
assert.ok(allPages.includes('presentation/pages/wildlife/map/index'));
assert.ok(app.permission['scope.userLocation']);
for (const page of allPages) {
  assert.ok(!page.endsWith('.html'), `Invalid WeChat page route: ${page}`);
  // wxss is optional: Taro extracts shared page styling into common.wxss.
  for (const extension of ['.js', '.json', '.wxml'])
    assert.ok(fs.existsSync(path.join(root, `${page}${extension}`)), `Incomplete page: ${page}${extension}`);
}
for (const tab of app.tabBar.list) assert.ok(app.pages.includes(tab.pagePath), `Missing tab route: ${tab.pagePath}`);
const project = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'));
assert.equal(project.setting.compileHotReLoad, false);
assert.equal(project.setting.useApiHook, false);
// 微信**主包**上限 2 MiB：只统计主包（排除分包根目录下的文件）。
// 早先的实现把整份 dist 当主包统计，分包一多必然误报（分包天然属于"总包 20 MiB"那一档）。
const bytes = fs
  .readdirSync(root, { recursive: true })
  .map(name => String(name).split(path.sep).join('/'))
  .filter(name => !subpackageRoots.some(prefix => name.startsWith(prefix)))
  .reduce((sum, name) => {
    const stat = fs.statSync(path.join(root, name)); return sum + (stat.isFile() ? stat.size : 0);
  }, 0);
assert.ok(bytes < 2 * 1024 * 1024, `Main package exceeds 2 MiB: ${bytes}`);
console.log(`WeChat build verified: ${Object.keys(factories).length} module factories, ${componentImports} JSX imports, coherent chunks, no temporary diagnostics, main package ${(bytes / 1024 / 1024).toFixed(2)} MiB (excludes ${subpackageRoots.length} subpackages).`);

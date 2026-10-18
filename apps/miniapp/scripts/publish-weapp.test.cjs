const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { publishWeapp } = require('./publish-weapp.cjs');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kedaya-publish-test-'));
  t.after(() => {
    assert.equal(path.dirname(root), os.tmpdir());
    assert.ok(path.basename(root).startsWith('kedaya-publish-test-'));
    fs.rmSync(root, { recursive: true });
  });
  for (const name of ['dist', '.weapp-stage']) fs.mkdirSync(path.join(root, name));
  fs.writeFileSync(path.join(root, 'dist/app.json'), 'old package');
  fs.writeFileSync(path.join(root, '.weapp-stage/app.json'), 'new package');
  fs.writeFileSync(path.join(root, '.weapp-stage/project.config.json'), '{}');
  return root;
}
test('publishes a complete package and preserves the previous package', t => {
  const root = fixture(t);
  publishWeapp({ root, verify: () => {} });
  assert.equal(fs.readFileSync(path.join(root, 'dist/app.json'), 'utf8'), 'new package');
  assert.equal(fs.readFileSync(path.join(root, '.weapp-last-good/app.json'), 'utf8'), 'old package');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'dist/project.config.json'))).miniprogramRoot, './');
  fs.writeFileSync(path.join(root, '.weapp-stage/app.json'), 'third package');
  publishWeapp({ root, verify: () => {} });
  assert.equal(fs.readFileSync(path.join(root, '.weapp-last-good/app.json'), 'utf8'), 'new package');
});
test('never replaces the live directory (devtools watches it in place)', t => {
  const root = fixture(t);
  const live = path.join(root, 'dist');
  // 上一版遗留下来的文件必须被清掉，但 dist 目录本身不能被改名/删除
  fs.writeFileSync(path.join(live, 'stale-chunk.js'), 'old hash');
  const renames = [];
  t.mock.method(fs, 'renameSync', (from, to) => renames.push([from, to]));
  publishWeapp({ root, verify: () => {} });
  assert.equal(renames.length, 0, '发布过程不应 rename dist / .weapp-next');
  assert.ok(fs.existsSync(live) && fs.statSync(live).isDirectory());
  assert.equal(fs.existsSync(path.join(live, 'stale-chunk.js')), false);
  assert.equal(fs.readFileSync(path.join(live, 'app.json'), 'utf8'), 'new package');
});
test('failed validation leaves the live package intact', t => {
  const root = fixture(t);
  assert.throws(() => publishWeapp({ root, verify() { throw Error('invalid package'); } }), /invalid package/);
  assert.equal(fs.readFileSync(path.join(root, 'dist/app.json'), 'utf8'), 'old package');
});
test('failed sync rolls the live package back', t => {
  const root = fixture(t);
  const live = path.join(root, 'dist');
  const copy = fs.copyFileSync;
  // 发布副本写进 dist 的 app.json 时失败：已经覆盖的其他文件也要回滚
  t.mock.method(fs, 'copyFileSync', (from, to) => {
    if (from.includes('.weapp-next') && path.basename(to) === 'app.json') {
      const error = new Error('copy blocked');
      error.code = 'EIO';
      throw error;
    }
    return copy(from, to);
  });
  assert.throws(() => publishWeapp({ root, verify: () => {} }), /copy blocked/);
  assert.equal(fs.readFileSync(path.join(live, 'app.json'), 'utf8'), 'old package');
});
test('never removes an unmanaged backup directory', t => {
  const root = fixture(t), backup = path.join(root, '.weapp-last-good');
  fs.mkdirSync(backup); fs.writeFileSync(path.join(backup, 'keep.txt'), 'preserve');
  assert.throws(() => publishWeapp({ root, verify: () => {} }));
  assert.equal(fs.readFileSync(path.join(backup, 'keep.txt'), 'utf8'), 'preserve');
  assert.equal(fs.readFileSync(path.join(root, 'dist/app.json'), 'utf8'), 'old package');
});

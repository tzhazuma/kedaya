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
test('failed validation leaves the live package intact', t => {
  const root = fixture(t);
  assert.throws(() => publishWeapp({ root, verify() { throw Error('invalid package'); } }), /invalid package/);
  assert.equal(fs.readFileSync(path.join(root, 'dist/app.json'), 'utf8'), 'old package');
});
test('failed directory swap rolls back the live package', t => {
  const root = fixture(t), rename = fs.renameSync;
  t.mock.method(fs, 'renameSync', (from, to) => {
    if (from === path.join(root, '.weapp-next') && to === path.join(root, 'dist')) throw Error('swap blocked');
    return rename(from, to);
  });
  assert.throws(() => publishWeapp({ root, verify: () => {} }), /swap blocked/);
  assert.equal(fs.readFileSync(path.join(root, 'dist/app.json'), 'utf8'), 'old package');
});
test('never removes an unmanaged backup directory', t => {
  const root = fixture(t), backup = path.join(root, '.weapp-last-good');
  fs.mkdirSync(backup); fs.writeFileSync(path.join(backup, 'keep.txt'), 'preserve');
  assert.throws(() => publishWeapp({ root, verify: () => {} }));
  assert.equal(fs.readFileSync(path.join(backup, 'keep.txt'), 'utf8'), 'preserve');
  assert.equal(fs.readFileSync(path.join(root, 'dist/app.json'), 'utf8'), 'old package');
});

// A real WeChat DevTools smoke test. It never calls preview or upload.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const automator = require('miniprogram-automator');

const projectPath = path.resolve(__dirname, '..');
const outputPath = path.join(projectPath, 'artifacts', 'home.png');
const port = Number(process.env.WECHAT_AUTOMATION_PORT || 9420);
const endpoint = process.env.WECHAT_AUTOMATION_WS || `ws://127.0.0.1:${port}`;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function findCli() {
  const candidates = [
    process.env.WECHAT_DEVTOOLS_CLI,
    'D:\\Software\\WeixinDevTools\\cli.bat',
    'C:\\Program Files (x86)\\Tencent\\微信web开发者工具\\cli.bat',
  ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate));
}

function startCli(cliPath) {
  // Node 24 on Windows cannot spawn .bat directly. Pass paths through the
  // environment so PowerShell does not have to parse interpolated strings.
  const child = spawn('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    '& $env:WECHAT_DEVTOOLS_CLI auto --project $env:KEDAYA_MINIAPP_DIR --auto-port $env:WECHAT_AUTOMATION_PORT --lang en',
  ], {
    cwd: projectPath,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, WECHAT_DEVTOOLS_CLI: cliPath, KEDAYA_MINIAPP_DIR: projectPath, WECHAT_AUTOMATION_PORT: String(port) },
  });
  let output = '';
  let exitCode = null;
  child.stdout.on('data', (chunk) => { output = (output + chunk).slice(-12000); });
  child.stderr.on('data', (chunk) => { output = (output + chunk).slice(-12000); });
  child.on('exit', (code) => { exitCode = code; });
  child.on('error', (error) => { output = `${output}\n${error.message}`; exitCode = 1; });
  return { child, get output() { return output; }, get exitCode() { return exitCode; } };
}

async function connectWithRetry(cli) {
  const deadline = Date.now() + 45000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await automator.connect({ wsEndpoint: endpoint });
    } catch (error) {
      lastError = error;
      if (/service port disabled|服务端口已关闭/i.test(cli?.output || '')) break;
      if (cli?.exitCode !== null && cli.exitCode !== 0) break;
      await delay(1000);
    }
  }
  throw new Error(`无法连接自动化端口 ${endpoint}: ${lastError?.message || '超时'}\n${cli?.output || ''}`);
}

async function main() {
  assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535, 'WECHAT_AUTOMATION_PORT 必须是有效端口');
  assert.ok(fs.existsSync(path.join(projectPath, 'dist', 'app.json')), '缺少 dist/app.json，请先运行 npm run build:weapp -w @kedaya/miniapp');
  let cli;
  if (!process.env.WECHAT_AUTOMATION_WS) {
    const cliPath = findCli();
    assert.ok(cliPath, '未找到 cli.bat，请设置 WECHAT_DEVTOOLS_CLI 为绝对路径');
    assert.ok(!/["\r\n]/.test(cliPath), 'CLI 路径包含不安全字符');
    console.log(`微信 CLI: ${cliPath}`);
    cli = startCli(cliPath);
  }

  let miniProgram;
  try {
    miniProgram = await connectWithRetry(cli);
    const page = await miniProgram.reLaunch('/presentation/pages/home/index');
    assert.ok(page, '首页没有打开');
    assert.equal(page.path.replace(/^\/+/, ''), 'presentation/pages/home/index');

    let brand;
    for (let attempt = 0; attempt < 15; attempt += 1) {
      brand = await page.$('.kdy-home__brand');
      if (brand) break;
      await delay(1000);
    }
    assert.ok(brand, '首页没有渲染 .kdy-home__brand');
    const text = await brand.text();
    assert.match(text, /可达鸭/, '首页品牌文字不正确');

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    await miniProgram.screenshot({ path: outputPath });
    assert.ok(fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0, '截图未生成');
    console.log(`PASS 首页路径: ${page.path}`);
    console.log(`PASS 首页文字: ${text}`);
    console.log(`PASS 截图: ${outputPath}`);
  } finally {
    if (miniProgram) await miniProgram.disconnect();
    if (cli?.child && cli.exitCode === null) cli.child.kill();
  }
}

main().catch((error) => {
  console.error(`FAIL ${error.message}`);
  console.error('请检查 CLI 路径及微信开发者工具「设置 → 安全设置」中的 CLI/HTTP 调用和自动化权限。');
  process.exitCode = 1;
});

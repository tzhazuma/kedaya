#!/usr/bin/env node
/**
 * 小程序服务器域名（含 downloadFile 白名单）配置工具
 *
 * ## ⚠️ 先说清楚：开发者工具**不能**改白名单
 *
 * `wechatwebdevtools` 的 CLI 命令列表里没有任何 domain 相关命令
 * （只有 open/login/preview/upload/build-npm/build-apk/…）。
 * 白名单**不在本地项目文件里**，它是账号级配置，存在微信服务器上。
 *
 * ## 那为什么开发者工具里能显示网图？
 *
 * 因为 `project.config.json` 里有 `"urlCheck": false` —— 意思是
 * **跳过合法域名校验**，只在**工具内和真机调试**时生效。
 * 正式预览（扫二维码）和上传后的体验版/正式版**仍然受白名单约束**。
 * 所以「工具里好使、手机上空白」是这个原因，不是代码 bug。
 *
 * ## 三条能改白名单的路
 *
 * | 路径 | 要求 | 现状 |
 * | --- | --- | --- |
 * | `mp.weixin.qq.com` 后台 → 开发管理 → 服务器域名 | 管理员扫码 | ✅ 唯一对普通账号可行的路 |
 * | `POST /wxa/modify_domain_directly` | **第三方平台账号**代调用 | ❌ 官方文档明写「其他账号类型如无特殊说明，均不可调用」 |
 * | `POST /wxa/modify_domain` | 同上，旧接口 | ❌ 同样受限 |
 *
 * 本脚本实现第二条（万一你有第三方平台资质），并在失败时**明确告诉你**
 * 去后台点哪里。它不会假装成功。
 *
 * ## 用法
 *
 * ```bash
 * # 只读：看看现在配了什么（需要 APPID + SECRET）
 * WX_APPID=wx... WX_SECRET=... node tools/set-miniapp-domains.mjs --get
 *
 * # 追加域名（不会删掉已有的）
 * WX_APPID=wx... WX_SECRET=... node tools/set-miniapp-domains.mjs --add map.niyiwei.com
 *
 * # 试运行：只打印将要发送的内容
 * WX_APPID=wx... WX_SECRET=... node tools/set-miniapp-domains.mjs --add map.niyiwei.com --dry-run
 * ```
 *
 * ## ⚠️ 凭据
 *
 * `WX_SECRET` 是**账号级最高权限凭据**，泄露等于小程序被接管。
 * 本脚本只从环境变量读，不接受命令行参数（避免进 shell 历史），
 * 也从不打印它的值。
 */

const API = 'https://api.weixin.qq.com';

/** 域名分类：微信把它们分开配，一个都不能漏 */
const DOMAIN_FIELDS = [
  'requestdomain',
  'wsrequestdomain',
  'uploaddomain',
  'downloaddomain',
  'udpdomain',
  'tcpdomain',
];

function fail(message, hint) {
  console.error(`\n  ❌ ${message}`);
  if (hint) console.error(`\n  ${hint}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = { action: null, domains: [], dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--get') options.action = 'get';
    else if (arg === '--add') options.action = 'add';
    else if (arg === '--delete') options.action = 'delete';
    else if (arg === '--dry-run') options.dryRun = true;
    else if (!arg.startsWith('--')) options.domains.push(arg);
  }
  return options;
}

async function getAccessToken(appid, secret) {
  const url = `${API}/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(appid)}&secret=${encodeURIComponent(secret)}`;
  const response = await fetch(url);
  const body = await response.json();
  if (body.errcode) {
    // 40164 = 调用 IP 不在白名单。这是最常见的失败，单独给出可操作的提示。
    if (body.errcode === 40164) {
      fail(
        `调用 IP 不在小程序的 IP 白名单里（40164）：${body.errmsg}`,
        '去 mp.weixin.qq.com → 开发管理 → 开发设置 → 「小程序代码上传」下方的\n'
          + '  「IP白名单」把本机出口 IP 加进去。也可以临时关掉 IP 白名单（不推荐）。',
      );
    }
    if (body.errcode === 40013) fail(`appid 无效（40013）。检查 WX_APPID。`);
    if (body.errcode === 40125) fail(`appid/secret 不匹配（40125）。检查 WX_SECRET 是否正确、是否被重置过。`);
    fail(`获取 access_token 失败：${body.errcode} ${body.errmsg}`);
  }
  return body.access_token;
}

/**
 * 调 modify_domain_directly。
 *
 * ⚠️ 官方文档明确：该接口「支持『第三方平台』账号类型代调用……
 * 其他账号类型如无特殊说明，均不可调用」。
 * 所以普通小程序账号调它会返回权限类错误 —— 这是预期的，脚本会翻译成人话。
 */
async function modifyDomain(token, payload) {
  const response = await fetch(`${API}/wxa/modify_domain_directly?access_token=${token}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return response.json();
}

/** 把微信的错误码翻译成「下一步该干什么」 */
function explainError(code, message) {
  const table = {
    85015: ['该账号不是小程序账号', '确认 APPID 是小程序而不是公众号/服务号'],
    85016: ['域名数量超出上限', '先 --get 看看现在有哪些，删掉不用的再加'],
    86100: ['URL 协议头有误', '只填主机名，不要带 https:// 或路径'],
    86101: ['不支持配置 api.weixin.qq.com', '这是微信自己的域名，不需要也不允许配'],
    86102: ['每月只能修改 50 次', '本月额度用完了，等下个月或去后台改（后台不计入这个额度）'],
    45082: ['域名需要 ICP 备案', '国内主体的小程序要求域名已备案；未备案的域名无法加白'],
    48001: ['api 未授权给该账号', '这就是「非第三方平台账号不可调用」的表现 —— 去后台手动加'],
    61004: ['access_token 无效或过期', '重新运行脚本即可（会重新取 token）'],
  };
  const found = table[code];
  if (found) return found;
  return [`未知错误 ${code}`, message];
}

async function main() {
  const { action, domains, dryRun } = parseArgs(process.argv.slice(2));

  if (action === null) {
    console.log(`
  用法:
    WX_APPID=wx... WX_SECRET=... node tools/set-miniapp-domains.mjs --get
    WX_APPID=wx... WX_SECRET=... node tools/set-miniapp-domains.mjs --add <域名> [...]
    WX_APPID=wx... WX_SECRET=... node tools/set-miniapp-domains.mjs --delete <域名> [...]

  可选:
    --dry-run   只打印将发送的请求体，不真的调用
`);
    process.exit(0);
  }

  const appid = (process.env.WX_APPID ?? '').trim();
  const secret = (process.env.WX_SECRET ?? '').trim();
  if (appid === '' || secret === '') {
    fail(
      '缺少 WX_APPID 或 WX_SECRET 环境变量',
      '这两个值在 mp.weixin.qq.com → 开发管理 → 开发设置 里。\n'
        + '  ⚠️ 不要写进任何提交的文件，只在命令行里临时传。',
    );
  }

  // 域名格式预检：最常见的错是带协议头
  for (const domain of domains) {
    if (/^https?:\/\//.test(domain) || domain.includes('/')) {
      fail(`「${domain}」格式不对`, '只填主机名，例如 map.niyiwei.com（不要 https://，不要路径）');
    }
  }

  // --get 不需要域名
  const payload = { action };
  if (action !== 'get') {
    if (domains.length === 0) fail('没有给域名', '例如：--add map.niyiwei.com');
    // add/delete 时必须带全部 6 个字段（官方要求），未涉及的传空数组
    for (const field of DOMAIN_FIELDS) payload[field] = [];
    // 只操作 downloaddomain 与 requestdomain —— 照片要走 downloadFile，
    // 但有些场景（如直接 <image src>）算 request，两边都加最稳。
    payload.downloaddomain = domains;
    payload.requestdomain = domains;
  }

  if (dryRun) {
    console.log('  将发送到 https://api.weixin.qq.com/wxa/modify_domain_directly');
    console.log('  请求体：');
    console.log(JSON.stringify(payload, null, 2).split('\n').map((l) => `    ${l}`).join('\n'));
    console.log('\n  （--dry-run，未实际调用）\n');
    return;
  }

  const token = await getAccessToken(appid, secret);
  const result = await modifyDomain(token, payload);

  if (result.errcode === 0) {
    console.log(`  ✅ 成功（action=${action}）`);
    if (action !== 'get') {
      console.log(`
  ⚠️ 还没完：微信文档写明「配置成功后，需要**发布上线后**才会真正生效」。
     现在去开发者工具「上传」→ 后台提审 → 发布，白名单才生效。
`);
    }
    return;
  }

  const [reason, hint] = explainError(result.errcode, result.errmsg);
  fail(`${reason}（${result.errcode} ${result.errmsg}）`, hint);
}

main().catch((error) => {
  fail(`未捕获异常：${error instanceof Error ? error.message : String(error)}`);
});

#!/usr/bin/env node
/**
 * IM Bridge 适配器配置脚本
 * 用法: node scripts/setup.js [平台名称]
 * 示例: node scripts/setup.js wechat
 *       node scripts/setup.js --all
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, '..', '.env');

// ========== 平台配置模板 ==========

const PLATFORMS = {
  wecom: {
    name: '企业微信',
    icon: '💼',
    vars: [
      { key: 'WECOM_CORPID', label: 'CorpID', hint: '我的企业 → 企业信息最下方' },
      { key: 'WECOM_CORPSECRET', label: 'CorpSecret', hint: '应用详情 → Secret' },
      { key: 'WECOM_AGENTID', label: 'AgentId', hint: '应用详情 → AgentId' },
      { key: 'WECOM_TOKEN', label: '回调 Token', hint: '接收消息 → 设置API接收 → Token', generate: true },
      { key: 'WECOM_ENCODING_AES_KEY', label: 'EncodingAESKey', hint: '接收消息 → 自动生成', generate: true },
    ],
    steps: [
      '登录企微管理后台: https://work.weixin.qq.com/wework_admin/frame',
      '应用管理 → 创建自建应用',
      '记录 AgentId 和 Secret',
      '我的企业 → 记录 CorpID',
      '应用详情 → 接收消息 → 设置API接收',
      'URL 填: http://你的域名/wecom/callback',
      '企业可信IP → 添加服务器出口 IP',
    ],
    callbackPath: '/wecom/callback',
  },

  weixin: {
    name: '个人微信',
    icon: '📱',
    vars: [
      { key: 'WEIXIN_TOKEN', label: 'iLink Bot Token', hint: '微信官方 iLink Bot API Token（安全不封号）' },
      { key: 'WEIXIN_BASE_URL', label: 'API 地址', hint: '默认 https://ilinkai.weixin.qq.com', default: 'https://ilinkai.weixin.qq.com', optional: true },
      { key: 'WEIXIN_CDN_BASE_URL', label: 'CDN 地址', hint: '默认 https://novac2c.cdn.weixin.qq.com/c2c', default: 'https://novac2c.cdn.weixin.qq.com/c2c', optional: true },
      { key: 'WEIXIN_ALLOW_FROM', label: '白名单（逗号分隔用户ID，留空允许所有人）', optional: true },
    ],
    steps: [
      '获取 iLink Bot Token（微信官方接口）',
      '配置 .env',
      '启动后长轮询自动接收消息',
    ],
  },

  feishu: {
    name: '飞书',
    icon: '🐦',
    vars: [
      { key: 'FEISHU_APP_ID', label: 'App ID', hint: '飞书开放平台 → 应用详情' },
      { key: 'FEISHU_APP_SECRET', label: 'App Secret', hint: '飞书开放平台 → 应用详情' },
    ],
    steps: [
      '登录飞书开放平台: https://open.feishu.cn/',
      '创建企业自建应用',
      '添加"机器人"能力',
      '权限管理 → 开通 im:message 相关权限',
      '发布应用',
    ],
  },

  dingtalk: {
    name: '钉钉',
    icon: '📌',
    vars: [
      { key: 'DINGTALK_APP_KEY', label: 'AppKey', hint: '钉钉开放平台 → 应用详情' },
      { key: 'DINGTALK_APP_SECRET', label: 'AppSecret', hint: '钉钉开放平台 → 应用详情' },
      { key: 'DINGTALK_ROBOT_CODE', label: 'Robot Code', hint: '机器人 → Robot Code' },
    ],
    steps: [
      '登录钉钉开放平台: https://open.dingtalk.com/',
      '创建企业内部应用',
      '添加"机器人"能力',
      '权限管理 → 开通消息相关权限',
      '发布应用',
    ],
  },

  telegram: {
    name: 'Telegram',
    icon: '✈️',
    vars: [
      { key: 'TELEGRAM_BOT_TOKEN', label: 'Bot Token', hint: 'Telegram @BotFather → /newbot' },
    ],
    steps: [
      '在 Telegram 搜索 @BotFather',
      '发送 /newbot，按提示创建',
      '复制 Bot Token',
    ],
  },

  slack: {
    name: 'Slack',
    icon: '💬',
    vars: [
      { key: 'SLACK_BOT_TOKEN', label: 'Bot Token (xoxb-)', hint: 'OAuth & Permissions → Install → Bot User OAuth Token' },
      { key: 'SLACK_APP_TOKEN', label: 'App Token (xapp-)', hint: 'Basic Information → App-Level Tokens → Generate' },
      { key: 'SLACK_SIGNING_SECRET', label: 'Signing Secret', hint: 'Basic Information → Signing Secret' },
    ],
    steps: [
      '登录 https://api.slack.com/apps',
      'Create New App → From scratch',
      'OAuth & Permissions → 添加 Scopes: chat:write, channels:history, im:history, im:read, im:write',
      'Install to Workspace → 复制 Bot Token (xoxb-...)',
      'Socket Mode → 启用 → 创建 App Token (xapp-...)',
      'Event Subscriptions → 启用 → Subscribe: message.channels, message.im',
    ],
    postInstall: 'npm install @slack/bolt',
  },

  discord: {
    name: 'Discord',
    icon: '🎮',
    vars: [
      { key: 'DISCORD_BOT_TOKEN', label: 'Bot Token', hint: 'Developer Portal → Bot → Token' },
    ],
    steps: [
      '登录 https://discord.com/developers/applications',
      'New Application → Bot',
      '复制 Bot Token',
      'Privileged Gateway Intents → 启用 Message Content Intent',
      'OAuth2 → URL Generator → 选 bot scope',
      '选权限: Send Messages, Read Message History',
      '用生成的链接邀请 Bot 到服务器',
    ],
    postInstall: 'npm install discord.js',
  },

  line: {
    name: 'LINE',
    icon: '🟢',
    vars: [
      { key: 'LINE_CHANNEL_ACCESS_TOKEN', label: 'Channel Access Token', hint: 'Messaging API → Issue' },
      { key: 'LINE_CHANNEL_SECRET', label: 'Channel Secret', hint: 'Basic settings → Channel Secret' },
    ],
    steps: [
      '登录 https://developers.line.biz/',
      '创建 Provider → 创建 Messaging API Channel',
      '记录 Channel Secret',
      'Issue Channel Access Token',
      'Webhook URL: http://你的域名/line/webhook',
      '启用 Webhook',
    ],
    callbackPath: '/line/webhook',
  },

  whatsapp: {
    name: 'WhatsApp',
    icon: '📞',
    vars: [
      { key: 'WHATSAPP_ACCESS_TOKEN', label: 'Access Token', hint: 'Meta Business → WhatsApp → API Setup' },
      { key: 'WHATSAPP_PHONE_NUMBER_ID', label: 'Phone Number ID', hint: 'API Setup → Phone number ID' },
      { key: 'WHATSAPP_VERIFY_TOKEN', label: 'Webhook Verify Token', hint: '自定义字符串，用于验证回调' },
    ],
    steps: [
      '登录 https://business.facebook.com/',
      '创建 App → WhatsApp',
      '获取 Permanent Access Token',
      '记录 Phone Number ID',
      'Webhook URL: http://你的域名/whatsapp/webhook',
      '订阅 messages 事件',
    ],
    callbackPath: '/whatsapp/webhook',
  },

  signal: {
    name: 'Signal',
    icon: '🔒',
    vars: [
      { key: 'SIGNAL_API_URL', label: 'REST API 地址', hint: 'signal-cli-rest-api 地址', default: 'http://localhost:8080' },
      { key: 'SIGNAL_NUMBER', label: 'Signal 号码', hint: '+8613800138000' },
    ],
    steps: [
      '安装 signal-cli: https://github.com/AsamK/signal-cli',
      '注册: signal-cli -u +你的号码 register',
      '安装 signal-cli-rest-api',
      '启动 REST API 服务',
    ],
  },

  matrix: {
    name: 'Matrix',
    icon: '🔮',
    vars: [
      { key: 'MATRIX_HOMESERVER', label: 'Homeserver', hint: '如 https://matrix.org', default: 'https://matrix.org' },
      { key: 'MATRIX_ACCESS_TOKEN', label: 'Access Token', hint: '通过 API 获取' },
      { key: 'MATRIX_USER_ID', label: 'User ID', hint: '@bot:matrix.org' },
    ],
    steps: [
      '注册 Matrix 账号',
      '获取 Access Token (通过 login API)',
      '配置 .env',
    ],
  },

  teams: {
    name: 'Microsoft Teams',
    icon: '🟦',
    vars: [
      { key: 'TEAMS_APP_ID', label: 'App ID', hint: 'Azure Portal → Bot Channels Registration' },
      { key: 'TEAMS_APP_PASSWORD', label: 'App Password', hint: 'Certificates & Secrets' },
    ],
    steps: [
      '登录 Azure Portal: https://portal.azure.com/',
      '创建 Bot Channels Registration',
      '记录 App ID 和 App Password',
      'Messaging endpoint: http://你的域名:3978/api/messages',
      '在 Teams 中安装 Bot',
    ],
    postInstall: 'npm install botbuilder',
  },

  googlechat: {
    name: 'Google Chat',
    icon: '🔵',
    vars: [
      { key: 'GOOGLECHAT_CREDENTIALS', label: 'Service Account JSON 路径', hint: '如 /root/googlechat-sa.json' },
      { key: 'GOOGLECHAT_PROJECT_ID', label: 'Project ID', hint: 'Google Cloud Console → 项目 ID' },
    ],
    steps: [
      '登录 Google Cloud Console',
      '启用 Google Chat API',
      '创建 Service Account → 下载 JSON 密钥',
      '配置 HTTP endpoint: http://你的域名/googlechat/webhook',
    ],
    postInstall: 'npm install googleapis',
    callbackPath: '/googlechat/webhook',
  },
};

// ========== 工具函数 ==========

function readEnv() {
  try {
    return fs.readFileSync(ENV_PATH, 'utf8');
  } catch {
    return '';
  }
}

function writeEnv(content) {
  fs.writeFileSync(ENV_PATH, content, 'utf8');
}

function getEnvVar(envContent, key) {
  const match = envContent.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return match ? match[1] : '';
}

function setEnvVar(envContent, key, value) {
  const regex = new RegExp(`^${key}=.*$`, 'm');
  if (regex.test(envContent)) {
    return envContent.replace(regex, `${key}=${value}`);
  }
  return envContent.trim() + `\n${key}=${value}\n`;
}

function generateToken(length = 32) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// ========== 交互式配置 ==========

async function ask(rl, question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

async function configurePlatform(platformKey) {
  const platform = PLATFORMS[platformKey];
  if (!platform) {
    console.log(`❌ 未知平台: ${platformKey}`);
    console.log(`可用平台: ${Object.keys(PLATFORMS).join(', ')}`);
    return false;
  }

  console.log(`\n${platform.icon} 配置 ${platform.name}`);
  console.log('='.repeat(40));

  // 显示配置步骤
  if (platform.steps) {
    console.log('\n📋 配置步骤:');
    platform.steps.forEach((step, i) => {
      console.log(`  ${i + 1}. ${step}`);
    });
    console.log('');
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let envContent = readEnv();

  for (const v of platform.vars) {
    const current = getEnvVar(envContent, v.key);
    const defaultVal = v.default || '';
    const hint = v.hint ? ` (${v.hint})` : '';
    const defaultShow = defaultVal ? ` [默认: ${defaultVal}]` : '';
    const currentShow = current ? ` [当前: ${current}]` : '';

    if (v.generate) {
      const autoValue = generateToken();
      console.log(`  ${v.label}: 自动生成 → ${autoValue}`);
      envContent = setEnvVar(envContent, v.key, autoValue);
      continue;
    }

    const answer = await ask(rl, `  ${v.label}${hint}${currentShow}${defaultShow}: `);

    if (answer === '' && current) {
      // 保持现有值
    } else if (answer === '' && defaultVal) {
      envContent = setEnvVar(envContent, v.key, defaultVal);
    } else if (answer === '' && v.optional) {
      // 跳过可选字段
    } else if (answer === '') {
      console.log(`  ⚠️ ${v.label} 不能为空`);
    } else {
      envContent = setEnvVar(envContent, v.key, answer);
    }
  }

  writeEnv(envContent);
  console.log(`\n✅ ${platform.name} 配置已保存到 .env`);

  // 安装依赖
  if (platform.postInstall) {
    console.log(`\n📦 安装依赖: ${platform.postInstall}`);
    const { execSync } = await import('child_process');
    try {
      execSync(platform.postInstall, { cwd: path.join(__dirname, '..'), stdio: 'inherit' });
      console.log('✅ 依赖安装完成');
    } catch (err) {
      console.log('⚠️ 依赖安装失败，请手动执行: ' + platform.postInstall);
    }
  }

  rl.close();
  return true;
}

// ========== 主程序 ==========

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help') {
    console.log('🌉 IM Bridge 适配器配置脚本\n');
    console.log('用法:');
    console.log('  node scripts/setup.js <平台名称>    配置指定平台');
    console.log('  node scripts/setup.js --all          配置所有平台');
    console.log('  node scripts/setup.js --list         列出所有平台');
    console.log('  node scripts/setup.js --status       查看当前配置状态');
    console.log('');
    console.log('平台列表:');
    for (const [key, p] of Object.entries(PLATFORMS)) {
      console.log(`  ${p.icon} ${key.padEnd(20)} ${p.name}`);
    }
    return;
  }

  if (args[0] === '--list') {
    console.log('可用平台:');
    for (const [key, p] of Object.entries(PLATFORMS)) {
      console.log(`  ${p.icon} ${key.padEnd(20)} ${p.name}`);
    }
    return;
  }

  if (args[0] === '--status') {
    const envContent = readEnv();
    console.log('📊 当前配置状态:\n');
    for (const [key, p] of Object.entries(PLATFORMS)) {
      const configured = p.vars.filter(v => !v.optional).every(v => getEnvVar(envContent, v.key));
      console.log(`  ${p.icon} ${p.name.padEnd(16)} ${configured ? '✅ 已配置' : '❌ 未配置'}`);
    }

    // CLI 密码
    const cliPass = getEnvVar(envContent, 'CLI_ACCESS_PASSWORD');
    console.log(`\n  🔑 CLI 密码: ${cliPass ? '✅ 已设置' : '❌ 未设置'}`);
    return;
  }

  if (args[0] === '--all') {
    for (const key of Object.keys(PLATFORMS)) {
      const envContent = readEnv();
      const platform = PLATFORMS[key];
      const configured = platform.vars.filter(v => !v.optional).every(v => getEnvVar(envContent, v.key));
      if (configured) {
        console.log(`\n${platform.icon} ${platform.name}: 已配置，跳过`);
        continue;
      }
      await configurePlatform(key);
    }
    console.log('\n🎉 配置完成！运行 pm2 restart im-bridge 生效。');
    return;
  }

  await configurePlatform(args[0]);
}

main().catch(console.error);

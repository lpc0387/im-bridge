import fs from 'fs';
import path from 'path';
import express from 'express';
import { config } from './config.js';
import { chat, clearHistory, getTurnCount } from './claude.js';
import { mcpManager } from './mcp-client.js';
import { sessionManager } from './session.js';
import { handleCliPassthrough } from './cli-passthrough.js';
import { checkMessageGuard, markBusy, markIdle, getPendingMessage, clearChoice } from './message-guard.js';
import { AdapterManager } from './adapters/manager.js';
import { AgentManager } from './agents/manager.js';
import { CronManager } from './cron/manager.js';
import { WebUI } from './web/manager.js';

const app = express();
app.use(express.json());

// ========== 管理器实例 ==========

const adapterManager = new AdapterManager();
const agentManager = new AgentManager();
const cronManager = new CronManager();
const webUI = new WebUI({ port: config.port + 1 });

// ========== 配置向导流程 ==========

const PLATFORMS = {
  wecom: { name: '企业微信', icon: '💼', vars: [
    { key: 'WECOM_CORPID', label: 'CorpID' },
    { key: 'WECOM_CORPSECRET', label: 'CorpSecret' },
    { key: 'WECOM_AGENTID', label: 'AgentId' },
    { key: 'WECOM_TOKEN', label: '回调 Token' },
    { key: 'WECOM_ENCODING_AES_KEY', label: 'AES Key' },
  ]},
  weixin: { name: '个人微信', icon: '📱', vars: [
    { key: 'WEIXIN_TOKEN', label: 'iLink Bot Token', hint: '微信官方 iLink Bot API Token' },
    { key: 'WEIXIN_BASE_URL', label: 'API 地址', default: 'https://ilinkai.weixin.qq.com', optional: true },
    { key: 'WEIXIN_ALLOW_FROM', label: '白名单', hint: '逗号分隔用户ID，留空允许所有人', optional: true },
  ]},
  feishu: { name: '飞书', icon: '🐦', vars: [
    { key: 'FEISHU_APP_ID', label: 'App ID' },
    { key: 'FEISHU_APP_SECRET', label: 'App Secret' },
  ]},
  dingtalk: { name: '钉钉', icon: '📌', vars: [
    { key: 'DINGTALK_APP_KEY', label: 'AppKey' },
    { key: 'DINGTALK_APP_SECRET', label: 'AppSecret' },
    { key: 'DINGTALK_ROBOT_CODE', label: 'Robot Code' },
  ]},
  telegram: { name: 'Telegram', icon: '✈️', vars: [
    { key: 'TELEGRAM_BOT_TOKEN', label: 'Bot Token' },
  ]},
  slack: { name: 'Slack', icon: '💬', postInstall: 'npm install @slack/bolt', vars: [
    { key: 'SLACK_BOT_TOKEN', label: 'Bot Token (xoxb-)' },
    { key: 'SLACK_APP_TOKEN', label: 'App Token (xapp-)' },
    { key: 'SLACK_SIGNING_SECRET', label: 'Signing Secret' },
  ]},
  discord: { name: 'Discord', icon: '🎮', postInstall: 'npm install discord.js', vars: [
    { key: 'DISCORD_BOT_TOKEN', label: 'Bot Token' },
  ]},
  line: { name: 'LINE', icon: '🟢', vars: [
    { key: 'LINE_CHANNEL_ACCESS_TOKEN', label: 'Access Token' },
    { key: 'LINE_CHANNEL_SECRET', label: 'Channel Secret' },
  ]},
  whatsapp: { name: 'WhatsApp', icon: '📞', vars: [
    { key: 'WHATSAPP_ACCESS_TOKEN', label: 'Access Token' },
    { key: 'WHATSAPP_PHONE_NUMBER_ID', label: 'Phone Number ID' },
    { key: 'WHATSAPP_VERIFY_TOKEN', label: 'Verify Token' },
  ]},
  signal: { name: 'Signal', icon: '🔒', vars: [
    { key: 'SIGNAL_API_URL', label: 'API URL', default: 'http://localhost:8080' },
    { key: 'SIGNAL_NUMBER', label: '号码' },
  ]},
  matrix: { name: 'Matrix', icon: '🔮', vars: [
    { key: 'MATRIX_HOMESERVER', label: 'Homeserver', default: 'https://matrix.org' },
    { key: 'MATRIX_ACCESS_TOKEN', label: 'Access Token' },
    { key: 'MATRIX_USER_ID', label: 'User ID' },
  ]},
  teams: { name: 'Teams', icon: '🟦', postInstall: 'npm install botbuilder', vars: [
    { key: 'TEAMS_APP_ID', label: 'App ID' },
    { key: 'TEAMS_APP_PASSWORD', label: 'App Password' },
  ]},
  googlechat: { name: 'Google Chat', icon: '🔵', postInstall: 'npm install googleapis', vars: [
    { key: 'GOOGLECHAT_CREDENTIALS', label: 'Service Account JSON 路径' },
    { key: 'GOOGLECHAT_PROJECT_ID', label: 'Project ID' },
  ]},
};

// setup 流程状态: { userId → { platform, stepIndex, answers } }
const setupFlows = new Map();

// 会话切换状态: userId → { sessions, shown }
const switchFlows = new Map();

function readEnvFile() {
  try { return fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8'); } catch { return ''; }
}

function writeEnvFile(content) {
  fs.writeFileSync(path.join(process.cwd(), '.env'), content, 'utf8');
}

function getEnvVal(content, key) {
  const m = content.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return m ? m[1] : '';
}

function setEnvVal(content, key, value) {
  const regex = new RegExp(`^${key}=.*$`, 'm');
  if (regex.test(content)) return content.replace(regex, `${key}=${value}`);
  return content.trim() + `\n${key}=${value}\n`;
}

/**
 * 处理配置向导消息，返回 null 表示不在配置流程中
 */
async function handleSetupFlow(userId, content, sendFn) {
  const flow = setupFlows.get(userId);

  // 进入配置模式
  if (content === '/setup') {
    if (!flow) {
      // 显示平台列表
      const lines = Object.entries(PLATFORMS).map(([key, p], i) => `${i + 1}. ${p.icon} ${p.name} (${key})`);
      await sendFn(`🔧 选择要配置的平台（输入编号或名称）:\n\n${lines.join('\n')}\n\n输入 /exit 退出配置`);
      setupFlows.set(userId, { step: 'select', answers: {} });
    }
    return true;
  }

  // 退出配置模式
  if (content === '/exit' && flow) {
    setupFlows.delete(userId);
    await sendFn('✅ 已退出配置向导');
    return true;
  }

  if (!flow) return null; // 不在配置流程中

  // 选择平台
  if (flow.step === 'select') {
    const keys = Object.keys(PLATFORMS);
    let selected = null;

    // 按编号
    const num = parseInt(content);
    if (num >= 1 && num <= keys.length) {
      selected = keys[num - 1];
    }
    // 按名称
    if (!selected) {
      selected = keys.find(k => k === content || PLATFORMS[k].name === content);
    }

    if (!selected) {
      await sendFn(`❌ 无效选择，请输入编号(1-${keys.length})或平台名称`);
      return true;
    }

    const platform = PLATFORMS[selected];
    flow.platform = selected;
    flow.step = 'input';
    flow.stepIndex = 0;
    flow.answers = {};

    // 显示配置提示
    const current = readEnvFile();
    const firstVar = platform.vars[0];
    const existing = getEnvVal(current, firstVar.key);
    const defaultShow = firstVar.default ? ` [默认: ${firstVar.default}]` : '';
    const existingShow = existing ? ` [当前: ${existing.substring(0, 20)}...]` : '';

    await sendFn(`${platform.icon} 配置 ${platform.name}\n\n请输入 ${firstVar.label}${defaultShow}${existingShow}\n（直接回车跳过可选项，输入 /exit 退出）`);
    return true;
  }

  // 逐项输入
  if (flow.step === 'input') {
    const platform = PLATFORMS[flow.platform];
    const currentVar = platform.vars[flow.stepIndex];
    const current = readEnvFile();
    const existing = getEnvVal(current, currentVar.key);

    // 保存值
    if (content === '/skip' || (content === '' && currentVar.optional)) {
      // 跳过
    } else if (content === '' && existing) {
      // 保持现有值
    } else if (content === '' && currentVar.default) {
      flow.answers[currentVar.key] = currentVar.default;
    } else if (content !== '') {
      flow.answers[currentVar.key] = content;
    }

    flow.stepIndex++;

    // 还有下一个字段
    if (flow.stepIndex < platform.vars.length) {
      const nextVar = platform.vars[flow.stepIndex];
      const nextExisting = getEnvVal(current, nextVar.key);
      const defaultShow = nextVar.default ? ` [默认: ${nextVar.default}]` : '';
      const existingShow = nextExisting ? ` [当前: ${nextExisting.substring(0, 20)}...]` : '';
      await sendFn(`${flow.stepIndex + 1}/${platform.vars.length} ${nextVar.label}${defaultShow}${existingShow}`);
      return true;
    }

    // 全部填完，保存
    let env = readEnvFile();
    for (const [key, value] of Object.entries(flow.answers)) {
      env = setEnvVal(env, key, value);
    }
    writeEnvFile(env);

    // 安装依赖
    if (platform.postInstall) {
      await sendFn(`📦 安装依赖: ${platform.postInstall}...`);
      const { execSync } = await import('child_process');
      try {
        execSync(platform.postInstall, { cwd: process.cwd(), timeout: 120000 });
        await sendFn('✅ 依赖安装完成');
      } catch {
        await sendFn('⚠️ 依赖安装失败，请手动执行: ' + platform.postInstall);
      }
    }

    setupFlows.delete(userId);
    await sendFn(`✅ ${platform.name} 配置已保存！\n\n重启服务后生效: pm2 restart im-bridge\n\n输入 /setup 配置其他平台`);
    return true;
  }

  return null;
} // Web UI 使用不同端口

// ========== 健康检查 ==========
app.get('/', (req, res) => {
  const mcpStatus = mcpManager.getStatus();
  res.json({
    status: 'running',
    mcp: mcpStatus.map(s => ({ name: s.name, connected: s.connected, tools: s.tools.length })),
    adapters: adapterManager.getStatus(),
    agents: agentManager.getStatus(),
    uptime: process.uptime(),
  });
});

// ========== 对话接口 ==========
app.post('/chat', async (req, res) => {
  const { userId = 'http:user', message } = req.body;
  if (!message) return res.status(400).json({ error: 'message is required' });

  try {
    // 配置向导（最高优先级）
    const setupMessages = [];
    const setupHandled = await handleSetupFlow(userId, message, async (text) => { setupMessages.push(text); });
    if (setupHandled) {
      const flow = setupFlows.get(userId);
      if (!flow) return res.json({ reply: setupMessages.join('\n\n') || '✅ 配置已保存，重启后生效' });
      return res.json({ reply: setupMessages.join('\n\n') });
    }

    // 会话切换流程
    const httpSwitch = switchFlows.get(userId);
    if (httpSwitch && !message.startsWith('/')) {
      const num = parseInt(message.trim());
      if (num >= 1 && num <= httpSwitch.sessions.length) {
        const target = httpSwitch.sessions[num - 1];
        await sessionManager.switchTo(userId, target.id);
        switchFlows.delete(userId);
        return res.json({ reply: `✅ 已切换到「${target.name}」\n轮数: ${target.messageCount} | Token: ${target.tokenUsage.total}` });
      }
      if (message.trim() === '0') {
        switchFlows.delete(userId);
        return res.json({ reply: '已取消切换' });
      }
    }

    // 1. 会话命令
    if (message.startsWith('/')) {
      const cmd = message.trim();
      if (cmd === '/clear') { await clearHistory(userId); return res.json({ reply: '✅ 会话已清空' }); }
      if (cmd === '/turns') { return res.json({ reply: `📊 轮数: ${await getTurnCount(userId)}` }); }
      if (cmd === '/new') { const ts = Date.now().toString(36); await sessionManager.switchTo(userId, ts); return res.json({ reply: `✅ 新会话: ${ts}` }); }
      if (cmd === '/switch' || cmd === '/sessions') {
        const sessions = await sessionManager.list(userId);
        if (!sessions.length) return res.json({ reply: '📭 暂无会话，发送消息自动创建' });
        const current = await sessionManager.getActive(userId);
        const lines = sessions.map((s, i) => {
          const marker = s.id === current.id ? ' ← 当前' : '';
          const date = new Date(s.lastActiveAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
          return `${i + 1}. ${s.name}${marker} | 轮数:${s.messageCount} | Token:${s.tokenUsage.total} | ${date}`;
        });
        switchFlows.set(userId, { sessions });
        return res.json({ reply: `📋 会话列表（输入编号切换，0 取消）:\n\n${lines.join('\n')}` });
      }
      if (cmd.startsWith('/session ')) { const name = cmd.slice(9).trim(); await sessionManager.switchTo(userId, name); return res.json({ reply: `✅ 切换到: ${name}` }); }
      if (cmd === '/cost') { const s = await sessionManager.getActive(userId); return res.json({ reply: `💰 Token: 输入${s.tokenUsage.input} 输出${s.tokenUsage.output} 合计${s.tokenUsage.total}` }); }
      if (cmd === '/agents') { return res.json({ reply: agentManager.getStatus().map(a => `${a.name} (${a.type}) ${a.busy ? '忙碌' : '空闲'}${a.isDefault ? ' [默认]' : ''}`).join('\n') }); }
      if (cmd === '/adapters') { return res.json({ reply: adapterManager.getStatus().map(a => `${a.name}: ${a.connected ? '✅' : '❌'}`).join('\n') }); }
      if (cmd === '/cron') { return res.json({ reply: cronManager.getTasks().map(t => `${t.name} (${t.schedule}) ${t.enabled ? '启用' : '禁用'}`).join('\n') }); }
    }

    // 2. @@命令 — CLI 透传
    if (message.startsWith('@@')) {
      const reply = await handleCliPassthrough(message, (status) => {
        console.log(`[CLI] ${status}`);
      });
      return res.json({ reply });
    }

    // 3. 普通消息 → Claude API
    const reply = await chat(userId, message);
    res.json({ reply });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== MCP 接口 ==========
app.get('/mcp/status', (req, res) => res.json(mcpManager.getStatus()));

app.post('/mcp/add', async (req, res) => {
  const { name, url } = req.body;
  if (!name || !url) return res.status(400).json({ error: 'name and url required' });
  try {
    await mcpManager.addServer(name, url);
    res.json({ ok: true, tools: mcpManager.clients.get(name)?.tools.map(t => t.name) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/mcp/remove', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  await mcpManager.removeServer(name);
  res.json({ ok: true });
});

app.post('/mcp/reload', async (req, res) => {
  await mcpManager.reloadAll();
  res.json({ ok: true, count: mcpManager.clients.size });
});

// ========== 启动 ==========
async function main() {
  console.log('🚀 IM Bridge 启动中...\n');

  // 初始化 MCP
  console.log('🔌 加载 MCP 服务器...');
  await mcpManager.init();
  const mcpCount = mcpManager.clients.size;
  const toolCount = mcpManager.getAllTools().length;
  if (mcpCount > 0) {
    console.log(`   ✅ 已加载 ${mcpCount} 个 MCP 服务器，共 ${toolCount} 个工具\n`);
  } else {
    console.log('   📭 暂无 MCP 服务器\n');
  }

  // 初始化 Agent
  console.log('🤖 初始化 AI Agent...');
  agentManager.registerClaudeAPI('claude-api', {
    apiKey: config.anthropic.apiKey || config.anthropic.authToken,
    baseUrl: config.anthropic.baseUrl,
    model: config.anthropic.model,
  });
  console.log('   ✅ Claude API Agent 已注册\n');

  // 初始化适配器（12 个平台）
  console.log('🔌 初始化 IM 适配器...');
  adapterManager.registerWecom(config.wecom);
  adapterManager.registerWeixin(config.weixin);
  adapterManager.registerFeishu(config.feishu);
  adapterManager.registerDingTalk(config.dingtalk);
  adapterManager.registerTelegram(config.telegram);
  adapterManager.registerSlack(config.slack);
  adapterManager.registerDiscord(config.discord);
  adapterManager.registerLine(config.line);
  adapterManager.registerWhatsApp(config.whatsapp);
  adapterManager.registerSignal(config.signal);
  adapterManager.registerMatrix(config.matrix);
  adapterManager.registerTeams(config.teams);
  adapterManager.registerGoogleChat(config.googlechat);
  console.log(`   ✅ 已注册 ${adapterManager.adapters.size} 个适配器\n`);

  // 注册 Webhook 路由（企微、WhatsApp、LINE、Google Chat 等需要 HTTP 回调的适配器）
  for (const adapter of adapterManager.getWebhookAdapters()) {
    adapter.registerRoutes(app);
  }

  // 设置消息处理器
  adapterManager.onMessage(async (message) => {
    console.log(`[${message.platform}] ${message.userName}: ${message.content.substring(0, 50)}...`);

    try {
      // 配置向导（最高优先级）
      const setupHandled = await handleSetupFlow(message.userId, message.content, message.send);
      if (setupHandled) return;

      // 消息守卫 — 并发控制
      const guard = checkMessageGuard(message.userId, message.content);
      if (guard.action === 'wait' || guard.action === 'choice' || guard.action === 'choice_again') {
        await message.send(guard.message);
        return;
      }
      if (guard.action === 'waiting') {
        await message.send(guard.message);
        return;
      }
      if (guard.action === 'new_session') {
        // 开启新会话
        const ts = Date.now().toString(36);
        await sessionManager.switchTo(message.userId, ts);
        clearChoice(message.userId);
        await message.send(guard.message);
        return;
      }

      // 会话切换流程（数字选择）
      const switchFlow = switchFlows.get(message.userId);
      if (switchFlow) {
        const input = message.content.trim();
        if (input === '/exit' || input === '0') {
          switchFlows.delete(message.userId);
          await message.send('已取消切换');
          return;
        }
        const num = parseInt(input);
        if (num >= 1 && num <= switchFlow.sessions.length) {
          const target = switchFlow.sessions[num - 1];
          await sessionManager.switchTo(message.userId, target.id);
          switchFlows.delete(message.userId);
          await message.send(`✅ 已切换到「${target.name}」\n轮数: ${target.messageCount} | Token: ${target.tokenUsage.total}`);
        } else {
          await message.send(`请输入编号 1-${switchFlow.sessions.length}，或输入 0 取消`);
        }
        return;
      }

      // 命令处理
      if (message.content.startsWith('/')) {
        const cmd = message.content.trim();

        // 会话管理命令
        if (cmd === '/clear') {
          await clearHistory(message.userId);
          await message.send('✅ 会话已清空');
          return;
        }
        if (cmd === '/turns') {
          const turns = await getTurnCount(message.userId);
          await message.send(`📊 当前会话轮数: ${turns}`);
          return;
        }
        if (cmd === '/cost') {
          const s = await sessionManager.getActive(message.userId);
          await message.send(`💰 Token 消耗:\n- 输入: ${s.tokenUsage.input}\n- 输出: ${s.tokenUsage.output}\n- 合计: ${s.tokenUsage.total}`);
          return;
        }
        if (cmd === '/new') {
          const ts = Date.now().toString(36);
          await sessionManager.switchTo(message.userId, ts);
          await message.send(`✅ 已创建新会话: ${ts}`);
          return;
        }
        if (cmd === '/sessions' || cmd === '/switch') {
          const sessions = await sessionManager.list(message.userId);
          if (!sessions.length) {
            await message.send('📭 暂无会话，发送消息自动创建');
            return;
          }
          const current = await sessionManager.getActive(message.userId);
          const lines = sessions.map((s, i) => {
            const marker = s.id === current.id ? ' ← 当前' : '';
            const date = new Date(s.lastActiveAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            return `${i + 1}. ${s.name}${marker}\n   轮数:${s.messageCount} | Token:${s.tokenUsage.total} | ${date}`;
          });
          switchFlows.set(message.userId, { sessions });
          await message.send(`📋 会话列表（输入编号切换，0 取消）:\n\n${lines.join('\n')}`);
          return;
        }

        // 系统命令
        if (cmd === '/agents') {
          await message.send(agentManager.getStatus().map(a => `${a.name} (${a.type}) ${a.busy ? '忙碌' : '空闲'}${a.isDefault ? ' [默认]' : ''}`).join('\n'));
          return;
        }
        if (cmd === '/adapters') {
          await message.send(adapterManager.getStatus().map(a => `${a.name}: ${a.connected ? '✅' : '❌'}`).join('\n'));
          return;
        }
        if (cmd === '/cron') {
          await message.send(cronManager.getTasks().map(t => `${t.name} (${t.schedule}) ${t.enabled ? '启用' : '禁用'}`).join('\n'));
          return;
        }
        if (cmd === '/help') {
          await message.send(`📋 可用命令:\n\n💬 对话:\n/setup — 配置适配器\n/clear — 清空会话\n/new — 新建会话\n/switch — 切换会话\n/sessions — 会话列表\n/cost — Token 消耗\n/turns — 对话轮数\n\n🔧 系统:\n/agents — Agent 列表\n/adapters — 适配器状态\n/cron — 定时任务\n\n🖥️ CLI:\n@@密码 命令 — 调用服务器 CLI`);
          return;
        }
      }

      // @@命令 — CLI 透传
      if (message.content.startsWith('@@')) {
        markBusy(message.userId, 'CLI 命令');
        try {
          let lastCliStatusTime = 0;
          const reply = await handleCliPassthrough(message.content, (status) => {
            const now = Date.now();
            if (now - lastCliStatusTime > 5000) {
              lastCliStatusTime = now;
              message.sendStatus(status).catch(() => {});
            }
          });
          await message.send(reply);
        } finally {
          markIdle(message.userId);
        }
        return;
      }

      // 普通消息
      markBusy(message.userId, '对话');
      try {
        const reply = await chat(message.userId, message.content, async (status) => {
          await message.sendStatus(status);
        });
        await message.send(reply);
      } finally {
        markIdle(message.userId);
      }
    } catch (err) {
      console.error(`[${message.platform}] 处理消息失败:`, err.message);
      await message.send(`❌ 处理消息失败: ${err.message}`);
    }
  });

  // 启动适配器
  console.log('🚀 启动 IM 适配器...');
  const results = await adapterManager.startAll();
  results.forEach(r => {
    console.log(`   ${r.success ? '✅' : '❌'} ${r.name}: ${r.success ? '已启动' : r.error}`);
  });
  console.log('');

  // 初始化定时任务
  console.log('⏰ 初始化定时任务...');
  cronManager.setAgentManager(agentManager);
  cronManager.setAdapterManager(adapterManager);
  await cronManager.loadTasks();
  console.log(`   ✅ 已加载 ${cronManager.tasks.size} 个定时任务\n`);

  // 启动 Web 管理界面
  console.log('🌐 启动 Web 管理界面...');
  webUI.setAdapters(adapterManager);
  webUI.setAgents(agentManager);
  webUI.setCron(cronManager);
  webUI.setMCP(mcpManager);
  webUI.setSessions(sessionManager);
  await webUI.start();
  console.log(`   ✅ Web 管理界面: http://localhost:${config.port + 1}\n`);

  // 启动 HTTP 服务
  app.listen(config.port, () => {
    console.log(`🌐 HTTP 服务器已启动: http://localhost:${config.port}`);
    console.log('   POST /chat         - 对话');
    console.log('   GET  /mcp/status   - MCP 状态');
    console.log('   POST /mcp/add      - 添加 MCP');
    console.log('   POST /mcp/remove   - 移除 MCP');
    console.log('   POST /mcp/reload   - 重载 MCP');
    console.log('   GET  /             - 健康检查\n');
    
    console.log('🎉 IM Bridge 启动完成！');
    console.log('   支持平台: 企业微信、飞书、钉钉、Telegram');
    console.log('   支持 Agent: Claude API、Claude Code CLI');
    console.log('   管理界面: http://localhost:' + (config.port + 1) + '\n');
  });
}

main();

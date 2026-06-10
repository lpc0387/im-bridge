import express from 'express';
import { config } from './config.js';
import { chat, clearHistory, getTurnCount } from './claude.js';
import { mcpManager } from './mcp-client.js';
import { sessionManager } from './session.js';
import { handleCliPassthrough } from './cli-passthrough.js';

// 新增：适配器管理器
import { AdapterManager } from './adapters/manager.js';
import { FeishuAdapter } from './adapters/feishu.js';
import { DingTalkAdapter } from './adapters/dingtalk.js';
import { TelegramAdapter } from './adapters/telegram.js';
import { WeChatAdapter } from './adapters/wechat.js';

// 新增：Agent 管理器
import { AgentManager } from './agents/manager.js';

// 新增：定时任务管理器
import { CronManager } from './cron/manager.js';

// 新增：Web 管理界面
import { WebUI } from './web/manager.js';

const app = express();
app.use(express.json());

// ========== 管理器实例 ==========

const adapterManager = new AdapterManager();
const agentManager = new AgentManager();
const cronManager = new CronManager();
const webUI = new WebUI({ port: config.port + 1 }); // Web UI 使用不同端口

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
    // 1. 会话命令
    if (message.startsWith('/')) {
      const cmd = message.trim();
      if (cmd === '/clear') { await clearHistory(userId); return res.json({ reply: '✅ 会话已清空' }); }
      if (cmd === '/turns') { return res.json({ reply: `📊 轮数: ${await getTurnCount(userId)}` }); }
      if (cmd === '/new') { const ts = Date.now().toString(36); await sessionManager.switchTo(userId, ts); return res.json({ reply: `✅ 新会话: ${ts}` }); }
      if (cmd === '/sessions') {
        const sessions = await sessionManager.list(userId);
        if (!sessions.length) return res.json({ reply: '📭 暂无会话' });
        const current = await sessionManager.getActive(userId);
        return res.json({ reply: sessions.map(s => `${s.id === current.id ? '→ ' : '  '}${s.name} | 轮数:${s.messageCount} | Token:${s.tokenUsage.total}`).join('\n') });
      }
      if (cmd.startsWith('/session ')) { const name = cmd.slice(9).trim(); await sessionManager.switchTo(userId, name); return res.json({ reply: `✅ 切换到: ${name}` }); }
      if (cmd === '/cost') { const s = await sessionManager.getActive(userId); return res.json({ reply: `💰 Token: 输入${s.tokenUsage.input} 输出${s.tokenUsage.output} 合计${s.tokenUsage.total}` }); }
      
      // 新增：Agent 命令
      if (cmd === '/agents') { return res.json({ reply: agentManager.getStatus().map(a => `${a.name} (${a.type}) ${a.busy ? '忙碌' : '空闲'}${a.isDefault ? ' [默认]' : ''}`).join('\n') }); }
      if (cmd.startsWith('/agent ')) { const name = cmd.slice(7).trim(); agentManager.setDefault(name); return res.json({ reply: `✅ 默认 Agent 已切换到: ${name}` }); }
      
      // 新增：适配器命令
      if (cmd === '/adapters') { return res.json({ reply: adapterManager.getStatus().map(a => `${a.name}: ${a.connected ? '✅' : '❌'}`).join('\n') }); }
      
      // 新增：定时任务命令
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

  // 初始化适配器
  console.log('🔌 初始化 IM 适配器...');
  
  // 企业微信适配器
  if (config.wecom.corpId && config.wecom.corpSecret) {
    adapterManager.registerWeChat({
      corpId: config.wecom.corpId,
      corpSecret: config.wecom.corpSecret,
      agentId: config.wecom.agentId,
      token: config.wecom.token,
      encodingAESKey: config.wecom.encodingAESKey,
      webhookUrl: config.wecom.webhookUrl,
    });
  }

  // 飞书适配器
  if (config.feishu?.appId && config.feishu?.appSecret) {
    adapterManager.registerFeishu({
      appId: config.feishu.appId,
      appSecret: config.feishu.appSecret,
    });
  }

  // 钉钉适配器
  if (config.dingtalk?.appKey && config.dingtalk?.appSecret) {
    adapterManager.registerDingTalk({
      appKey: config.dingtalk.appKey,
      appSecret: config.dingtalk.appSecret,
      robotCode: config.dingtalk.robotCode,
    });
  }

  // Telegram 适配器
  if (config.telegram?.token) {
    adapterManager.registerTelegram({
      token: config.telegram.token,
    });
  }

  console.log(`   ✅ 已注册 ${adapterManager.adapters.size} 个适配器\n`);

  // 设置消息处理器
  adapterManager.onMessage(async (message) => {
    console.log(`[${message.platform}] ${message.userName}: ${message.content.substring(0, 50)}...`);
    
    try {
      // 处理命令
      if (message.content.startsWith('/')) {
        const cmd = message.content.trim();
        if (cmd === '/clear') {
          await clearHistory(message.userId);
          await message.send('✅ 会话已清空');
          return;
        }
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
      }

      // 普通消息
      const reply = await chat(message.userId, message.content, async (status) => {
        await message.sendStatus(status);
      });
      await message.send(reply);
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

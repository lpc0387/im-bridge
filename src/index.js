import express from 'express';
import { config } from './config.js';
import { startTelegramBot } from './telegram.js';
import { startWecomServer } from './wecom.js';
import { chat, clearHistory, getTurnCount } from './claude.js';
import { mcpManager } from './mcp-client.js';

const app = express();
app.use(express.json());

// ========== 健康检查 ==========
app.get('/', (req, res) => {
  const mcpStatus = mcpManager.getStatus();
  res.json({
    status: 'running',
    channels: {
      telegram: !!config.telegram.botToken,
      wecom: !!config.wecom.webhookUrl,
    },
    mcp: mcpStatus.map(s => ({ name: s.name, connected: s.connected, tools: s.tools.length })),
    uptime: process.uptime(),
  });
});

// ========== 调试用：直接 HTTP 调用 Claude ==========
app.post('/chat', async (req, res) => {
  const { userId = 'http:user', message } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'message is required' });
  }
  try {
    const reply = await chat(userId, message);
    res.json({ reply });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/clear', (req, res) => {
  const { userId = 'http:user' } = req.body;
  clearHistory(userId);
  res.json({ ok: true });
});

// ========== MCP HTTP 接口 ==========
app.get('/mcp/status', (req, res) => {
  res.json(mcpManager.getStatus());
});

app.post('/mcp/add', async (req, res) => {
  const { name, url } = req.body;
  if (!name || !url) return res.status(400).json({ error: 'name and url required' });
  try {
    await mcpManager.addServer(name, url);
    res.json({ ok: true, tools: mcpManager.clients.get(name)?.tools.map(t => t.name) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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

// ========== 启动各通道 ==========
async function main() {
  const channelArg = process.argv.find((a) => a.startsWith('--channel='));
  const channel = channelArg?.split('=')[1];

  console.log('🚀 IM Bridge 启动中...\n');

  // 初始化 MCP 服务器
  console.log('🔌 加载 MCP 服务器...');
  await mcpManager.init();
  const mcpCount = mcpManager.clients.size;
  const toolCount = mcpManager.getAllTools().length;
  if (mcpCount > 0) {
    console.log(`   ✅ 已加载 ${mcpCount} 个 MCP 服务器，共 ${toolCount} 个工具\n`);
  } else {
    console.log('   📭 暂无 MCP 服务器（通过 /mcp add 添加）\n');
  }

  // 启动 Telegram Bot
  if (!channel || channel === 'telegram') {
    startTelegramBot();
  }

  // 启动企微回调服务器
  if (!channel || channel === 'wecom') {
    startWecomServer(app);
  }

  // 启动 HTTP 服务器
  app.listen(config.port, () => {
    console.log(`🌐 HTTP 服务器已启动: http://localhost:${config.port}`);
    console.log('   POST /chat        - 对话');
    console.log('   POST /clear       - 清除历史');
    console.log('   GET  /mcp/status  - MCP 状态');
    console.log('   POST /mcp/add     - 添加 MCP');
    console.log('   POST /mcp/remove  - 移除 MCP');
    console.log('   POST /mcp/reload  - 重载 MCP');
    console.log('   GET  /            - 健康检查\n');
  });
}

main();

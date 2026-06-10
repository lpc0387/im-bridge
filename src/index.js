import express from 'express';
import { config } from './config.js';
import { startWecomServer } from './wecom.js';
import { chat, clearHistory, getTurnCount } from './claude.js';
import { mcpManager } from './mcp-client.js';
import { sessionManager } from './session.js';
import { handleCliPassthrough } from './cli-passthrough.js';

const app = express();
app.use(express.json());

// ========== 健康检查 ==========
app.get('/', (req, res) => {
  const mcpStatus = mcpManager.getStatus();
  res.json({
    status: 'running',
    mcp: mcpStatus.map(s => ({ name: s.name, connected: s.connected, tools: s.tools.length })),
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
    }

    // 2. @@命令 — CLI 透传
    if (message.startsWith('@@')) {
      const reply = await handleCliPassthrough(message);
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

  console.log('🔌 加载 MCP 服务器...');
  await mcpManager.init();
  const mcpCount = mcpManager.clients.size;
  const toolCount = mcpManager.getAllTools().length;
  if (mcpCount > 0) {
    console.log(`   ✅ 已加载 ${mcpCount} 个 MCP 服务器，共 ${toolCount} 个工具\n`);
  } else {
    console.log('   📭 暂无 MCP 服务器\n');
  }

  startWecomServer(app);

  app.listen(config.port, () => {
    console.log(`🌐 HTTP 服务器已启动: http://localhost:${config.port}`);
    console.log('   POST /chat         - 对话');
    console.log('   GET  /mcp/status   - MCP 状态');
    console.log('   POST /mcp/add      - 添加 MCP');
    console.log('   POST /mcp/remove   - 移除 MCP');
    console.log('   POST /mcp/reload   - 重载 MCP');
    console.log('   GET  /             - 健康检查\n');
  });
}

main();

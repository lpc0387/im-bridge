import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Web 管理界面
 */
export class WebUI {
  constructor(config = {}) {
    this.app = express();
    this.port = config.port || 8080;
    this.auth = config.auth; // { username, password }
    this.adapterManager = null;
    this.agentManager = null;
    this.cronManager = null;
    this.mcpManager = null;
    this.sessionManager = null;

    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * 设置中间件
   */
  setupMiddleware() {
    this.app.use(express.json());
    this.app.use(express.static(path.join(__dirname, 'public')));

    // 认证中间件
    if (this.auth) {
      this.app.use('/api', (req, res, next) => {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Basic ')) {
          return res.status(401).json({ error: '未授权' });
        }

        const credentials = Buffer.from(authHeader.slice(6), 'base64').toString();
        const [username, password] = credentials.split(':');

        if (username !== this.auth.username || password !== this.auth.password) {
          return res.status(401).json({ error: '认证失败' });
        }

        next();
      });
    }
  }

  /**
   * 设置路由
   */
  setupRoutes() {
    // 状态接口
    this.app.get('/api/status', (req, res) => {
      res.json({
        uptime: process.uptime(),
        adapters: this.adapterManager?.getStatus() || [],
        agents: this.agentManager?.getStatus() || [],
        cron: this.cronManager?.getTasks() || [],
        mcp: this.mcpManager?.getStatus() || [],
      });
    });

    // 适配器接口
    this.app.get('/api/adapters', (req, res) => {
      res.json(this.adapterManager?.getStatus() || []);
    });

    // Agent 接口
    this.app.get('/api/agents', (req, res) => {
      res.json(this.agentManager?.getStatus() || []);
    });

    this.app.post('/api/agents/:name/execute', async (req, res) => {
      try {
        const { name } = req.params;
        const { prompt, options } = req.body;
        const result = await this.agentManager.execute(prompt, { ...options, agent: name });
        res.json({ success: true, result });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // 定时任务接口
    this.app.get('/api/cron', (req, res) => {
      res.json(this.cronManager?.getTasks() || []);
    });

    this.app.post('/api/cron', async (req, res) => {
      try {
        const { name, schedule, prompt, options } = req.body;
        await this.cronManager.addTask(name, schedule, prompt, options);
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    this.app.delete('/api/cron/:name', async (req, res) => {
      try {
        await this.cronManager.removeTask(req.params.name);
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    this.app.post('/api/cron/:name/run', async (req, res) => {
      try {
        const result = await this.cronManager.runTask(req.params.name);
        res.json({ success: true, result });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    this.app.post('/api/cron/:name/enable', async (req, res) => {
      try {
        await this.cronManager.enableTask(req.params.name);
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    this.app.post('/api/cron/:name/disable', async (req, res) => {
      try {
        await this.cronManager.disableTask(req.params.name);
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // MCP 接口
    this.app.get('/api/mcp', (req, res) => {
      res.json(this.mcpManager?.getStatus() || []);
    });

    this.app.post('/api/mcp/add', async (req, res) => {
      try {
        const { name, url } = req.body;
        await this.mcpManager.addServer(name, url);
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    this.app.delete('/api/mcp/:name', async (req, res) => {
      try {
        await this.mcpManager.removeServer(req.params.name);
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // 会话接口
    this.app.get('/api/sessions', async (req, res) => {
      try {
        const sessions = await this.sessionManager.list(req.query.userId || 'default');
        res.json(sessions);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    this.app.delete('/api/sessions/:userId/:sessionId', async (req, res) => {
      try {
        await this.sessionManager.deleteSession(req.params.userId, req.params.sessionId);
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // 对话接口
    this.app.post('/api/chat', async (req, res) => {
      try {
        const { userId = 'web:user', message, agent } = req.body;
        const result = await this.agentManager.execute(message, { agent });
        res.json({ success: true, result });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    });
  }

  /**
   * 设置依赖
   */
  setAdapters(adapterManager) {
    this.adapterManager = adapterManager;
  }

  setAgents(agentManager) {
    this.agentManager = agentManager;
  }

  setCron(cronManager) {
    this.cronManager = cronManager;
  }

  setMCP(mcpManager) {
    this.mcpManager = mcpManager;
  }

  setSessions(sessionManager) {
    this.sessionManager = sessionManager;
  }

  /**
   * 启动 Web 服务
   */
  async start() {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, () => {
        console.log(`[WebUI] ✅ 管理界面已启动: http://localhost:${this.port}`);
        resolve();
      });
    });
  }

  /**
   * 停止 Web 服务
   */
  async stop() {
    if (this.server) {
      this.server.close();
    }
  }
}

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

    // ========== 适配器配置向导 API ==========

    // 获取所有平台配置模板
    this.app.get('/api/setup/platforms', (req, res) => {
      const platforms = this._getPlatformTemplates();
      res.json(platforms);
    });

    // 获取指定平台的当前配置状态
    this.app.get('/api/setup/:platform/status', (req, res) => {
      const platform = req.params.platform;
      const template = this._getPlatformTemplates()[platform];
      if (!template) return res.status(404).json({ error: '未知平台' });

      const envContent = this._readEnv();
      const status = {};
      for (const v of template.vars) {
        const val = this._getEnvVar(envContent, v.key);
        status[v.key] = { configured: !!val, value: val ? '***' : '' };
      }
      res.json({ platform, name: template.name, vars: status });
    });

    // 保存平台配置
    this.app.post('/api/setup/:platform', async (req, res) => {
      try {
        const platform = req.params.platform;
        const template = this._getPlatformTemplates()[platform];
        if (!template) return res.status(404).json({ error: '未知平台' });

        let envContent = this._readEnv();
        for (const [key, value] of Object.entries(req.body)) {
          envContent = this._setEnvVar(envContent, key, value);
        }
        this._writeEnv(envContent);

        // 安装依赖
        if (template.postInstall) {
          const { execSync } = await import('child_process');
          try {
            execSync(template.postInstall, { cwd: process.cwd(), timeout: 120000 });
          } catch {}
        }

        res.json({ success: true, message: `${template.name} 配置已保存，正在重启...` });

        // 延迟重启，让响应先返回
        setTimeout(() => process.exit(0), 2000);
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // 重启服务
    this.app.post('/api/restart', (req, res) => {
      res.json({ success: true, message: '正在重启...' });
      setTimeout(() => process.exit(0), 1000);
    });

    // ========== 个人微信扫码登录 API ==========

    // 获取二维码
    this.app.get('/api/weixin/qrcode', async (req, res) => {
      try {
        const { WeixinAdapter } = await import('../adapters/weixin.js');
        const adapter = new WeixinAdapter({ token: 'temp' });
        const qr = await adapter.getQRCode();
        res.json({ success: true, ...qr });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // 轮询扫码状态
    this.app.get('/api/weixin/poll', async (req, res) => {
      try {
        const { qrcode } = req.query;
        if (!qrcode) return res.status(400).json({ error: 'qrcode required' });
        const { WeixinAdapter } = await import('../adapters/weixin.js');
        const adapter = new WeixinAdapter({ token: 'temp' });
        const result = await adapter.pollQRStatus(qrcode);
        res.json(result);
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
   * 获取平台配置模板
   */
  _getPlatformTemplates() {
    return {
      wechat: { name: '企业微信', icon: '💼', postInstall: null, guide: 'https://work.weixin.qq.com/wework_admin/frame', vars: [
        { key: 'WECOM_CORPID', label: 'CorpID', hint: '企微后台 → 我的企业 → 企业信息最下方', placeholder: 'ww4a417a7419e691c5' },
        { key: 'WECOM_CORPSECRET', label: 'CorpSecret', hint: '企微后台 → 应用管理 → 自建应用 → Secret', placeholder: '' },
        { key: 'WECOM_AGENTID', label: 'AgentId', hint: '企微后台 → 应用管理 → 自建应用 → AgentId', placeholder: '1000002' },
        { key: 'WECOM_TOKEN', label: '回调 Token', hint: '企微后台 → 应用详情 → 接收消息 → 设置API接收 → Token（自定义字符串）', placeholder: '随机生成即可' },
        { key: 'WECOM_ENCODING_AES_KEY', label: 'EncodingAESKey', hint: '企微后台 → 接收消息 → 设置API接收 → 点击"随机生成"', placeholder: '43位随机字符串' },
      ]},
      weixin: { name: '个人微信', icon: '📱', postInstall: null, guide: 'https://ilinkai.weixin.qq.com', vars: [
        { key: 'WEIXIN_TOKEN', label: 'iLink Bot Token', hint: '微信官方 iLink Bot API Token（安全不封号）', placeholder: '' },
        { key: 'WEIXIN_BASE_URL', label: 'API 地址', hint: '默认 https://ilinkai.weixin.qq.com', placeholder: 'https://ilinkai.weixin.qq.com', default: 'https://ilinkai.weixin.qq.com', optional: true },
        { key: 'WEIXIN_ALLOW_FROM', label: '白名单', hint: '逗号分隔用户 ID，留空允许所有人', placeholder: '留空允许所有人', optional: true },
      ]},
      feishu: { name: '飞书', icon: '🐦', postInstall: null, guide: 'https://open.feishu.cn/', vars: [
        { key: 'FEISHU_APP_ID', label: 'App ID', hint: '飞书开放平台 → 创建企业自建应用 → 凭证与基础信息 → App ID', placeholder: 'cli_xxxxxxxxxx' },
        { key: 'FEISHU_APP_SECRET', label: 'App Secret', hint: '飞书开放平台 → 同上页面 → App Secret', placeholder: '' },
      ]},
      dingtalk: { name: '钉钉', icon: '📌', postInstall: null, guide: 'https://open.dingtalk.com/', vars: [
        { key: 'DINGTALK_APP_KEY', label: 'AppKey', hint: '钉钉开放平台 → 创建企业内部应用 → 凭证与基础信息', placeholder: '' },
        { key: 'DINGTALK_APP_SECRET', label: 'AppSecret', hint: '同上页面', placeholder: '' },
        { key: 'DINGTALK_ROBOT_CODE', label: 'Robot Code', hint: '钉钉开放平台 → 应用能力 → 机器人 → Robot Code', placeholder: '' },
      ]},
      telegram: { name: 'Telegram', icon: '✈️', postInstall: null, guide: 'https://t.me/BotFather', vars: [
        { key: 'TELEGRAM_BOT_TOKEN', label: 'Bot Token', hint: 'Telegram 搜索 @BotFather → 发送 /newbot → 按提示创建 → 复制 Token', placeholder: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11' },
      ]},
      slack: { name: 'Slack', icon: '💬', postInstall: 'npm install @slack/bolt', guide: 'https://api.slack.com/apps', vars: [
        { key: 'SLACK_BOT_TOKEN', label: 'Bot Token', hint: 'api.slack.com → 你的App → OAuth & Permissions → Install to Workspace → Bot User OAuth Token', placeholder: 'xoxb-...' },
        { key: 'SLACK_APP_TOKEN', label: 'App Token', hint: '你的App → Basic Information → App-Level Tokens → Generate (scope: connections:write)', placeholder: 'xapp-...' },
        { key: 'SLACK_SIGNING_SECRET', label: 'Signing Secret', hint: '你的App → Basic Information → Signing Secret', placeholder: '' },
      ]},
      discord: { name: 'Discord', icon: '🎮', postInstall: 'npm install discord.js', guide: 'https://discord.com/developers/applications', vars: [
        { key: 'DISCORD_BOT_TOKEN', label: 'Bot Token', hint: 'Developer Portal → 你的App → Bot → Token（需要开启 Message Content Intent）', placeholder: '' },
      ]},
      line: { name: 'LINE', icon: '🟢', postInstall: null, guide: 'https://developers.line.biz/', vars: [
        { key: 'LINE_CHANNEL_ACCESS_TOKEN', label: 'Channel Access Token', hint: 'LINE Developers → 你的Channel → Messaging API → Channel Access Token → Issue', placeholder: '' },
        { key: 'LINE_CHANNEL_SECRET', label: 'Channel Secret', hint: 'LINE Developers → 你的Channel → Basic settings → Channel Secret', placeholder: '' },
      ]},
      whatsapp: { name: 'WhatsApp', icon: '📞', postInstall: null, guide: 'https://business.facebook.com/', vars: [
        { key: 'WHATSAPP_ACCESS_TOKEN', label: 'Access Token', hint: 'Meta Business Suite → 你的App → WhatsApp → API Setup → Temporary/Permanent token', placeholder: '' },
        { key: 'WHATSAPP_PHONE_NUMBER_ID', label: 'Phone Number ID', hint: 'Meta Business Suite → WhatsApp → API Setup → Phone number ID', placeholder: '' },
        { key: 'WHATSAPP_VERIFY_TOKEN', label: 'Webhook Verify Token', hint: '自定义字符串，用于 Meta 验证你的 Webhook（随便填，但要和 Meta 后台一致）', placeholder: 'your_custom_token' },
      ]},
      signal: { name: 'Signal', icon: '🔒', postInstall: null, guide: 'https://github.com/AsamK/signal-cli', vars: [
        { key: 'SIGNAL_API_URL', label: 'REST API 地址', hint: 'signal-cli-rest-api 服务地址，部署后填写', placeholder: 'http://localhost:8080', default: 'http://localhost:8080' },
        { key: 'SIGNAL_NUMBER', label: 'Signal 号码', hint: '注册 signal-cli 时使用的手机号', placeholder: '+8613800138000' },
      ]},
      matrix: { name: 'Matrix', icon: '🔮', postInstall: null, guide: 'https://matrix.org', vars: [
        { key: 'MATRIX_HOMESERVER', label: 'Homeserver', hint: 'Matrix 服务器地址', placeholder: 'https://matrix.org', default: 'https://matrix.org' },
        { key: 'MATRIX_ACCESS_TOKEN', label: 'Access Token', hint: '通过 POST /_matrix/client/v3/login API 获取', placeholder: '' },
        { key: 'MATRIX_USER_ID', label: 'User ID', hint: 'Matrix 用户ID格式: @username:server', placeholder: '@bot:matrix.org' },
      ]},
      teams: { name: 'Microsoft Teams', icon: '🟦', postInstall: 'npm install botbuilder', guide: 'https://portal.azure.com/', vars: [
        { key: 'TEAMS_APP_ID', label: 'App ID', hint: 'Azure Portal → Bot Channels Registration → Overview → Application ID', placeholder: '' },
        { key: 'TEAMS_APP_PASSWORD', label: 'App Password', hint: 'Azure Portal → Bot → Certificates & Secrets → New client secret', placeholder: '' },
      ]},
      googlechat: { name: 'Google Chat', icon: '🔵', postInstall: 'npm install googleapis', guide: 'https://console.cloud.google.com/', vars: [
        { key: 'GOOGLECHAT_CREDENTIALS', label: 'Service Account JSON', hint: 'Google Cloud Console → IAM → Service Accounts → 创建 → Keys → JSON → 下载文件路径', placeholder: '/root/googlechat-sa.json' },
        { key: 'GOOGLECHAT_PROJECT_ID', label: 'Project ID', hint: 'Google Cloud Console → 项目选择器 → 项目ID', placeholder: '' },
      ]},
    };
  }

  _readEnv() {
    try {
      return fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8');
    } catch { return ''; }
  }

  _writeEnv(content) {
    fs.writeFileSync(path.join(process.cwd(), '.env'), content, 'utf8');
  }

  _getEnvVar(content, key) {
    const m = content.match(new RegExp(`^${key}=(.*)$`, 'm'));
    return m ? m[1] : '';
  }

  _setEnvVar(content, key, value) {
    const regex = new RegExp(`^${key}=.*$`, 'm');
    if (regex.test(content)) return content.replace(regex, `${key}=${value}`);
    return content.trim() + `\n${key}=${value}\n`;
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

import { BaseAdapter } from './base.js';

/**
 * Google Chat 适配器
 * 使用 Google Chat API + Webhook
 */
export class GoogleChatAdapter extends BaseAdapter {
  constructor(config) {
    super('googlechat', config);
    this.credentials = config.credentials; // service account JSON 路径
    this.projectId = config.projectId;
  }

  async start() {
    console.log('[GoogleChat] 启动 Google Chat 适配器...');
    if (!this.credentials) throw new Error('未配置 credentials');
    this.connected = true;
    console.log('[GoogleChat] ✅ Google Chat 适配器就绪（需注册 Webhook 路由）');
  }

  registerRoutes(app) {
    app.post('/googlechat/webhook', async (req, res) => {
      const event = req.body;

      // 验证请求
      if (event.type === 'MESSAGE') {
        const text = event.message?.text || '';
        const userId = event.user?.name || event.user?.displayName || 'unknown';
        const spaceName = event.space?.name;

        console.log(`[GoogleChat] 收到消息: ${text.substring(0, 50)}...`);
        if (this.messageHandler) {
          this.messageHandler({
            platform: 'googlechat',
            userId,
            userName: event.user?.displayName || userId,
            content: text,
            messageId: event.message?.name,
            reply: async (content) => {
              res.json({ text: content });
            },
            send: async (content) => {
              await this._send(spaceName, content);
            },
            sendStatus: async (status) => {
              res.json({ text: `⏳ ${status}` });
            },
          });
        }
      } else if (event.type === 'ADDED_TO_SPACE') {
        res.json({ text: '👋 你好！我是 Claude AI 助手，直接发消息给我即可对话。' });
      } else {
        res.json({});
      }
    });
    console.log('[GoogleChat] ✅ Webhook 路由已注册 (/googlechat/webhook)');
  }

  async _send(spaceName, text) {
    // 使用 service account 认证发送消息
    try {
      const { google } = await import('googleapis');
      const auth = new google.auth.GoogleAuth({
        keyFile: this.credentials,
        scopes: ['https://www.googleapis.com/auth/chat.bot'],
      });
      const chat = google.chat({ version: 'v1', auth });
      await chat.spaces.messages.create({
        parent: spaceName,
        requestBody: { text },
      });
    } catch (err) {
      console.error('[GoogleChat] 发送失败:', err.message);
    }
  }

  async sendMessage(userId, content) {
    await this._send(userId, content);
  }

  async stop() { this.connected = false; }

  _getConfigSummary() {
    return { projectId: this.projectId || '未配置' };
  }
}

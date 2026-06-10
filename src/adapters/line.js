import { BaseAdapter } from './base.js';

/**
 * LINE 适配器
 * 使用 LINE Messaging API + Webhook
 */
export class LineAdapter extends BaseAdapter {
  constructor(config) {
    super('line', config);
    this.channelAccessToken = config.channelAccessToken;
    this.channelSecret = config.channelSecret;
  }

  async start() {
    console.log('[LINE] 启动 LINE 适配器...');
    if (!this.channelAccessToken) throw new Error('未配置 channelAccessToken');
    this.connected = true;
    console.log('[LINE] ✅ LINE 适配器就绪（需注册 Webhook 路由）');
  }

  /**
   * 注册 Express 路由
   */
  registerRoutes(app) {
    app.post('/line/webhook', async (req, res) => {
      res.status(200).send('OK');
      const events = req.body.events || [];
      for (const event of events) {
        if (event.type !== 'message' || event.message.type !== 'text') continue;
        const userId = event.source.userId;
        const text = event.message.text;
        const replyToken = event.replyToken;

        console.log(`[LINE] 收到消息: ${text.substring(0, 50)}...`);
        if (this.messageHandler) {
          this.messageHandler({
            platform: 'line',
            userId,
            userName: userId,
            content: text,
            messageId: event.message.id,
            reply: async (content) => await this._reply(replyToken, content),
            send: async (content) => await this._push(userId, content),
            sendStatus: async (status) => await this._reply(replyToken, `⏳ ${status}`),
          });
        }
      }
    });
    console.log('[LINE] ✅ Webhook 路由已注册 (/line/webhook)');
  }

  async _reply(replyToken, text) {
    await fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.channelAccessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ replyToken, messages: [{ type: 'text', text: text.substring(0, 5000) }] }),
    });
  }

  async _push(userId, text) {
    await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.channelAccessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: userId, messages: [{ type: 'text', text: text.substring(0, 5000) }] }),
    });
  }

  async sendMessage(userId, content) {
    await this._push(userId, content);
  }

  async stop() { this.connected = false; }

  _getConfigSummary() {
    return { hasToken: !!this.channelAccessToken };
  }
}

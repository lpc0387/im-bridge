import { BaseAdapter } from './base.js';

/**
 * WhatsApp 适配器
 * 使用 WhatsApp Cloud API (Meta Business)
 */
export class WhatsAppAdapter extends BaseAdapter {
  constructor(config) {
    super('whatsapp', config);
    this.accessToken = config.accessToken;       // 永久 token
    this.phoneNumberId = config.phoneNumberId;   // 电话号码 ID
    this.verifyToken = config.verifyToken;       // Webhook 验证 token
  }

  async start() {
    console.log('[WhatsApp] 启动 WhatsApp 适配器...');
    if (!this.accessToken || !this.phoneNumberId) throw new Error('未配置 accessToken 或 phoneNumberId');
    this.connected = true;
    console.log('[WhatsApp] ✅ WhatsApp 适配器就绪（需注册 Webhook 路由）');
  }

  registerRoutes(app) {
    // Webhook 验证
    app.get('/whatsapp/webhook', (req, res) => {
      const mode = req.query['hub.mode'];
      const token = req.query['hub.verify_token'];
      const challenge = req.query['hub.challenge'];
      if (mode === 'subscribe' && token === this.verifyToken) {
        console.log('[WhatsApp] ✅ Webhook 验证成功');
        res.status(200).send(challenge);
      } else {
        res.sendStatus(403);
      }
    });

    // 接收消息
    app.post('/whatsapp/webhook', async (req, res) => {
      res.status(200).send('OK');
      const entry = req.body.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;
      const messages = value?.messages;
      if (!messages?.length) return;

      const msg = messages[0];
      if (msg.type !== 'text') return;
      const userId = msg.from;
      const text = msg.text.body;

      console.log(`[WhatsApp] 收到消息: ${text.substring(0, 50)}...`);
      if (this.messageHandler) {
        this.messageHandler({
          platform: 'whatsapp',
          userId,
          userName: value.contacts?.[0]?.profile?.name || userId,
          content: text,
          messageId: msg.id,
          reply: async (content) => await this._send(userId, content, msg.id),
          send: async (content) => await this._send(userId, content),
          sendStatus: async (status) => await this._send(userId, `⏳ ${status}`, msg.id),
        });
      }
    });
    console.log('[WhatsApp] ✅ Webhook 路由已注册 (/whatsapp/webhook)');
  }

  async _send(to, text, replyTo) {
    const body = {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text.substring(0, 4096) },
    };
    if (replyTo) body.context = { message_id: replyTo };

    await fetch(`https://graph.facebook.com/v18.0/${this.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async sendMessage(userId, content) {
    await this._send(userId, content);
  }

  async stop() { this.connected = false; }

  _getConfigSummary() {
    return { phoneNumberId: this.phoneNumberId ? '***' : '未配置' };
  }
}

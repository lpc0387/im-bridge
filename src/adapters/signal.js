import { BaseAdapter } from './base.js';

/**
 * Signal 适配器
 * 通过 signal-cli-rest-api 或 signal-cli 的 JSON-RPC 模式
 */
export class SignalAdapter extends BaseAdapter {
  constructor(config) {
    super('signal', config);
    this.apiUrl = config.apiUrl;       // signal-cli-rest-api 地址，如 http://localhost:8080
    this.number = config.number;       // Signal 号码
    this.pollInterval = null;
  }

  async start() {
    console.log('[Signal] 启动 Signal 适配器...');
    if (!this.apiUrl || !this.number) throw new Error('未配置 apiUrl 或 number');

    // 轮询接收消息
    this.connected = true;
    this._startPolling();
    console.log('[Signal] ✅ Signal 适配器已启动');
  }

  _startPolling() {
    this.pollInterval = setInterval(async () => {
      try {
        const resp = await fetch(`${this.apiUrl}/v1/receive/${this.number}?timeout=5`);
        if (!resp.ok) return;
        const messages = await resp.json();
        for (const msg of messages) {
          if (!msg.envelope?.dataMessage?.message) continue;
          const text = msg.envelope.dataMessage.message;
          const sender = msg.envelope.source;
          if (sender === this.number) continue;

          console.log(`[Signal] 收到消息: ${text.substring(0, 50)}...`);
          if (this.messageHandler) {
            this.messageHandler({
              platform: 'signal',
              userId: sender,
              userName: sender,
              content: text,
              messageId: msg.envelope.timestamp,
              reply: async (content) => await this._send(sender, content),
              send: async (content) => await this._send(sender, content),
              sendStatus: async (status) => await this._send(sender, `⏳ ${status}`),
            });
          }
        }
      } catch {}
    }, 5000);
  }

  async _send(recipient, text) {
    await fetch(`${this.apiUrl}/v2/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: this.number, recipients: [recipient], message: text }),
    });
  }

  async sendMessage(userId, content) {
    await this._send(userId, content);
  }

  async stop() {
    if (this.pollInterval) clearInterval(this.pollInterval);
    this.connected = false;
  }

  _getConfigSummary() {
    return { number: this.number ? this.number.replace(/.(?=.{4})/g, '*') : '未配置' };
  }
}

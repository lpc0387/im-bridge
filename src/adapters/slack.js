import { BaseAdapter } from './base.js';

/**
 * Slack 适配器
 * 使用 Slack Bolt 框架 + Socket Mode（无需公网 IP）
 */
export class SlackAdapter extends BaseAdapter {
  constructor(config) {
    super('slack', config);
    this.botToken = config.botToken;      // xoxb-...
    this.appToken = config.appToken;      // xapp-... (Socket Mode)
    this.signingSecret = config.signingSecret;
    this.app = null;
  }

  async start() {
    console.log('[Slack] 启动 Slack 适配器...');
    try {
      // 动态导入 slack/bolt
      const { App } = await import('@slack/bolt');
      this.app = new App({
        token: this.botToken,
        signingSecret: this.signingSecret,
        appToken: this.appToken,
        socketMode: true,
      });

      this.app.message(async ({ message, say }) => {
        if (message.bot_id || message.subtype) return;
        const text = message.text || '';
        if (!text.trim()) return;

        console.log(`[Slack] 收到消息: ${text.substring(0, 50)}...`);
        if (this.messageHandler) {
          this.messageHandler({
            platform: 'slack',
            userId: message.user,
            userName: message.user,
            content: text,
            messageId: message.ts,
            reply: async (content) => await say(content),
            send: async (content) => await say(content),
            sendStatus: async (status) => await say(`⏳ ${status}`),
          });
        }
      });

      await this.app.start();
      this.connected = true;
      console.log('[Slack] ✅ Slack 适配器已启动 (Socket Mode)');
    } catch (err) {
      console.error('[Slack] 启动失败:', err.message);
      this._lastError = err.message;
      throw err;
    }
  }

  async sendMessage(userId, content) {
    if (!this.app) throw new Error('Slack 未初始化');
    await this.app.client.chat.postMessage({
      channel: userId,
      text: content,
    });
  }

  async stop() {
    if (this.app) await this.app.stop();
    this.connected = false;
  }

  _getConfigSummary() {
    return { hasToken: !!this.botToken, mode: 'socket' };
  }
}

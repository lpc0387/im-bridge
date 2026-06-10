import { BaseAdapter } from './base.js';

/**
 * Microsoft Teams 适配器
 * 使用 Bot Framework SDK
 */
export class TeamsAdapter extends BaseAdapter {
  constructor(config) {
    super('teams', config);
    this.appId = config.appId;
    this.appPassword = config.appPassword;
    this.port = config.port || 3978;
    this.server = null;
  }

  async start() {
    console.log('[Teams] 启动 Teams 适配器...');
    if (!this.appId || !this.appPassword) throw new Error('未配置 appId 或 appPassword');

    try {
      const { BotFrameworkAdapter } = await import('botbuilder');
      const adapter = new BotFrameworkAdapter({
        appId: this.appId,
        appPassword: this.appPassword,
      });

      const handler = async (context) => {
        if (context.activity.type !== 'message') return;
        const text = context.activity.text || '';
        if (!text.trim()) return;
        const userId = context.activity.from.id;

        console.log(`[Teams] 收到消息: ${text.substring(0, 50)}...`);
        if (this.messageHandler) {
          this.messageHandler({
            platform: 'teams',
            userId,
            userName: context.activity.from.name || userId,
            content: text,
            messageId: context.activity.id,
            reply: async (content) => await context.sendActivity(content),
            send: async (content) => await context.sendActivity(content),
            sendStatus: async (status) => await context.sendActivity(`⏳ ${status}`),
          });
        }
      };

      const express = (await import('express')).default;
      const app = express();
      app.post('/api/messages', (req, res) => {
        adapter.processActivity(req, res, handler);
      });

      this.server = app.listen(this.port, () => {
        console.log(`[Teams] ✅ Teams 适配器已启动 (端口 ${this.port})`);
      });
      this.connected = true;
    } catch (err) {
      console.error('[Teams] 启动失败:', err.message);
      throw err;
    }
  }

  async sendMessage(userId, content) {
    // Teams 通过 Bot Framework 发送，需要 conversation reference
    console.log('[Teams] sendMessage 需要 conversation reference');
  }

  async stop() {
    if (this.server) this.server.close();
    this.connected = false;
  }

  _getConfigSummary() {
    return { appId: this.appId ? '***' : '未配置' };
  }
}

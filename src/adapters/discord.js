import { BaseAdapter } from './base.js';

/**
 * Discord 适配器
 * 使用 discord.js 库
 */
export class DiscordAdapter extends BaseAdapter {
  constructor(config) {
    super('discord', config);
    this.token = config.token;
    this.client = null;
  }

  async start() {
    console.log('[Discord] 启动 Discord 适配器...');
    try {
      const { Client, GatewayIntentBits } = await import('discord.js');
      this.client = new Client({
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages],
      });

      this.client.on('messageCreate', async (message) => {
        if (message.author.bot) return;
        const text = message.content;
        if (!text.trim()) return;

        console.log(`[Discord] 收到消息: ${text.substring(0, 50)}...`);
        if (this.messageHandler) {
          this.messageHandler({
            platform: 'discord',
            userId: message.author.id,
            userName: message.author.username,
            content: text,
            messageId: message.id,
            reply: async (content) => {
              const chunks = this.splitMessage(content, 1900);
              for (const chunk of chunks) await message.reply(chunk);
            },
            send: async (content) => {
              const chunks = this.splitMessage(content, 1900);
              for (const chunk of chunks) await message.channel.send(chunk);
            },
            sendStatus: async (status) => await message.channel.send(`⏳ ${status}`),
          });
        }
      });

      this.client.on('disconnect', () => {
        console.warn('[Discord] 连接断开');
        this.connected = false;
        this._lastError = 'WebSocket 断开';
      });
      this.client.on('error', (err) => {
        console.error('[Discord] 错误:', err.message);
        this.connected = false;
        this._lastError = err.message;
      });
      await this.client.login(this.token);
      this.connected = true;
      console.log('[Discord] ✅ Discord 适配器已启动');
    } catch (err) {
      console.error('[Discord] 启动失败:', err.message);
      this._lastError = err.message;
      throw err;
    }
  }

  async sendMessage(userId, content) {
    if (!this.client) throw new Error('Discord 未初始化');
    const user = await this.client.users.fetch(userId);
    const chunks = this.splitMessage(content, 1900);
    for (const chunk of chunks) await user.send(chunk);
  }

  async stop() {
    if (this.client) this.client.destroy();
    this.connected = false;
  }

  _getConfigSummary() {
    return { hasToken: !!this.token };
  }
}

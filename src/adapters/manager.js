import { WeChatAdapter } from './wechat.js';
import { WeixinAdapter } from './weixin.js';
import { FeishuAdapter } from './feishu.js';
import { DingTalkAdapter } from './dingtalk.js';
import { TelegramAdapter } from './telegram.js';
import { SlackAdapter } from './slack.js';
import { DiscordAdapter } from './discord.js';
import { LineAdapter } from './line.js';
import { WhatsAppAdapter } from './whatsapp.js';
import { SignalAdapter } from './signal.js';
import { MatrixAdapter } from './matrix.js';
import { TeamsAdapter } from './teams.js';
import { GoogleChatAdapter } from './googlechat.js';

/**
 * 适配器管理器
 */
export class AdapterManager {
  constructor() {
    this.adapters = new Map();
    this.messageHandler = null;
  }

  onMessage(handler) {
    this.messageHandler = handler;
    for (const adapter of this.adapters.values()) {
      adapter.onMessage(handler);
    }
  }

  register(name, adapter) {
    adapter.onMessage(this.messageHandler);
    this.adapters.set(name, adapter);
    console.log(`[AdapterManager] 注册适配器: ${name}`);
  }

  registerWeChat(config) {
    if (!config.corpId || !config.corpSecret) return;
    this.register('wechat', new WeChatAdapter(config));
  }

  registerWeixin(config) {
    if (!config.token) return;
    this.register('weixin', new WeixinAdapter(config));
  }

  registerFeishu(config) {
    if (!config.appId || !config.appSecret) return;
    this.register('feishu', new FeishuAdapter(config));
  }

  registerDingTalk(config) {
    if (!config.appKey || !config.appSecret) return;
    this.register('dingtalk', new DingTalkAdapter(config));
  }

  registerTelegram(config) {
    if (!config.token) return;
    this.register('telegram', new TelegramAdapter(config));
  }

  registerSlack(config) {
    if (!config.botToken) return;
    this.register('slack', new SlackAdapter(config));
  }

  registerDiscord(config) {
    if (!config.token) return;
    this.register('discord', new DiscordAdapter(config));
  }

  registerLine(config) {
    if (!config.channelAccessToken) return;
    this.register('line', new LineAdapter(config));
  }

  registerWhatsApp(config) {
    if (!config.accessToken || !config.phoneNumberId) return;
    this.register('whatsapp', new WhatsAppAdapter(config));
  }

  registerSignal(config) {
    if (!config.apiUrl || !config.number) return;
    this.register('signal', new SignalAdapter(config));
  }

  registerMatrix(config) {
    if (!config.homeserver || !config.accessToken) return;
    this.register('matrix', new MatrixAdapter(config));
  }

  registerTeams(config) {
    if (!config.appId || !config.appPassword) return;
    this.register('teams', new TeamsAdapter(config));
  }

  registerGoogleChat(config) {
    if (!config.credentials) return;
    this.register('googlechat', new GoogleChatAdapter(config));
  }

  /**
   * 获取需要注册 Webhook 路由的适配器
   */
  getWebhookAdapters() {
    const webhookAdapters = [];
    for (const [name, adapter] of this.adapters) {
      if (typeof adapter.registerRoutes === 'function') {
        webhookAdapters.push(adapter);
      }
    }
    return webhookAdapters;
  }

  async startAll() {
    console.log(`[AdapterManager] 启动 ${this.adapters.size} 个适配器...`);
    const results = [];
    for (const [name, adapter] of this.adapters) {
      try {
        console.log(`[AdapterManager] 启动 ${name}...`);
        await adapter.start();
        results.push({ name, success: true });
      } catch (err) {
        console.error(`[AdapterManager] 启动 ${name} 失败:`, err.message);
        results.push({ name, success: false, error: err.message });
      }
    }
    return results;
  }

  async stopAll() {
    for (const [, adapter] of this.adapters) {
      try { await adapter.stop(); } catch {}
    }
  }

  getStatus() {
    const status = [];
    for (const [, adapter] of this.adapters) {
      status.push(adapter.getStatus());
    }
    return status;
  }

  getAdapter(name) {
    return this.adapters.get(name);
  }

  async sendMessage(platform, userId, content, options = {}) {
    const adapter = this.adapters.get(platform);
    if (!adapter) throw new Error(`未找到适配器: ${platform}`);
    return await adapter.sendMessage(userId, content, options);
  }
}

import { FeishuAdapter } from './feishu.js';
import { DingTalkAdapter } from './dingtalk.js';
import { TelegramAdapter } from './telegram.js';
import { WeChatAdapter } from './wechat.js';

/**
 * 适配器管理器
 * 统一管理所有 IM 平台适配器
 */
export class AdapterManager {
  constructor() {
    this.adapters = new Map(); // name -> adapter
    this.messageHandler = null;
  }

  /**
   * 设置全局消息处理器
   */
  onMessage(handler) {
    this.messageHandler = handler;
    
    // 为所有已注册的适配器设置处理器
    for (const adapter of this.adapters.values()) {
      adapter.onMessage(handler);
    }
  }

  /**
   * 注册适配器
   */
  register(name, adapter) {
    adapter.onMessage(this.messageHandler);
    this.adapters.set(name, adapter);
    console.log(`[AdapterManager] 注册适配器: ${name}`);
  }

  /**
   * 创建并注册飞书适配器
   */
  registerFeishu(config) {
    if (!config.appId || !config.appSecret) {
      console.log('[AdapterManager] 飞书配置不完整，跳过');
      return;
    }
    const adapter = new FeishuAdapter(config);
    this.register('feishu', adapter);
    return adapter;
  }

  /**
   * 创建并注册钉钉适配器
   */
  registerDingTalk(config) {
    if (!config.appKey || !config.appSecret || !config.robotCode) {
      console.log('[AdapterManager] 钉钉配置不完整，跳过');
      return;
    }
    const adapter = new DingTalkAdapter(config);
    this.register('dingtalk', adapter);
    return adapter;
  }

  /**
   * 创建并注册 Telegram 适配器
   */
  registerTelegram(config) {
    if (!config.token) {
      console.log('[AdapterManager] Telegram 配置不完整，跳过');
      return;
    }
    const adapter = new TelegramAdapter(config);
    this.register('telegram', adapter);
    return adapter;
  }

  /**
   * 创建并注册企业微信适配器
   */
  registerWeChat(config) {
    if (!config.corpId || !config.corpSecret || !config.agentId) {
      console.log('[AdapterManager] 企业微信配置不完整，跳过');
      return;
    }
    const adapter = new WeChatAdapter(config);
    this.register('wechat', adapter);
    return adapter;
  }

  /**
   * 启动所有适配器
   */
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

  /**
   * 停止所有适配器
   */
  async stopAll() {
    console.log(`[AdapterManager] 停止 ${this.adapters.size} 个适配器...`);
    
    for (const [name, adapter] of this.adapters) {
      try {
        await adapter.stop();
      } catch (err) {
        console.error(`[AdapterManager] 停止 ${name} 失败:`, err.message);
      }
    }
  }

  /**
   * 获取所有适配器状态
   */
  getStatus() {
    const status = [];
    for (const [name, adapter] of this.adapters) {
      status.push(adapter.getStatus());
    }
    return status;
  }

  /**
   * 获取指定适配器
   */
  getAdapter(name) {
    return this.adapters.get(name);
  }

  /**
   * 发送消息到指定平台
   */
  async sendMessage(platform, userId, content, options = {}) {
    const adapter = this.adapters.get(platform);
    if (!adapter) {
      throw new Error(`未找到适配器: ${platform}`);
    }
    return await adapter.sendMessage(userId, content, options);
  }
}

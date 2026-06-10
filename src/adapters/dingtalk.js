import crypto from 'crypto';
import { BaseAdapter } from './base.js';

/**
 * 钉钉适配器 - Stream 模式
 * 无需公网 IP，无需隧道
 */
export class DingTalkAdapter extends BaseAdapter {
  constructor(config) {
    super('dingtalk', config);
    this.appKey = config.appKey;
    this.appSecret = config.appSecret;
    this.robotCode = config.robotCode;
    this.accessToken = null;
    this.tokenExpireAt = 0;
    this.connectionId = null;
    this.reconnectTimer = null;
    this.reconnectDelay = 1000;
    this.maxReconnectDelay = 30000;
    this.pollTimer = null;
  }

  /**
   * 获取 access_token
   */
  async getAccessToken() {
    if (this.accessToken && Date.now() < this.tokenExpireAt) {
      return this.accessToken;
    }

    const resp = await fetch('https://api.dingtalk.com/v1.0/oauth2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appKey: this.appKey,
        appSecret: this.appSecret,
      }),
    });

    const data = await resp.json();
    if (!data.accessToken) {
      throw new Error(`获取钉钉 token 失败: ${data.message}`);
    }

    this.accessToken = data.accessToken;
    this.tokenExpireAt = Date.now() + (data.expireIn - 300) * 1000;
    return this.accessToken;
  }

  /**
   * 建立 Stream 连接
   */
  async connectStream() {
    const token = await this.getAccessToken();

    // 获取连接 URL
    const resp = await fetch('https://api.dingtalk.com/v1.0/gateway/connections/open', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-acs-dingtalk-access-token': token,
      },
      body: JSON.stringify({
        clientId: this.appKey,
        clientSecret: this.appSecret,
        ua: 'im-bridge/1.0',
      }),
    });

    const data = await resp.json();
    if (!data.endpoint) {
      throw new Error(`获取钉钉连接地址失败: ${data.message}`);
    }

    console.log('[DingTalk] 建立 Stream 连接...');
    this.connectionId = data.connectionId;
    
    // 钉钉使用 HTTP 长轮询模拟 Stream
    await this.startPolling(data.endpoint, data.ticket);
  }

  /**
   * 启动长轮询
   */
  async startPolling(endpoint, ticket) {
    const poll = async () => {
      try {
        const resp = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            connectionId: this.connectionId,
            ticket: ticket,
          }),
        });

        const data = await resp.json();
        
        if (data.events) {
          for (const event of data.events) {
            this.handleEvent(event);
          }
        }

        this.connected = true;
        this.reconnectDelay = 1000;

        // 继续轮询
        this.pollTimer = setTimeout(poll, 100);
      } catch (err) {
        console.error('[DingTalk] 轮询错误:', err.message);
        this.connected = false;
        this.scheduleReconnect();
      }
    };

    await poll();
  }

  /**
   * 处理事件
   */
  handleEvent(event) {
    const { type, data } = event;

    if (type === 'message') {
      try {
        const message = JSON.parse(data);
        const userId = message.senderStaffId || message.senderId;
        const content = message.text?.content || message.content;

        console.log(`[DingTalk] 收到消息: ${content.substring(0, 50)}...`);

        if (this.messageHandler) {
          this.messageHandler({
            platform: 'dingtalk',
            userId,
            userName: message.senderNick || userId,
            content: content.trim(),
            messageId: message.msgId,
            conversationId: message.conversationId,
            conversationType: message.conversationType, // 1: 单聊, 2: 群聊
            reply: async (content, options) => {
              await this.sendMessage(userId, content, { ...options, conversationId: message.conversationId });
            },
            send: async (content, options) => {
              await this.sendMessage(userId, content, options);
            },
            sendStatus: async (status) => {
              await this.sendMessage(userId, `⏳ ${status}`, { conversationId: message.conversationId });
            },
          });
        }
      } catch (err) {
        console.error('[DingTalk] 处理消息失败:', err.message);
      }
    }
  }

  /**
   * 发送消息
   */
  async sendMessage(userId, content, options = {}) {
    const token = await this.getAccessToken();
    const { msgType = 'text', conversationId, conversationType = '1' } = options;

    let body;
    if (conversationType === '1') {
      // 单聊
      body = {
        robotCode: this.robotCode,
        userIds: [userId],
        msgKey: 'sampleText',
        msgParam: JSON.stringify({ content }),
      };
    } else {
      // 群聊
      body = {
        robotCode: this.robotCode,
        openConversationId: conversationId,
        msgKey: 'sampleText',
        msgParam: JSON.stringify({ content }),
      };
    }

    const resp = await fetch('https://api.dingtalk.com/v1.0/robot/groupMessages/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-acs-dingtalk-access-token': token,
      },
      body: JSON.stringify(body),
    });

    const data = await resp.json();
    if (!data.processQueryKey) {
      console.error(`[DingTalk] 发送消息失败: ${data.message}`);
      throw new Error(`钉钉发送失败: ${data.message}`);
    }

    return data;
  }

  /**
   * 安排重连
   */
  scheduleReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    console.log(`[DingTalk] ${this.reconnectDelay / 1000} 秒后重连...`);
    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connectStream();
      } catch (err) {
        console.error('[DingTalk] 重连失败:', err.message);
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
      }
    }, this.reconnectDelay);
  }

  /**
   * 启动适配器
   */
  async start() {
    console.log('[DingTalk] 启动钉钉适配器...');
    await this.connectStream();
  }

  /**
   * 停止适配器
   */
  async stop() {
    console.log('[DingTalk] 停止钉钉适配器...');
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    this.connected = false;
  }

  /**
   * 获取配置摘要
   */
  _getConfigSummary() {
    return {
      appKey: this.appKey ? `${this.appKey.substring(0, 8)}...` : '未配置',
      robotCode: this.robotCode ? `${this.robotCode.substring(0, 8)}...` : '未配置',
    };
  }
}

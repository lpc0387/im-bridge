import WebSocket from 'ws';
import { BaseAdapter } from './base.js';

/**
 * 飞书适配器 - WebSocket 长连接模式
 * 无需公网 IP，无需隧道
 */
export class FeishuAdapter extends BaseAdapter {
  constructor(config) {
    super('feishu', config);
    this.appId = config.appId;
    this.appSecret = config.appSecret;
    this.ws = null;
    this.accessToken = null;
    this.tokenExpireAt = 0;
    this.heartbeatTimer = null;
    this.reconnectTimer = null;
    this.reconnectDelay = 1000;
    this.maxReconnectDelay = 30000;
  }

  /**
   * 获取 tenant_access_token
   */
  async getAccessToken() {
    if (this.accessToken && Date.now() < this.tokenExpireAt) {
      return this.accessToken;
    }

    const resp = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_id: this.appId,
        app_secret: this.appSecret,
      }),
    });

    const data = await resp.json();
    if (data.code !== 0) {
      throw new Error(`获取飞书 token 失败: ${data.msg}`);
    }

    this.accessToken = data.tenant_access_token;
    this.tokenExpireAt = Date.now() + (data.expire - 300) * 1000;
    return this.accessToken;
  }

  /**
   * 发送消息
   */
  async sendMessage(userId, content, options = {}) {
    const { msgType = 'text' } = options;
    if (msgType === 'text') {
      const chunks = this.splitMessage(content, 30000);
      for (const chunk of chunks) {
        await this._sendSingle(userId, chunk, options);
      }
    } else {
      await this._sendSingle(userId, content, options);
    }
  }

  async _sendSingle(userId, content, options = {}) {
    const token = await this.getAccessToken();
    const { msgType = 'text', receiveIdType = 'open_id' } = options;

    let body;
    if (msgType === 'text') {
      body = {
        receive_id: userId,
        msg_type: 'text',
        content: JSON.stringify({ text: content }),
      };
    } else if (msgType === 'interactive') {
      body = {
        receive_id: userId,
        msg_type: 'interactive',
        content: typeof content === 'string' ? content : JSON.stringify(content),
      };
    } else {
      body = {
        receive_id: userId,
        msg_type: msgType,
        content: typeof content === 'string' ? content : JSON.stringify(content),
      };
    }

    const resp = await fetch(`https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    const data = await resp.json();
    if (data.code !== 0) {
      console.error(`[Feishu] 发送消息失败: ${data.msg}`);
      throw new Error(`飞书发送失败: ${data.msg}`);
    }

    return data;
  }

  /**
   * 回复消息
   */
  async replyMessage(messageId, content, options = {}) {
    const { msgType = 'text' } = options;
    if (msgType === 'text') {
      const chunks = this.splitMessage(content, 30000);
      for (const chunk of chunks) {
        await this._replySingle(messageId, chunk, options);
      }
    } else {
      await this._replySingle(messageId, content, options);
    }
  }

  async _replySingle(messageId, content, options = {}) {
    const token = await this.getAccessToken();
    const { msgType = 'text' } = options;

    const resp = await fetch(`https://open.feishu.cn/open-apis/im/v1/messages/${messageId}/reply`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        msg_type: msgType,
        content: JSON.stringify({ text: content }),
      }),
    });

    const data = await resp.json();
    if (data.code !== 0) {
      console.error(`[Feishu] 回复消息失败: ${data.msg}`);
    }
    return data;
  }

  /**
   * 连接 WebSocket
   */
  async connectWebSocket() {
    return new Promise((resolve, reject) => {
      // 获取 WebSocket 连接地址
      this.getAccessToken().then(token => {
        // 使用长连接接收事件
        const wsUrl = `wss://msg-frontier.feishu.cn/ws/v2?token=${token}`;
        
        console.log(`[Feishu] 连接 WebSocket: ${wsUrl.substring(0, 50)}...`);
        this.ws = new WebSocket(wsUrl);

        this.ws.on('open', () => {
          console.log('[Feishu] ✅ WebSocket 连接成功');
          this.connected = true;
          this.reconnectDelay = 1000;
          this.startHeartbeat();
          resolve();
        });

        this.ws.on('message', (data) => {
          try {
            const msg = JSON.parse(data.toString());
            this.handleMessage(msg);
          } catch (err) {
            console.error('[Feishu] 解析消息失败:', err.message);
          }
        });

        this.ws.on('close', (code, reason) => {
          console.log(`[Feishu] WebSocket 关闭: ${code} ${reason}`);
          this.connected = false;
          this.stopHeartbeat();
          this.scheduleReconnect();
        });

        this.ws.on('error', (err) => {
          console.error('[Feishu] WebSocket 错误:', err.message);
          if (!this.connected) {
            reject(err);
          }
        });
      }).catch(reject);
    });
  }

  /**
   * 处理接收到的消息
   */
  handleMessage(msg) {
    // 处理心跳响应
    if (msg.type === 'pong') {
      return;
    }

    // 处理事件消息
    if (msg.header && msg.event) {
      const eventType = msg.header.event_type;
      
      if (eventType === 'im.message.receive_v1') {
        const event = msg.event;
        const message = event.message;
        const sender = event.sender;

        // 只处理文本消息
        if (message.message_type === 'text') {
          try {
            const content = JSON.parse(message.content);
            const userId = sender.sender_id.open_id;
            const text = content.text;

            console.log(`[Feishu] 收到消息: ${text.substring(0, 50)}...`);

            if (this.messageHandler) {
              this.messageHandler({
                platform: 'feishu',
                userId,
                userName: sender.sender_id.name || userId,
                content: text,
                messageId: message.message_id,
                chatId: message.chat_id,
                chatType: message.chat_type, // p2p 或 group
                reply: async (content, options) => {
                  await this.replyMessage(message.message_id, content, options);
                },
                send: async (content, options) => {
                  await this.sendMessage(userId, content, options);
                },
                sendStatus: async (status) => {
                  await this.sendMessage(userId, `⏳ ${status}`);
                },
              });
            }
          } catch (err) {
            console.error('[Feishu] 处理消息失败:', err.message);
          }
        }
      }
    }
  }

  /**
   * 启动心跳
   */
  startHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, 30000);
  }

  /**
   * 停止心跳
   */
  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * 安排重连
   */
  scheduleReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    console.log(`[Feishu] ${this.reconnectDelay / 1000} 秒后重连...`);
    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connectWebSocket();
      } catch (err) {
        console.error('[Feishu] 重连失败:', err.message);
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
      }
    }, this.reconnectDelay);
  }

  /**
   * 启动适配器
   */
  async start() {
    console.log('[Feishu] 启动飞书适配器...');
    await this.connectWebSocket();
  }

  /**
   * 停止适配器
   */
  async stop() {
    console.log('[Feishu] 停止飞书适配器...');
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }

  /**
   * 获取配置摘要
   */
  _getConfigSummary() {
    return {
      appId: this.appId ? `${this.appId.substring(0, 8)}...` : '未配置',
    };
  }
}

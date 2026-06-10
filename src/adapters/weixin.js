import { BaseAdapter } from './base.js';

/**
 * 个人微信适配器（基于微信官方 iLink Bot API）
 *
 * 完整复现 cc-connect 的 weixin 实现：
 * - 扫码登录: get_bot_qrcode → get_qrcode_status
 * - 收消息: getupdates 长轮询
 * - 发消息: sendmessage + context_token
 * - 输入状态: sendtyping
 */
export class WeixinAdapter extends BaseAdapter {
  constructor(config) {
    super('weixin', config);
    this.token = config.token;
    this.baseURL = (config.baseURL || 'https://ilinkai.weixin.qq.com').replace(/\/$/, '');
    this.allowFrom = config.allowFrom || '';
    this.routeTag = config.routeTag || '';

    this.polling = false;
    this.syncBuf = '';
    this.contextTokens = {};
    this.typingTickets = {};
    this.dedup = new Map();

    this.maxChunk = 3800;
    this.chunkDelay = 100;
    this.sendRetries = 3;
    this.retryDelay = 500;
  }

  // ========== 启动 ==========

  async start() {
    console.log('[Weixin] 启动个人微信适配器...');
    if (!this.token) throw new Error('未配置 iLink Bot Token（通过 /setup 扫码获取）');

    // 验证 token
    try {
      await this._verifyToken();
      console.log('[Weixin] ✅ Token 验证通过');
    } catch (err) {
      console.error('[Weixin] ❌ Token 验证失败:', err.message);
      throw new Error('iLink Bot Token 无效，请重新扫码获取');
    }

    this.connected = true;
    this._startPolling();
    console.log('[Weixin] ✅ 个人微信适配器已启动');
  }

  // ========== 扫码登录 ==========

  /**
   * 获取二维码（供 Web UI 或 CLI 使用）
   * @returns {{ qrcode: string, url: string }}
   */
  async getQRCode(botType = '3') {
    const resp = await this._get(`ilink/bot/get_bot_qrcode?bot_type=${botType}`);
    return {
      qrcode: resp.qrcode,
      url: resp.qrcode_img_content,
    };
  }

  /**
   * 轮询扫码状态
   * @returns {{ status: string, botToken?: string, ilinkBotId?: string, ilinkUserId?: string }}
   */
  async pollQRStatus(qrKey) {
    const resp = await this._get(`ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrKey)}`, 40000);
    return {
      status: resp.status, // wait | scaned | expired | confirmed
      botToken: resp.bot_token,
      ilinkBotId: resp.ilink_bot_id,
      baseURL: resp.baseurl,
      ilinkUserId: resp.ilink_user_id,
    };
  }

  /**
   * 完整扫码流程（供 CLI 调用）
   */
  async qrLoginFlow(onStatus) {
    const maxRefresh = 3;
    let refreshCount = 0;

    while (refreshCount < maxRefresh) {
      refreshCount++;
      if (onStatus) onStatus(`获取二维码 (${refreshCount}/${maxRefresh})...`);

      const qr = await this.getQRCode();
      if (onStatus) onStatus(`请用微信扫描二维码: ${qr.url}`);

      const deadline = Date.now() + 120000; // 2 分钟超时
      let scanned = false;

      while (Date.now() < deadline) {
        const result = await this.pollQRStatus(qr.qrcode);

        if (result.status === 'confirmed') {
          if (!result.botToken) throw new Error('登录成功但未返回 bot_token');
          if (onStatus) onStatus('✅ 扫码登录成功！');
          return {
            token: result.botToken,
            baseURL: result.baseURL || this.baseURL,
            ilinkBotId: result.ilinkBotId,
            ilinkUserId: result.ilinkUserId,
          };
        }

        if (result.status === 'scaned' && !scanned) {
          scanned = true;
          if (onStatus) onStatus('已扫码，请在手机上确认登录...');
        }

        if (result.status === 'expired') {
          if (onStatus) onStatus('二维码过期，正在刷新...');
          break; // 跳出内层循环，重新获取二维码
        }

        await this._sleep(1000);
      }
    }

    throw new Error('扫码超时，请重试');
  }

  // ========== 验证 Token ==========

  async _verifyToken() {
    await this._post('ilink/bot/getupdates', {
      get_updates_buf: '',
      base_info: { channel_version: 'im-bridge-weixin/1.0' },
    }, 15000);
  }

  // ========== 长轮询 ==========

  async _startPolling() {
    this.polling = true;
    let backoff = 1000;
    const maxBackoff = 30000;

    while (this.polling) {
      try {
        const resp = await this._post('ilink/bot/getupdates', {
          get_updates_buf: this.syncBuf,
          base_info: { channel_version: 'im-bridge-weixin/1.0' },
        }, 40000);

        backoff = 1000;

        if (resp.errcode === -14) {
          console.warn('[Weixin] 会话过期，暂停 1 小时');
          await this._sleep(3600000);
          continue;
        }

        if (resp.ret !== 0) {
          console.warn(`[Weixin] getUpdates ret=${resp.ret} errmsg=${resp.errmsg}`);
        }

        const msgs = resp.msgs || [];
        for (const msg of msgs) {
          this._dispatch(msg).catch(err => {
            console.error('[Weixin] 消息处理失败:', err.message);
          });
        }

        if (resp.get_updates_buf) {
          this.syncBuf = resp.get_updates_buf;
        }
      } catch (err) {
        if (!this.polling) return;
        console.warn(`[Weixin] getUpdates 错误: ${err.message}, 退避 ${backoff}ms`);
        await this._sleep(backoff);
        backoff = Math.min(backoff * 2, maxBackoff);
      }
    }
  }

  // ========== 消息分发 ==========

  async _dispatch(msg) {
    if (msg.message_type === 2) return; // 忽略机器人消息

    const from = msg.from_user_id?.trim();
    if (!from) return;

    // 白名单
    if (this.allowFrom && !this._isAllowed(from)) return;

    // 消息去重
    const dedupKey = `${from}|${msg.message_id}|${msg.seq}|${msg.create_time_ms}|${msg.client_id || ''}`;
    if (this.dedup.has(dedupKey)) return;
    this.dedup.set(dedupKey, Date.now());
    for (const [k, ts] of this.dedup) {
      if (Date.now() - ts > 300000) this.dedup.delete(k);
    }

    // 保存 context_token
    if (msg.context_token) {
      this.contextTokens[from] = msg.context_token;
    }

    // 提取文本
    const items = msg.item_list || [];
    let text = '';
    for (const item of items) {
      if (item.type === 1 && item.text_item?.text) {
        text += item.text_item.text;
      }
    }
    if (!text.trim()) return;

    console.log(`[Weixin] 收到 ${from}: ${text.substring(0, 50)}...`);

    if (this.messageHandler) {
      this.messageHandler({
        platform: 'weixin',
        userId: from,
        userName: from,
        content: text.trim(),
        messageId: String(msg.message_id || ''),
        reply: async (content) => await this._sendChunks(from, content, msg.context_token),
        send: async (content) => await this._sendChunks(from, content, msg.context_token),
        sendStatus: async (status) => await this._sendText(from, `⏳ ${status}`, msg.context_token),
      });
    }
  }

  // ========== 发送消息 ==========

  async _sendChunks(to, content, contextToken) {
    if (!contextToken) contextToken = this.contextTokens[to];
    if (!contextToken) {
      console.error(`[Weixin] 缺少 context_token，用户 ${to} 需要先发一条消息`);
      return;
    }

    const chunks = this._splitText(content, this.maxChunk);
    for (let i = 0; i < chunks.length; i++) {
      if (i > 0) await this._sleep(this.chunkDelay);
      await this._sendChunkWithRetry(to, chunks[i], contextToken, i + 1, chunks.length);
    }
  }

  async _sendChunkWithRetry(to, text, contextToken, idx, total) {
    for (let attempt = 0; attempt < this.sendRetries; attempt++) {
      try {
        await this._sendText(to, text, contextToken);
        return;
      } catch (err) {
        if (err.message.includes('ret=-2')) {
          const fresh = this.contextTokens[to];
          if (fresh && fresh !== contextToken) {
            contextToken = fresh;
            await this._sleep(this.retryDelay);
            continue;
          }
          throw err;
        }
        throw err;
      }
    }
  }

  async _sendText(to, text, contextToken) {
    const clientId = `im-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    await this._post('ilink/bot/sendmessage', {
      msg: {
        from_user_id: '',
        to_user_id: to,
        client_id: clientId,
        message_type: 2,
        message_state: 2,
        item_list: [{ type: 1, text_item: { text } }],
        context_token: contextToken,
      },
      base_info: { channel_version: 'im-bridge-weixin/1.0' },
    });
  }

  // ========== 输入状态 ==========

  async _sendTyping(to, status) {
    const ticket = this.typingTickets[to];
    if (!ticket) return;
    await this._post('ilink/bot/sendtyping', {
      ilink_user_id: to,
      typing_ticket: ticket,
      status, // 1=start, 2=stop
      base_info: { channel_version: 'im-bridge-weixin/1.0' },
    }).catch(() => {});
  }

  async _refreshTypingTicket(to, contextToken) {
    try {
      const resp = await this._post('ilink/bot/getconfig', {
        user_id: to,
        context_token: contextToken,
        base_info: { channel_version: 'im-bridge-weixin/1.0' },
      });
      if (resp.typing_ticket) {
        this.typingTickets[to] = resp.typing_ticket;
      }
    } catch {}
  }

  async sendMessage(userId, content) {
    const contextToken = this.contextTokens[userId];
    if (!contextToken) throw new Error(`缺少 context_token: ${userId}`);
    await this._sendChunks(userId, content, contextToken);
  }

  // ========== HTTP 请求 ==========

  async _get(endpoint, timeout = 15000) {
    const url = `${this.baseURL}/${endpoint}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const headers = {};
      if (this.routeTag) headers['SKRouteTag'] = this.routeTag;

      const resp = await fetch(url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return await resp.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async _post(endpoint, body, timeout = 15000) {
    const url = `${this.baseURL}/${endpoint}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`,
        'AuthorizationType': 'ilink_bot_token',
        'X-WECHAT-UIN': this._randomUIN(),
      };
      if (this.routeTag) headers['SKRouteTag'] = this.routeTag;

      const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return await resp.json();
    } finally {
      clearTimeout(timer);
    }
  }

  // ========== 工具函数 ==========

  _randomUIN() {
    const b = new Uint8Array(4);
    crypto.getRandomValues(b);
    const n = (b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3];
    return btoa(String(n));
  }

  _isAllowed(userId) {
    return this.allowFrom.split(',').map(s => s.trim()).includes(userId);
  }

  _splitText(text, maxRunes) {
    const chars = [...text];
    if (chars.length <= maxRunes) return [text];
    const chunks = [];
    while (chars.length > 0) chunks.push(chars.splice(0, maxRunes).join(''));
    return chunks;
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async stop() {
    this.polling = false;
    this.connected = false;
  }

  _getConfigSummary() {
    return { baseURL: this.baseURL, hasToken: !!this.token };
  }
}

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
    this.chunkDelay = 300;   // 分片间隔 300ms（防止频率限制）
    this.sendRetries = 3;
    this.retryDelay = 1000;  // 重试间隔 1s
  }

  // ========== 启动 ==========

  async start() {
    console.log('[Weixin] 启动个人微信适配器...');
    if (!this.token) throw new Error('未配置 iLink Bot Token（通过 /setup 扫码获取）');

    // 验证 token（失败不阻断启动，让轮询自行处理）
    try {
      await this._verifyToken();
      console.log('[Weixin] ✅ Token 验证通过');
      this.connected = true;
    } catch (err) {
      console.warn('[Weixin] ⚠️ Token 验证失败，将继续尝试连接:', err.message);
      this.connected = false;
      this._lastError = `Token 验证失败: ${err.message}`;
    }

    this._startPolling();
    console.log('[Weixin] ✅ 个人微信适配器已启动（轮询模式）');
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
    let failCount = 0;
    const maxFails = 10; // 连续失败 10 次才标记离线（提高容忍度）
    const longPollTimeout = 40000;

    while (this.polling) {
      try {
        const resp = await this._post('ilink/bot/getupdates', {
          get_updates_buf: this.syncBuf,
          base_info: { channel_version: 'im-bridge-weixin/1.0' },
        }, longPollTimeout);

        // 成功响应，重置退避
        backoff = 1000;

        // 会话过期 — 永久错误，立即标记
        if (resp.errcode === -14 || resp.ret === -14) {
          console.warn('[Weixin] 会话过期，标记离线');
          this.connected = false;
          this._lastError = '会话过期，请重新扫码';
          return;
        }

        // ret 存在但不为 0，才是真正的错误
        if (resp.ret !== undefined && resp.ret !== 0) {
          failCount++;
          console.warn(`[Weixin] getUpdates 错误 (${failCount}/${maxFails}): ret=${resp.ret} errcode=${resp.errcode} errmsg=${resp.errmsg}`);

          // 频率限制 / 临时错误 — 长退避但不计入 failCount
          if (resp.ret === 45009 || resp.errcode === 45009 || resp.ret === -1) {
            console.warn('[Weixin] 频率限制或临时错误，等待 60s 后重试');
            failCount = Math.max(0, failCount - 1); // 不累积
            await this._sleep(60000);
            continue;
          }

          if (failCount >= maxFails) {
            this.connected = false;
            this._lastError = `getUpdates 错误: ret=${resp.ret} ${resp.errmsg || ''}`;
            return;
          }
          await this._sleep(backoff);
          backoff = Math.min(backoff * 2, maxBackoff);
          continue;
        }

        // 成功响应 — 重置计数
        failCount = 0;
        if (!this.connected) {
          console.log('[Weixin] ✅ 连接恢复');
        }
        this.connected = true;
        this._lastError = null;

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

        // 长轮询超时（AbortError）是正常行为，不算失败
        if (err.name === 'AbortError' || err.message?.includes('abort')) {
          failCount = 0;
          if (!this.connected) {
            console.log('[Weixin] ✅ 连接恢复（长轮询超时）');
          }
          this.connected = true;
          this._lastError = null;
          continue;
        }

        // 网络错误 — 计入失败但提高容忍度
        failCount++;
        console.warn(`[Weixin] getUpdates 错误 (${failCount}/${maxFails}): ${err.message}, 退避 ${backoff}ms`);

        if (failCount >= maxFails) {
          console.warn('[Weixin] 连续失败过多，标记离线，等待守护重连');
          this.connected = false;
          this._lastError = `连接中断: ${err.message}`;
          return;
        }

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
      // 状态累积器：合并多条状态为一条消息，节省 context_token
      let statusBuffer = [];
      let statusTimer = null;
      const flushStatus = async () => {
        if (statusBuffer.length === 0) return;
        const merged = statusBuffer.join('\n');
        statusBuffer = [];
        statusTimer = null;
        try {
          const token = this.contextTokens[from];
          if (!token) return;
          await this._sendText(from, `⏳ ${merged}`, token);
        } catch (err) {
          console.warn(`[Weixin] 状态发送失败: ${err.message}`);
        }
      };

      this.messageHandler({
        platform: 'weixin',
        userId: from,
        userName: from,
        content: text.trim(),
        messageId: String(msg.message_id || ''),
        reply: async (content) => await this._sendChunks(from, content),
        send: async (content) => await this._sendChunks(from, content),
        sendStatus: async (status) => {
          statusBuffer.push(status);
          // 5 秒内的状态合并为一条消息发送
          if (!statusTimer) {
            statusTimer = setTimeout(flushStatus, 5000);
          }
          // 如果累积超过 5 条，立即发送
          if (statusBuffer.length >= 5) {
            if (statusTimer) { clearTimeout(statusTimer); statusTimer = null; }
            await flushStatus();
          }
        },
      });
    }
  }

  // ========== 发送消息 ==========

  async _sendChunks(to, content) {
    // 始终从缓存取最新 token
    let contextToken = this.contextTokens[to];
    if (!contextToken) {
      console.error(`[Weixin] 缺少 context_token，用户 ${to} 需要先发一条消息`);
      return;
    }

    const chunks = this._splitText(content, this.maxChunk);
    for (let i = 0; i < chunks.length; i++) {
      if (i > 0) await this._sleep(this.chunkDelay);
      // 每次发送前刷新 token（可能被其他消息更新了）
      contextToken = this.contextTokens[to] || contextToken;
      try {
        await this._sendChunkWithRetry(to, chunks[i], contextToken, i + 1, chunks.length);
      } catch (err) {
        if (err.message.includes('ret=-2') || err.message.includes('context_token')) {
          console.warn(`[Weixin] context_token 过期，停止发送剩余消息`);
          this._sendText(to, '⚠️ 会话 token 过期，请发一条新消息刷新会话。', this.contextTokens[to]).catch(() => {});
          return;
        }
        throw err;
      }
    }
  }

  async _sendChunkWithRetry(to, text, contextToken, idx, total) {
    for (let attempt = 0; attempt < this.sendRetries; attempt++) {
      try {
        await this._sendText(to, text, contextToken);
        return;
      } catch (err) {
        if (err.message.includes('ret=-2')) {
          console.warn(`[Weixin] sendMessage ret=-2 (token 过期), attempt=${attempt + 1}`);
          // 尝试从缓存获取新 token
          const fresh = this.contextTokens[to];
          if (fresh && fresh !== contextToken) {
            contextToken = fresh;
            console.log(`[Weixin] 使用缓存的新 token 重试`);
            await this._sleep(this.retryDelay);
            continue;
          }
          // 没有新 token，抛出让外层处理
          throw new Error('ret=-2: context_token 过期，需要用户发新消息刷新');
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

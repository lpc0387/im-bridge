import nodeCrypto from 'crypto';
import fs from 'fs/promises';
import { BaseAdapter } from './base.js';
import { classifyDeliverableFile, getMimeType, saveIncomingFile } from '../file-delivery.js';

const MESSAGE_ITEM_TEXT = 1;
const MESSAGE_ITEM_IMAGE = 2;
const MESSAGE_ITEM_VOICE = 3;
const MESSAGE_ITEM_FILE = 4;
const MESSAGE_ITEM_VIDEO = 5;
const UPLOAD_MEDIA_IMAGE = 1;
const UPLOAD_MEDIA_VIDEO = 2;
const UPLOAD_MEDIA_FILE = 3;
const AES_BLOCK_SIZE = 16;
const MAX_WEIXIN_MEDIA_BYTES = 100 * 1024 * 1024;

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
    this.cdnBaseURL = (config.cdnBaseURL || 'https://novac2c.cdn.weixin.qq.com/c2c').replace(/\/$/, '');
    this.allowFrom = config.allowFrom || '';
    this.routeTag = config.routeTag || '';

    this.fileCapability = 'attachment';
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

    // 提取文本和文件
    const items = msg.item_list || [];
    let text = '';
    for (const item of items) {
      if (item.type === MESSAGE_ITEM_TEXT && item.text_item?.text) {
        text += item.text_item.text;
      }
      if (item.type === MESSAGE_ITEM_VOICE && item.voice_item?.text) {
        text += item.voice_item.text;
      }
    }

    const files = await this._collectInboundFiles(items);
    if (!text.trim() && files.length === 0) return;
    if (!text.trim() && files.length > 0) {
      text = `用户发送了文件: ${files.map(f => f.name).join(', ')}`;
    }

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
        files,
        messageId: String(msg.message_id || ''),
        reply: async (content) => await this._sendChunks(from, content),
        send: async (content) => await this._sendChunks(from, content),
        sendFile: async (file, options) => await this.sendFile(from, file, options),
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
    await this._sendItem(to, { type: MESSAGE_ITEM_TEXT, text_item: { text } }, contextToken);
  }

  async _sendItem(to, item, contextToken = this.contextTokens[to]) {
    if (!contextToken) throw new Error(`缺少 context_token: ${to}`);
    const clientId = `im-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const resp = await this._post('ilink/bot/sendmessage', {
      msg: {
        from_user_id: '',
        to_user_id: to,
        client_id: clientId,
        message_type: 2,
        message_state: 2,
        item_list: [item],
        context_token: contextToken,
      },
      base_info: { channel_version: 'im-bridge-weixin/1.0' },
    });
    if ((resp?.ret !== undefined && resp.ret !== 0) || (resp?.errcode !== undefined && resp.errcode !== 0)) {
      throw new Error(`微信消息发送失败: ret=${resp.ret || 0} errcode=${resp.errcode || 0} ${resp.errmsg || ''}`);
    }
    return resp;
  }

  // ========== 文件传输 ==========

  async sendFile(userId, filePath, options = {}) {
    const classified = await classifyDeliverableFile(filePath);
    if (!classified.ok) throw new Error(classified.reason);

    const file = classified.file;
    const data = await fs.readFile(file.path);
    const mediaType = this._isVideoFile(file, options) ? UPLOAD_MEDIA_VIDEO
      : this._isImageFile(file, options) ? UPLOAD_MEDIA_IMAGE
        : UPLOAD_MEDIA_FILE;
    const ref = await this._uploadToWeixinCDN(userId, data, mediaType, 'sendFile');

    const item = mediaType === UPLOAD_MEDIA_VIDEO
      ? {
          type: MESSAGE_ITEM_VIDEO,
          video_item: {
            media: this._mediaFromUploadRef(ref),
            video_size: ref.cipherSize,
          },
        }
      : mediaType === UPLOAD_MEDIA_IMAGE
        ? {
            type: MESSAGE_ITEM_IMAGE,
            image_item: {
              media: this._mediaFromUploadRef(ref),
              mid_size: ref.cipherSize,
            },
          }
        : {
            type: MESSAGE_ITEM_FILE,
            file_item: {
              media: this._mediaFromUploadRef(ref),
              file_name: options.filename || file.name,
              len: String(ref.rawSize),
            },
          };

    const result = await this._sendItem(userId, item);
    console.log(`[Weixin] 已发送文件: ${options.filename || file.name}`);
    return result;
  }

  async _collectInboundFiles(items) {
    const files = [];
    for (const item of items || []) {
      try {
        const saved = await this._downloadInboundItem(item);
        if (!saved) continue;
        const classified = await classifyDeliverableFile(saved);
        if (classified.ok) files.push(classified.file);
      } catch (err) {
        console.warn(`[Weixin] 下载用户文件失败: ${err.message}`);
      }
    }
    return files;
  }

  async _downloadInboundItem(item) {
    if (item.type === MESSAGE_ITEM_FILE && item.file_item?.media) {
      const filename = item.file_item.file_name || 'weixin-file';
      const data = await this._downloadAndDecryptCDN(item.file_item.media, 'inbound file');
      return await saveIncomingFile('weixin', filename, data);
    }
    if (item.type === MESSAGE_ITEM_IMAGE && item.image_item?.media) {
      const data = await this._downloadAndDecryptCDN(item.image_item.media, 'inbound image', item.image_item.aeskey);
      return await saveIncomingFile('weixin', `image-${Date.now()}.${this._imageExt(data)}`, data);
    }
    if (item.type === MESSAGE_ITEM_VIDEO && item.video_item?.media) {
      const data = await this._downloadAndDecryptCDN(item.video_item.media, 'inbound video');
      return await saveIncomingFile('weixin', `video-${Date.now()}.mp4`, data);
    }
    return null;
  }

  async _uploadToWeixinCDN(to, data, mediaType, label) {
    if (!data?.length) throw new Error('文件为空');
    if (data.length > MAX_WEIXIN_MEDIA_BYTES) throw new Error('文件超过微信 CDN 上传限制');

    const aesKey = nodeCrypto.randomBytes(16);
    const filekey = nodeCrypto.randomBytes(16).toString('hex');
    const uploadReq = {
      filekey,
      media_type: mediaType,
      to_user_id: to,
      rawsize: data.length,
      rawfilemd5: nodeCrypto.createHash('md5').update(data).digest('hex'),
      filesize: this._aesECBPaddedSize(data.length),
      no_need_thumb: true,
      aeskey: aesKey.toString('hex'),
      base_info: { channel_version: 'im-bridge-weixin/1.0' },
    };
    const uploadInfo = await this._post('ilink/bot/getuploadurl', uploadReq);
    if ((uploadInfo?.ret !== undefined && uploadInfo.ret !== 0) || (uploadInfo?.errcode !== undefined && uploadInfo.errcode !== 0)) {
      throw new Error(`获取微信上传地址失败: ret=${uploadInfo.ret || 0} errcode=${uploadInfo.errcode || 0} ${uploadInfo.errmsg || ''}`);
    }
    const uploadUrl = uploadInfo.upload_full_url || this._buildCdnUploadURL(uploadInfo.upload_param, filekey);
    if (!uploadUrl) throw new Error('微信未返回上传地址');

    const cipher = this._encryptAESECB(data, aesKey);
    let lastErr;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const resp = await fetch(uploadUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: cipher,
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.headers.get('x-error-message') || resp.statusText}`);
        const downloadParam = resp.headers.get('x-encrypted-param');
        if (!downloadParam) throw new Error('CDN 响应缺少 x-encrypted-param');
        return { downloadParam, aesKey, cipherSize: cipher.length, rawSize: data.length };
      } catch (err) {
        lastErr = err;
        if (attempt < 3) await this._sleep(this.retryDelay);
      }
    }
    throw new Error(`微信 CDN 上传失败: ${lastErr.message}`);
  }

  async _downloadAndDecryptCDN(media, label, aesKeyHex = '') {
    const encParam = media.encrypt_query_param;
    if (!encParam) throw new Error(`${label}: 缺少 encrypt_query_param`);
    const url = `${this.cdnBaseURL}/download?encrypted_query_param=${encodeURIComponent(encParam)}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`${label}: CDN 下载失败 HTTP ${resp.status}`);
    const data = Buffer.from(await resp.arrayBuffer());
    const aesKey = this._parseAesKey(media.aes_key, aesKeyHex, label);
    return this._decryptAESECB(data, aesKey);
  }

  _mediaFromUploadRef(ref) {
    return {
      encrypt_query_param: ref.downloadParam,
      aes_key: Buffer.from(ref.aesKey.toString('hex')).toString('base64'),
      encrypt_type: 1,
    };
  }

  _buildCdnUploadURL(uploadParam, filekey) {
    if (!uploadParam) return '';
    return `${this.cdnBaseURL}/upload?encrypted_query_param=${encodeURIComponent(uploadParam)}&filekey=${encodeURIComponent(filekey)}`;
  }

  _aesECBPaddedSize(len) {
    return (Math.floor(len / AES_BLOCK_SIZE) + 1) * AES_BLOCK_SIZE;
  }

  _encryptAESECB(data, key) {
    const cipher = nodeCrypto.createCipheriv('aes-128-ecb', key, null);
    cipher.setAutoPadding(true);
    return Buffer.concat([cipher.update(data), cipher.final()]);
  }

  _decryptAESECB(data, key) {
    const decipher = nodeCrypto.createDecipheriv('aes-128-ecb', key, null);
    decipher.setAutoPadding(true);
    return Buffer.concat([decipher.update(data), decipher.final()]);
  }

  _parseAesKey(base64Key, hexKey, label) {
    if (hexKey) {
      const raw = Buffer.from(hexKey, 'hex');
      if (raw.length === 16) return raw;
    }
    const decoded = Buffer.from(base64Key || '', 'base64');
    if (decoded.length === 16) return decoded;
    if (decoded.length === 32 && /^[0-9a-fA-F]{32}$/.test(decoded.toString('utf8'))) {
      return Buffer.from(decoded.toString('utf8'), 'hex');
    }
    throw new Error(`${label}: aes_key 格式无效`);
  }

  _isImageFile(file, options) {
    const mime = (options.mimeType || file.mimeType || getMimeType(file.path)).toLowerCase();
    return mime.startsWith('image/');
  }

  _isVideoFile(file, options) {
    const mime = (options.mimeType || file.mimeType || getMimeType(file.path)).toLowerCase();
    return mime.startsWith('video/') || ['.avi', '.m4v', '.mkv', '.mov', '.mp4', '.mpeg', '.mpg', '.webm'].includes(file.ext);
  }

  _imageExt(data) {
    if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from('\x89PNG\r\n\x1a\n', 'binary'))) return 'png';
    if (data.length >= 6 && ['GIF87a', 'GIF89a'].includes(data.subarray(0, 6).toString('binary'))) return 'gif';
    if (data.length >= 12 && data.subarray(0, 4).toString('binary') === 'RIFF' && data.subarray(8, 12).toString('binary') === 'WEBP') return 'webp';
    return 'jpg';
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

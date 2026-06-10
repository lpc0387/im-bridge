import crypto from 'crypto';
import { BaseAdapter } from './base.js';

/**
 * 企业微信适配器
 * 支持 Webhook 回调和应用消息
 */
export class WeChatAdapter extends BaseAdapter {
  constructor(config) {
    super('wecom', config);
    this.corpId = config.corpId;
    this.corpSecret = config.corpSecret;
    this.agentId = config.agentId;
    this.token = config.token;
    this.encodingAESKey = config.encodingAESKey;
    this.webhookUrl = config.webhookUrl;
    
    this.accessToken = null;
    this.tokenExpireAt = 0;
    this.crypto = null;
    
    if (this.encodingAESKey) {
      this.crypto = new WeChatCrypto(this.token, this.encodingAESKey, this.corpId);
    }
  }

  /**
   * 获取 access_token
   */
  async getAccessToken() {
    if (this.accessToken && Date.now() < this.tokenExpireAt) {
      return this.accessToken;
    }

    const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${this.corpId}&corpsecret=${this.corpSecret}`;
    const resp = await fetch(url);
    const data = await resp.json();

    if (data.errcode !== 0) {
      throw new Error(`获取 access_token 失败: ${data.errmsg}`);
    }

    this.accessToken = data.access_token;
    this.tokenExpireAt = Date.now() + (data.expires_in - 300) * 1000;
    return this.accessToken;
  }

  /**
   * 发送应用消息
   */
  async sendMessage(userId, content, options = {}) {
    const token = await this.getAccessToken();
    const { msgType = 'text' } = options;

    // 企微 markdown 会渲染成卡片，改用 text 类型发纯文本
    const plainText = this.markdownToPlainText(content);
    const chunks = this.splitMessage(plainText, 2000);

    const results = [];
    for (const chunk of chunks) {
      const resp = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          touser: userId,
          msgtype: 'text',
          agentid: parseInt(this.agentId),
          text: { content: chunk },
        }),
      });

      const data = await resp.json();
      if (data.errcode !== 0) {
        console.error('[WeCom] 发送失败:', data);
        throw new Error(`企微发送失败: ${data.errmsg}`);
      }
      results.push(data);
    }

    return results;
  }

  /**
   * 通过 Webhook 发送消息（群机器人）
   */
  async sendWebhook(content, options = {}) {
    if (!this.webhookUrl) {
      throw new Error('未配置 Webhook URL');
    }

    const { msgType = 'text', mentionedList } = options;
    const plainText = this.markdownToPlainText(content);

    const body = {
      msgtype: 'text',
      text: {
        content: plainText,
        mentioned_list: mentionedList || [],
      },
    };

    const resp = await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await resp.json();
    if (data.errcode !== 0) {
      throw new Error(`Webhook 发送失败: ${data.errmsg}`);
    }

    return data;
  }

  /**
   * Markdown 转纯文本
   */
  markdownToPlainText(text) {
    return text
      .replace(/^\|(.+)\|\s*$/gm, (match, inner) => {
        if (/^[\s\-:|]+$/.test(inner)) return '';
        const cells = inner.split('|').map(c => c.trim()).filter(Boolean);
        return cells.length ? `• ${cells.join(' | ')}` : '';
      })
      .replace(/```[\w]*\n?([\s\S]*?)```/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^>\s?/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /**
   * 分割消息
   */
  splitMessage(text, maxLen) {
    const chunks = [];
    let remaining = text;
    while (remaining.length > maxLen) {
      let splitIdx = remaining.lastIndexOf('\n', maxLen);
      if (splitIdx < maxLen * 0.5) splitIdx = maxLen;
      chunks.push(remaining.substring(0, splitIdx));
      remaining = remaining.substring(splitIdx);
    }
    if (remaining) chunks.push(remaining);
    return chunks;
  }

  /**
   * 处理回调消息
   */
  handleMessage(xml) {
    // 解析 XML 获取消息内容
    // 这里简化处理，实际需要 XML 解析器
    const contentMatch = xml.match(/<Content><!\[CDATA\[(.*?)\]\]><\/Content>/);
    const userIdMatch = xml.match(/<FromUserName><!\[CDATA\[(.*?)\]\]><\/FromUserName>/);
    const msgIdMatch = xml.match(/<MsgId>(.*?)<\/MsgId>/);

    if (contentMatch && userIdMatch) {
      const content = contentMatch[1];
      const userId = userIdMatch[1];
      const messageId = msgIdMatch ? msgIdMatch[1] : null;

      console.log(`[WeCom] 收到消息: ${content.substring(0, 50)}...`);

      if (this.messageHandler) {
        this.messageHandler({
          platform: 'wechat',
          userId,
          userName: userId,
          content,
          messageId,
          reply: async (content, options) => {
            await this.sendMessage(userId, content, options);
          },
          send: async (content, options) => {
            await this.sendMessage(userId, content, options);
          },
          sendStatus: async (status) => {
            await this.sendMessage(userId, `⏳ ${status}`);
          },
        });
      }
    }
  }

  /**
   * 验证回调签名
   */
  verifySignature(msgSignature, timestamp, nonce, encrypt) {
    if (!this.crypto) return false;
    return this.crypto.verifySignature(msgSignature, timestamp, nonce, encrypt);
  }

  /**
   * 解密消息
   */
  decrypt(encrypt) {
    if (!this.crypto) throw new Error('未配置加密密钥');
    return this.crypto.decrypt(encrypt);
  }

  /**
   * 注册 Express 路由（Webhook 回调）
   */
  registerRoutes(app) {
    // GET - URL 验证
    app.get('/wecom/callback', (req, res) => {
      const { msg_signature, timestamp, nonce, echostr } = req.query;
      console.log('[WeCom] 收到 URL 验证请求');
      if (!this.verifySignature(msg_signature, timestamp, nonce, echostr)) {
        return res.status(403).send('签名验证失败');
      }
      const decrypted = this.decrypt(echostr);
      console.log('[WeCom] ✅ URL 验证成功');
      res.send(decrypted);
    });

    // POST - 接收用户消息
    app.post('/wecom/callback', async (req, res) => {
      const { msg_signature, timestamp, nonce } = req.query;
      try {
        let body = '';
        req.setEncoding('utf8');
        for await (const chunk of req) body += chunk;

        const encryptMatch = body.match(/<Encrypt><!\[CDATA\[(.*?)\]\]><\/Encrypt>/);
        if (!encryptMatch) return res.send('success');

        const encrypt = encryptMatch[1];
        if (!this.verifySignature(msg_signature, timestamp, nonce, encrypt)) {
          return res.status(403).send('签名验证失败');
        }

        const xml = this.decrypt(encrypt);
        const fromUser = xml.match(/<FromUserName><!\[CDATA\[(.*?)\]\]><\/FromUserName>/)?.[1];
        const msgType = xml.match(/<MsgType><!\[CDATA\[(.*?)\]\]><\/MsgType>/)?.[1];
        const content = xml.match(/<Content><!\[CDATA\[(.*?)\]\]><\/Content>/)?.[1];

        res.send('success');

        if (!fromUser || msgType !== 'text' || !content) {
          console.log(`[WeCom] 忽略非文本消息 (type=${msgType})`);
          return;
        }

        console.log(`[WeCom] 收到 ${fromUser}: ${content.substring(0, 50)}...`);
        this.handleMessage(xml);
      } catch (err) {
        console.error('[WeCom] 处理消息失败:', err.message);
        try { res.send('success'); } catch {}
      }
    });
    console.log('[WeCom] ✅ 回调路由已注册 (/wecom/callback)');
  }

  /**
   * 启动适配器
   */
  async start() {
    console.log('[WeCom] 启动企业微信适配器...');
    try {
      await this.getAccessToken();
      console.log('[WeCom] ✅ access_token 获取成功');
      this.connected = true;
    } catch (err) {
      console.error('[WeCom] 启动失败:', err.message);
      throw err;
    }
  }

  /**
   * 停止适配器
   */
  async stop() {
    console.log('[WeCom] 停止企业微信适配器...');
    this.connected = false;
  }

  /**
   * 获取配置摘要
   */
  _getConfigSummary() {
    return {
      corpId: this.corpId ? `${this.corpId.substring(0, 8)}...` : '未配置',
      agentId: this.agentId || '未配置',
      hasWebhook: !!this.webhookUrl,
    };
  }
}

/**
 * 企微消息加解密类
 */
class WeChatCrypto {
  constructor(token, encodingAESKey, corpId) {
    this.token = token;
    this.corpId = corpId;
    this.key = Buffer.from(encodingAESKey + '=', 'base64');
  }

  _pkcs7Pad(buf) {
    const blockSize = 32;
    const padLen = blockSize - (buf.length % blockSize);
    return Buffer.concat([buf, Buffer.alloc(padLen, padLen)]);
  }

  _pkcs7Unpad(buf) {
    return buf.subarray(0, buf.length - buf[buf.length - 1]);
  }

  decrypt(encrypt) {
    const iv = this.key.subarray(0, 16);
    const decipher = crypto.createDecipheriv('aes-256-cbc', this.key, iv);
    decipher.setAutoPadding(false);
    let decrypted = Buffer.concat([decipher.update(encrypt, 'base64'), decipher.final()]);
    decrypted = this._pkcs7Unpad(decrypted);
    const msgLen = decrypted.readUInt32BE(16);
    const xml = decrypted.subarray(20, 20 + msgLen).toString('utf8');
    const corpId = decrypted.subarray(20 + msgLen).toString('utf8');
    if (corpId !== this.corpId) throw new Error('CorpId 不匹配');
    return xml;
  }

  encrypt(xml) {
    const randomBytes = crypto.randomBytes(16);
    const msgBuf = Buffer.from(xml, 'utf8');
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(msgBuf.length, 0);
    let plaintext = Buffer.concat([randomBytes, lenBuf, msgBuf, Buffer.from(this.corpId, 'utf8')]);
    plaintext = this._pkcs7Pad(plaintext);
    const iv = this.key.subarray(0, 16);
    const cipher = crypto.createCipheriv('aes-256-cbc', this.key, iv);
    cipher.setAutoPadding(false);
    return Buffer.concat([cipher.update(plaintext), cipher.final()]).toString('base64');
  }

  verifySignature(msgSignature, timestamp, nonce, encrypt) {
    const arr = [this.token, timestamp, nonce, encrypt].sort();
    return crypto.createHash('sha1').update(arr.join('')).digest('hex') === msgSignature;
  }
}

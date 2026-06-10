import crypto from 'crypto';
import { config } from './config.js';
import { chat, clearHistory, getTurnCount } from './claude.js';
import { mcpManager } from './mcp-client.js';

// ========== Token 缓存 ==========
let accessToken = null;
let tokenExpireAt = 0;

async function getAccessToken() {
  if (accessToken && Date.now() < tokenExpireAt) return accessToken;

  const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${config.wecom.corpId}&corpsecret=${config.wecom.corpSecret}`;
  const resp = await fetch(url);
  const data = await resp.json();

  if (data.errcode !== 0) {
    throw new Error(`获取 access_token 失败: ${data.errmsg}`);
  }

  accessToken = data.access_token;
  tokenExpireAt = Date.now() + (data.expires_in - 300) * 1000; // 提前5分钟刷新
  return accessToken;
}

// ========== 消息加解密（PKCS7Padding + AES-256-CBC） ==========

class WeChatCrypto {
  constructor(token, encodingAESKey, corpId) {
    this.token = token;
    this.corpId = corpId;
    this.key = Buffer.from(encodingAESKey + '=', 'base64');
  }

  _pkcs7Pad(buf) {
    const blockSize = 32;
    const padLen = blockSize - (buf.length % blockSize);
    const pad = Buffer.alloc(padLen, padLen);
    return Buffer.concat([buf, pad]);
  }

  _pkcs7Unpad(buf) {
    const pad = buf[buf.length - 1];
    return buf.subarray(0, buf.length - pad);
  }

  decrypt(encrypt) {
    const iv = this.key.subarray(0, 16);
    const decipher = crypto.createDecipheriv('aes-256-cbc', this.key, iv);
    decipher.setAutoPadding(false);
    let decrypted = Buffer.concat([decipher.update(encrypt, 'base64'), decipher.final()]);
    decrypted = this._pkcs7Unpad(decrypted);

    // 前16字节是随机字符串，接着4字节是消息长度（网络字节序），然后是XML，最后是CorpId
    const msgLen = decrypted.readUInt32BE(16);
    const xml = decrypted.subarray(20, 20 + msgLen).toString('utf8');
    const corpId = decrypted.subarray(20 + msgLen).toString('utf8');

    if (corpId !== this.corpId) {
      throw new Error('CorpId 不匹配');
    }
    return xml;
  }

  encrypt(xml) {
    const randomBytes = crypto.randomBytes(16);
    const msgBuf = Buffer.from(xml, 'utf8');
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(msgBuf.length, 0);
    const corpIdBuf = Buffer.from(this.corpId, 'utf8');

    let plaintext = Buffer.concat([randomBytes, lenBuf, msgBuf, corpIdBuf]);
    plaintext = this._pkcs7Pad(plaintext);

    const iv = this.key.subarray(0, 16);
    const cipher = crypto.createCipheriv('aes-256-cbc', this.key, iv);
    cipher.setAutoPadding(false);
    return Buffer.concat([cipher.update(plaintext), cipher.final()]).toString('base64');
  }

  verifySignature(msgSignature, timestamp, nonce, encrypt) {
    const arr = [this.token, timestamp, nonce, encrypt].sort();
    const str = arr.join('');
    const sig = crypto.createHash('sha1').update(str).digest('hex');
    return sig === msgSignature;
  }

  getSignature(timestamp, nonce, encrypt) {
    const arr = [this.token, timestamp, nonce, encrypt].sort();
    const str = arr.join('');
    return crypto.createHash('sha1').update(str).digest('hex');
  }
}

// ========== 发送应用消息 ==========

async function sendAppMessage(userId, content) {
  const token = await getAccessToken();

  // 分段发送（企微单条消息限制 2048 字符）
  const chunks = splitMessage(content, 2000);

  for (const chunk of chunks) {
    const resp = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          touser: userId,
          msgtype: 'markdown',
          agentid: parseInt(config.wecom.agentId),
          markdown: { content: chunk },
        }),
      }
    );
    const data = await resp.json();
    if (data.errcode !== 0) {
      console.error('[WeCom] 发送应用消息失败:', data);
    }
  }
}

function splitMessage(text, maxLen) {
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

// ========== Webhook 发送 ==========

export async function sendWebhookMessage(content) {
  if (!config.wecom.webhookUrl) return;
  const resp = await fetch(config.wecom.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ msgtype: 'markdown', markdown: { content } }),
  });
  const data = await resp.json();
  if (data.errcode !== 0) console.error('[WeCom Webhook] 发送失败:', data);
  return data;
}

// ========== 注册回调路由 ==========

export function startWecomServer(app) {
  const { token, encodingAESKey, corpId } = config.wecom;

  if (!token || !encodingAESKey || !corpId) {
    console.log('[WeCom] 未配置回调参数(Token/EncodingAESKey/CorpID)，仅支持 Webhook 模式');
    return;
  }

  const crypto2 = new WeChatCrypto(token, encodingAESKey, corpId);

  // GET - URL 验证（企微后台配置回调时会调用）
  app.get('/wecom/callback', (req, res) => {
    const { msg_signature, timestamp, nonce, echostr } = req.query;
    console.log('[WeCom] 收到 URL 验证请求');
    console.log(`[WeCom]   msg_signature: ${msg_signature}`);
    console.log(`[WeCom]   timestamp: ${timestamp}`);
    console.log(`[WeCom]   nonce: ${nonce}`);
    console.log(`[WeCom]   echostr: ${echostr?.substring(0, 20)}...`);

    // 手动计算签名用于调试
    const arr = [token, timestamp, nonce, echostr].sort();
    const computed = crypto.createHash('sha1').update(arr.join('')).digest('hex');
    console.log(`[WeCom]   计算签名: ${computed}`);
    console.log(`[WeCom]   期望签名: ${msg_signature}`);
    console.log(`[WeCom]   匹配: ${computed === msg_signature}`);

    if (!crypto2.verifySignature(msg_signature, timestamp, nonce, echostr)) {
      console.error('[WeCom] URL 验证签名不匹配');
      return res.status(403).send('签名验证失败');
    }

    const decrypted = crypto2.decrypt(echostr);
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

      // 提取加密内容
      const encryptMatch = body.match(/<Encrypt><!\[CDATA\[(.*?)\]\]><\/Encrypt>/);
      if (!encryptMatch) {
        return res.send('success');
      }

      const encrypt = encryptMatch[1];

      // 验签
      if (!crypto2.verifySignature(msg_signature, timestamp, nonce, encrypt)) {
        console.error('[WeCom] 消息签名验证失败');
        return res.status(403).send('签名验证失败');
      }

      // 解密
      const xml = crypto2.decrypt(encrypt);

      // 解析 XML
      const fromUser = xml.match(/<FromUserName><!\[CDATA\[(.*?)\]\]><\/FromUserName>/)?.[1];
      const msgType = xml.match(/<MsgType><!\[CDATA\[(.*?)\]\]><\/MsgType>/)?.[1];
      const content = xml.match(/<Content><!\[CDATA\[(.*?)\]\]><\/Content>/)?.[1];
      const msgId = xml.match(/<MsgId>(.*?)<\/MsgId>/)?.[1];

      // 先返回 success（企微要求5秒内响应）
      res.send('success');

      if (!fromUser || msgType !== 'text' || !content) {
        console.log(`[WeCom] 忽略非文本消息 (type=${msgType})`);
        return;
      }

      console.log(`[WeCom] 收到 ${fromUser}: ${content.substring(0, 50)}...`);
      console.log(`[WeCom] 开始调用 Claude...`);

      // 处理命令
      if (content.trim() === '/clear') {
        clearHistory(`wecom:${fromUser}`);
        await sendAppMessage(fromUser, '✅ 对话历史已清除');
        return;
      }
      if (content.trim() === '/turns') {
        const turns = getTurnCount(`wecom:${fromUser}`);
        await sendAppMessage(fromUser, `📊 当前对话轮数: ${turns}`);
        return;
      }

      // MCP 命令
      const mcpCmd = content.trim().match(/^\/mcp\s+(\w+)\s*(.*)$/);
      if (mcpCmd) {
        const [, action, args] = mcpCmd;
        try {
          if (action === 'add') {
            const [name, url] = args.split(/\s+/);
            if (!name || !url) {
              await sendAppMessage(fromUser, '❌ 用法: /mcp add <名称> <SSE地址>');
              return;
            }
            await mcpManager.addServer(name, url);
            const tools = mcpManager.clients.get(name)?.tools || [];
            await sendAppMessage(fromUser, `✅ 已添加 **${name}**\n工具数: ${tools.length}\n工具列表: ${tools.map(t => t.name).join(', ')}`);
          } else if (action === 'remove') {
            const name = args.trim();
            if (!name) { await sendAppMessage(fromUser, '❌ 用法: /mcp remove <名称>'); return; }
            await mcpManager.removeServer(name);
            await sendAppMessage(fromUser, `✅ 已移除 **${name}**`);
          } else if (action === 'list') {
            const status = mcpManager.getStatus();
            if (!status.length) {
              await sendAppMessage(fromUser, '📭 暂无 MCP 服务器\n\n用 `/mcp add <名称> <URL>` 添加');
            } else {
              const lines = status.map(s =>
                `**${s.name}** ${s.connected ? '🟢' : '🔴'}\n工具: ${s.tools.join(', ') || '无'}`
              );
              await sendAppMessage(fromUser, lines.join('\n\n'));
            }
          } else if (action === 'reload') {
            await mcpManager.reloadAll();
            const count = mcpManager.clients.size;
            await sendAppMessage(fromUser, `✅ 已重新加载 ${count} 个 MCP 服务器`);
          } else {
            await sendAppMessage(fromUser, '❓ 可用命令:\n/mcp list - 查看列表\n/mcp add <名称> <URL> - 添加\n/mcp remove <名称> - 移除\n/mcp reload - 重载');
          }
        } catch (err) {
          await sendAppMessage(fromUser, `❌ MCP 操作失败: ${err.message}`);
        }
        return;
      }

      // 调用 Claude
      console.log(`[WeCom] 正在调用 Claude API...`);
      const reply = await chat(`wecom:${fromUser}`, content);
      console.log(`[WeCom] Claude 回复: ${reply.substring(0, 50)}...`);
      console.log(`[WeCom] 正在发送到企微...`);
      await sendAppMessage(fromUser, reply);
      console.log(`[WeCom] ✅ 回复已发送`);

    } catch (err) {
      console.error('[WeCom] 处理消息失败:', err.message);
      try { res.send('success'); } catch {}
    }
  });

  console.log('[WeCom] ✅ 应用回调已注册 (/wecom/callback)');
}

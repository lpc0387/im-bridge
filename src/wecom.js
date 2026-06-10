import crypto from 'crypto';
import { config } from './config.js';
import { chat, clearHistory, getTurnCount } from './claude.js';
import { mcpManager } from './mcp-client.js';
import { sessionManager } from './session.js';
import { handleCliPassthrough, parseCliCommand } from './cli-passthrough.js';

// ========== Token 缓存 ==========
let accessToken = null;
let tokenExpireAt = 0;

async function getAccessToken() {
  if (accessToken && Date.now() < tokenExpireAt) return accessToken;
  const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${config.wecom.corpId}&corpsecret=${config.wecom.corpSecret}`;
  const resp = await fetch(url);
  const data = await resp.json();
  if (data.errcode !== 0) throw new Error(`获取 access_token 失败: ${data.errmsg}`);
  accessToken = data.access_token;
  tokenExpireAt = Date.now() + (data.expires_in - 300) * 1000;
  return accessToken;
}

// ========== 消息加解密 ==========

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

// ========== 发送消息 ==========

async function sendAppMessage(userId, content) {
  const token = await getAccessToken();

  // 企微 markdown 会渲染成卡片，改用 text 类型发纯文本
  const plainText = markdownToPlainText(content);
  const chunks = splitMessage(plainText, 2000);

  for (const chunk of chunks) {
    const resp = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        touser: userId,
        msgtype: 'text',
        agentid: parseInt(config.wecom.agentId),
        text: { content: chunk },
      }),
    });
    const data = await resp.json();
    if (data.errcode !== 0) console.error('[WeCom] 发送失败:', data);
  }
}

// Markdown → 纯文本（企微 text 类型不支持任何格式）
function markdownToPlainText(text) {
  return text
    // 表格 → 列表
    .replace(/^\|(.+)\|\s*$/gm, (match, inner) => {
      if (/^[\s\-:|]+$/.test(inner)) return ''; // 分隔行
      const cells = inner.split('|').map(c => c.trim()).filter(Boolean);
      return cells.length ? `• ${cells.join(' | ')}` : '';
    })
    // 代码块 → 保留内容
    .replace(/```[\w]*\n?([\s\S]*?)```/g, '$1')
    // 行内代码
    .replace(/`([^`]+)`/g, '$1')
    // 加粗
    .replace(/\*\*(.+?)\*\*/g, '$1')
    // 斜体
    .replace(/\*(.+?)\*/g, '$1')
    // 链接 [text](url) → text (url)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    // 标题
    .replace(/^#{1,6}\s+/gm, '')
    // 引用
    .replace(/^>\s?/gm, '')
    // 清理多余空行
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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

// ========== 会话命令处理 ==========

async function handleSessionCommand(userId, content) {
  const cmd = content.trim();

  if (cmd === '/clear') {
    await clearHistory(userId);
    await sendAppMessage(userId, '✅ 当前会话已清空');
    return true;
  }

  if (cmd === '/turns') {
    const turns = await getTurnCount(userId);
    await sendAppMessage(userId, `📊 当前会话轮数: ${turns}`);
    return true;
  }

  if (cmd === '/new') {
    const ts = Date.now().toString(36);
    await sessionManager.switchTo(userId, ts);
    await sendAppMessage(userId, `✅ 已创建新会话: ${ts}`);
    return true;
  }

  if (cmd === '/sessions') {
    const sessions = await sessionManager.list(userId);
    if (!sessions.length) {
      await sendAppMessage(userId, '📭 暂无会话');
    } else {
      const current = await sessionManager.getActive(userId);
      const lines = sessions.map(s => {
        const marker = s.id === current.id ? ' ← 当前' : '';
        const tokens = s.tokenUsage.total;
        return `- **${s.name}**${marker}\n  轮数: ${s.messageCount} | Token: ${tokens} | 最后: ${new Date(s.lastActiveAt).toLocaleString('zh-CN')}`;
      });
      await sendAppMessage(userId, `📋 会话列表:\n\n${lines.join('\n')}`);
    }
    return true;
  }

  if (cmd.startsWith('/session ')) {
    const name = cmd.slice(9).trim();
    if (!name) {
      await sendAppMessage(userId, '❌ 用法: /session <名称>');
      return true;
    }
    await sessionManager.switchTo(userId, name);
    await sendAppMessage(userId, `✅ 已切换到会话: ${name}`);
    return true;
  }

  if (cmd === '/cost') {
    const session = await sessionManager.getActive(userId);
    const u = session.tokenUsage;
    await sendAppMessage(userId, `💰 当前会话 Token 消耗:\n\n- 输入: ${u.input}\n- 输出: ${u.output}\n- 合计: ${u.total}`);
    return true;
  }

  return false; // 不是会话命令
}

// ========== 注册回调路由 ==========

export function startWecomServer(app) {
  const { token, encodingAESKey, corpId } = config.wecom;

  if (!token || !encodingAESKey || !corpId) {
    console.log('[WeCom] 未配置回调参数，仅支持 Webhook 模式');
    return;
  }

  const crypto2 = new WeChatCrypto(token, encodingAESKey, corpId);

  // GET - URL 验证
  app.get('/wecom/callback', (req, res) => {
    const { msg_signature, timestamp, nonce, echostr } = req.query;
    console.log('[WeCom] 收到 URL 验证请求');
    if (!crypto2.verifySignature(msg_signature, timestamp, nonce, echostr)) {
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

      const encryptMatch = body.match(/<Encrypt><!\[CDATA\[(.*?)\]\]><\/Encrypt>/);
      if (!encryptMatch) return res.send('success');

      const encrypt = encryptMatch[1];
      if (!crypto2.verifySignature(msg_signature, timestamp, nonce, encrypt)) {
        return res.status(403).send('签名验证失败');
      }

      const xml = crypto2.decrypt(encrypt);
      const fromUser = xml.match(/<FromUserName><!\[CDATA\[(.*?)\]\]><\/FromUserName>/)?.[1];
      const msgType = xml.match(/<MsgType><!\[CDATA\[(.*?)\]\]><\/MsgType>/)?.[1];
      const content = xml.match(/<Content><!\[CDATA\[(.*?)\]\]><\/Content>/)?.[1];

      res.send('success');

      if (!fromUser || msgType !== 'text' || !content) {
        console.log(`[WeCom] 忽略非文本消息 (type=${msgType})`);
        return;
      }

      console.log(`[WeCom] 收到 ${fromUser}: ${content.substring(0, 50)}...`);

      // 1. 会话命令
      if (content.startsWith('/')) {
        const handled = await handleSessionCommand(fromUser, content);
        if (handled) return;

        // MCP 命令兼容
        const mcpCmd = content.trim().match(/^\/mcp\s+(\w+)\s*(.*)$/);
        if (mcpCmd) {
          const [, action, args] = mcpCmd;
          try {
            if (action === 'add') {
              const [name, url] = args.split(/\s+/);
              if (!name || !url) { await sendAppMessage(fromUser, '❌ 用法: /mcp add <名称> <URL>'); return; }
              await mcpManager.addServer(name, url);
              const tools = mcpManager.clients.get(name)?.tools || [];
              await sendAppMessage(fromUser, `✅ 已添加 **${name}**\n工具: ${tools.map(t => t.name).join(', ')}`);
            } else if (action === 'remove') {
              const name = args.trim();
              if (!name) { await sendAppMessage(fromUser, '❌ 用法: /mcp remove <名称>'); return; }
              await mcpManager.removeServer(name);
              await sendAppMessage(fromUser, `✅ 已移除 **${name}**`);
            } else if (action === 'list') {
              const status = mcpManager.getStatus();
              if (!status.length) { await sendAppMessage(fromUser, '📭 暂无 MCP 服务器'); }
              else { await sendAppMessage(fromUser, status.map(s => `**${s.name}** ${s.connected ? '🟢' : '🔴'}\n工具: ${s.tools.join(', ') || '无'}`).join('\n\n')); }
            } else if (action === 'reload') {
              await mcpManager.reloadAll();
              await sendAppMessage(fromUser, `✅ 已重载 ${mcpManager.clients.size} 个 MCP`);
            } else {
              await sendAppMessage(fromUser, '❓ 可用: /mcp list|add|remove|reload');
            }
          } catch (err) {
            await sendAppMessage(fromUser, `❌ MCP 操作失败: ${err.message}`);
          }
          return;
        }
      }

      // 2. @@命令 — CLI 透传
      if (content.startsWith('@@')) {
        console.log(`[WeCom] CLI 透传命令`);
        const reply = await handleCliPassthrough(content);
        await sendAppMessage(fromUser, reply);
        return;
      }

      // 3. 普通消息 → Claude API
      console.log(`[WeCom] 调用 Claude...`);
      let lastStatusTime = 0;
      const reply = await chat(`wecom:${fromUser}`, content, (status) => {
        const now = Date.now();
        if (now - lastStatusTime > 3000) {
          lastStatusTime = now;
          sendAppMessage(fromUser, `⏳ ${status}`).catch(() => {});
        }
      });
      console.log(`[WeCom] 回复: ${reply.substring(0, 50)}...`);
      await sendAppMessage(fromUser, reply);
      console.log(`[WeCom] ✅ 回复已发送`);

    } catch (err) {
      console.error('[WeCom] 处理消息失败:', err.message);
      try { res.send('success'); } catch {}
    }
  });

  console.log('[WeCom] ✅ 应用回调已注册 (/wecom/callback)');
}

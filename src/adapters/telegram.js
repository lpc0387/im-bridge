import fs from 'fs/promises';
import { BaseAdapter } from './base.js';
import { classifyDeliverableFile, saveIncomingFile, sanitizeFilename } from '../file-delivery.js';

/**
 * Telegram 适配器 - Long Polling 模式
 * 无需公网 IP
 */
export class TelegramAdapter extends BaseAdapter {
  constructor(config) {
    super('telegram', config);
    this.token = config.token;
    this.botUsername = null;
    this.offset = 0;
    this.polling = false;
    this.pollTimer = null;
    this.retryDelay = 1000;
    this.maxRetryDelay = 30000;
    this.fileCapability = 'attachment';
  }

  /**
   * 获取 Bot 信息
   */
  async getMe() {
    const resp = await fetch(`https://api.telegram.org/bot${this.token}/getMe`);
    const data = await resp.json();
    if (!data.ok) {
      throw new Error(`获取 Bot 信息失败: ${data.description}`);
    }
    this.botUsername = data.result.username;
    return data.result;
  }

  /**
   * 获取更新
   */
  async getUpdates() {
    const resp = await fetch(`https://api.telegram.org/bot${this.token}/getUpdates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        offset: this.offset,
        timeout: 30,
        allowed_updates: ['message'],
      }),
    });

    const data = await resp.json();
    if (!data.ok) {
      throw new Error(`获取更新失败: ${data.description}`);
    }

    return data.result;
  }

  /**
   * 发送消息
   */
  async sendMessage(userId, content, options = {}) {
    const { parseMode = 'Markdown', replyToMessageId } = options;

    const body = {
      chat_id: userId,
      text: content,
      parse_mode: parseMode,
    };

    if (replyToMessageId) {
      body.reply_to_message_id = replyToMessageId;
    }

    // Telegram 消息长度限制 4096
    if (content.length > 4000) {
      const chunks = this.splitMessage(content, 4000);
      const results = [];
      for (const chunk of chunks) {
        body.text = chunk;
        const resp = await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await resp.json();
        if (!data.ok) {
          console.error(`[Telegram] 发送消息失败: ${data.description}`);
        }
        results.push(data);
      }
      return results;
    }

    const resp = await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await resp.json();
    if (!data.ok) {
      console.error(`[Telegram] 发送消息失败: ${data.description}`);
      throw new Error(`Telegram 发送失败: ${data.description}`);
    }

    return data;
  }

  /**
   * 发送文件
   */
  async sendFile(userId, filePath, options = {}) {
    const classified = await classifyDeliverableFile(filePath);
    if (!classified.ok) throw new Error(classified.reason);
    const file = classified.file;
    const data = await fs.readFile(file.path);
    const form = new FormData();
    form.append('chat_id', userId);
    form.append('document', new Blob([data], { type: options.mimeType || file.mimeType }), sanitizeFilename(options.filename || file.name));
    if (options.caption) form.append('caption', options.caption);
    if (options.replyToMessageId) form.append('reply_to_message_id', String(options.replyToMessageId));

    const resp = await fetch(`https://api.telegram.org/bot${this.token}/sendDocument`, {
      method: 'POST',
      body: form,
    });
    const result = await resp.json();
    if (!result.ok) {
      throw new Error(`Telegram 文件发送失败: ${result.description}`);
    }
    console.log(`[Telegram] 已发送文件: ${file.name}`);
    return result;
  }

  /**
   * 下载用户发送的文件
   */
  async downloadFile(fileId, filename = 'telegram-file') {
    const infoResp = await fetch(`https://api.telegram.org/bot${this.token}/getFile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: fileId }),
    });
    const info = await infoResp.json();
    if (!info.ok) throw new Error(`获取 Telegram 文件信息失败: ${info.description}`);

    const fileResp = await fetch(`https://api.telegram.org/file/bot${this.token}/${info.result.file_path}`);
    if (!fileResp.ok) throw new Error(`下载 Telegram 文件失败: HTTP ${fileResp.status}`);
    const data = Buffer.from(await fileResp.arrayBuffer());
    return await saveIncomingFile('telegram', filename, data);
  }

  /**
   * 处理更新
   */
  async handleUpdate(update) {
    if (update.message) {
      const message = update.message;
      const chatId = message.chat.id;
      const userId = message.from.id;
      const document = message.document || message.video || message.audio || message.voice;
      let text = message.text || message.caption || '';
      let files = [];

      if (!text && !document) return;

      if (document?.file_id) {
        try {
          const savedPath = await this.downloadFile(document.file_id, document.file_name || `${document.file_id}.bin`);
          const classified = await classifyDeliverableFile(savedPath);
          files = classified.ok ? [classified.file] : [];
          text = text || `用户发送了文件: ${document.file_name || files[0]?.name || 'file'}`;
        } catch (err) {
          text = text || `用户发送了文件，但下载失败: ${err.message}`;
        }
      }

      console.log(`[Telegram] 收到消息: ${text.substring(0, 50)}...`);

      if (this.messageHandler) {
        this.messageHandler({
          platform: 'telegram',
          userId: String(userId),
          userName: message.from.username || message.from.first_name || String(userId),
          content: text,
          files,
          messageId: message.message_id,
          chatId: String(chatId),
          chatType: message.chat.type, // private, group, supergroup
          reply: async (content, options) => {
            await this.sendMessage(String(chatId), content, {
              ...options,
              replyToMessageId: message.message_id,
            });
          },
          send: async (content, options) => {
            await this.sendMessage(String(chatId), content, options);
          },
          sendFile: async (file, options) => {
            await this.sendFile(String(chatId), file, {
              ...options,
              replyToMessageId: message.message_id,
            });
          },
          sendStatus: async (status) => {
            await this.sendMessage(String(chatId), `⏳ ${status}`);
          },
        });
      }
    }
  }

  /**
   * 启动轮询
   */
  async startPolling() {
    this.polling = true;
    let failCount = 0;
    const maxFails = 5;
    console.log('[Telegram] 启动长轮询...');

    while (this.polling) {
      try {
        const updates = await this.getUpdates();
        this.retryDelay = 1000;
        failCount = 0;
        this.connected = true;

        for (const update of updates) {
          await this.handleUpdate(update);
          this.offset = update.update_id + 1;
        }
      } catch (err) {
        failCount++;
        console.warn(`[Telegram] 轮询错误 (${failCount}/${maxFails}): ${err.message}`);
        if (failCount >= maxFails) {
          console.warn('[Telegram] 连续失败过多，标记离线，等待守护重连');
          this.connected = false;
          this._lastError = `连接中断: ${err.message}`;
          return;
        }
        await new Promise(resolve => setTimeout(resolve, this.retryDelay));
        this.retryDelay = Math.min(this.retryDelay * 2, this.maxRetryDelay);
      }
    }
  }

  /**
   * 启动适配器
   */
  async start() {
    console.log('[Telegram] 启动 Telegram 适配器...');
    try {
      const botInfo = await this.getMe();
      console.log(`[Telegram] ✅ Bot: @${botInfo.username} (${botInfo.first_name})`);
      this.connected = true;
      await this.startPolling();
    } catch (err) {
      console.error('[Telegram] 启动失败:', err.message);
      throw err;
    }
  }

  /**
   * 停止适配器
   */
  async stop() {
    console.log('[Telegram] 停止 Telegram 适配器...');
    this.polling = false;
    this.connected = false;
  }

  /**
   * 获取配置摘要
   */
  _getConfigSummary() {
    return {
      botUsername: this.botUsername || '未连接',
      token: this.token ? `${this.token.substring(0, 8)}...` : '未配置',
    };
  }
}

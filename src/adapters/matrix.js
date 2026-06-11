import { BaseAdapter } from './base.js';

/**
 * Matrix 适配器
 * 使用 Matrix Client-Server API
 */
export class MatrixAdapter extends BaseAdapter {
  constructor(config) {
    super('matrix', config);
    this.homeserver = config.homeserver;  // https://matrix.org
    this.accessToken = config.accessToken;
    this.userId = config.userId;          // @bot:matrix.org
    this.roomId = config.roomId;          // 可选，默认房间
    this.syncToken = null;
    this.polling = false;
  }

  async start() {
    console.log('[Matrix] 启动 Matrix 适配器...');
    if (!this.homeserver || !this.accessToken) throw new Error('未配置 homeserver 或 accessToken');
    this.connected = true;
    this._startSync();
    console.log('[Matrix] ✅ Matrix 适配器已启动');
  }

  _startSync() {
    this.polling = true;
    let failCount = 0;
    const poll = async () => {
      if (!this.polling) return;
      try {
        const params = new URLSearchParams({ timeout: '30000' });
        if (this.syncToken) params.set('since', this.syncToken);
        const resp = await fetch(`${this.homeserver}/_matrix/client/v3/sync?${params}`, {
          headers: { 'Authorization': `Bearer ${this.accessToken}` },
        });
        if (!resp.ok) {
          failCount++;
          if (failCount >= 5) {
            console.warn('[Matrix] 连续失败过多，标记离线');
            this.connected = false;
            this._lastError = `HTTP ${resp.status}`;
            return;
          }
          poll();
          return;
        }
        failCount = 0;
        this.connected = true;
        const data = await resp.json();
        this.syncToken = data.next_batch;

        const rooms = data.rooms?.join || {};
        for (const [roomId, room] of Object.entries(rooms)) {
          const events = room.timeline?.events || [];
          for (const event of events) {
            if (event.type !== 'm.room.message') continue;
            if (event.sender === this.userId) continue;
            const text = event.content?.body;
            if (!text) continue;

            console.log(`[Matrix] 收到消息: ${text.substring(0, 50)}...`);
            if (this.messageHandler) {
              this.messageHandler({
                platform: 'matrix',
                userId: event.sender,
                userName: event.sender,
                content: text,
                messageId: event.event_id,
                reply: async (content) => await this._send(roomId, content),
                send: async (content) => await this._send(roomId, content),
                sendStatus: async (status) => await this._send(roomId, `⏳ ${status}`),
              });
            }
          }
        }
      } catch {}
      poll();
    };
    poll();
  }

  async _send(roomId, text) {
    const chunks = this.splitMessage(text, 60000);
    for (const chunk of chunks) {
      await fetch(`${this.homeserver}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ msgtype: 'm.text', body: chunk }),
      });
    }
  }

  async sendMessage(userId, content) {
    await this._send(this.roomId || userId, content);
  }

  async stop() {
    this.polling = false;
    this.connected = false;
  }

  _getConfigSummary() {
    return { homeserver: this.homeserver, userId: this.userId };
  }
}

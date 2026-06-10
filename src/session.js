import fs from 'fs/promises';
import path from 'path';

const SESSION_DIR = process.env.SESSION_DIR || path.join(process.env.HOME || '/root', '.im-bridge/sessions');

export class SessionManager {
  constructor() {
    this.activeSessions = new Map(); // userId -> sessionId
  }

  // ========== 路径 ==========

  _userDir(userId) {
    return path.join(SESSION_DIR, userId);
  }

  _sessionPath(userId, sessionId) {
    return path.join(this._userDir(userId), `${sessionId}.json`);
  }

  // ========== 核心操作 ==========

  async getOrCreate(userId, sessionId = 'default') {
    const filePath = this._sessionPath(userId, sessionId);
    try {
      const data = JSON.parse(await fs.readFile(filePath, 'utf8'));
      this.activeSessions.set(userId, sessionId);
      return data;
    } catch {
      const session = {
        id: sessionId,
        name: sessionId,
        createdAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
        messages: [],
        tokenUsage: { input: 0, output: 0, total: 0 },
      };
      await this.save(userId, session);
      this.activeSessions.set(userId, sessionId);
      return session;
    }
  }

  async save(userId, session) {
    const dir = this._userDir(userId);
    await fs.mkdir(dir, { recursive: true });
    session.lastActiveAt = new Date().toISOString();
    await fs.writeFile(this._sessionPath(userId, session.id), JSON.stringify(session, null, 2), 'utf8');
  }

  async getActive(userId) {
    const sessionId = this.activeSessions.get(userId) || 'default';
    return this.getOrCreate(userId, sessionId);
  }

  async switchTo(userId, sessionId) {
    return this.getOrCreate(userId, sessionId);
  }

  async list(userId) {
    const dir = this._userDir(userId);
    try {
      const files = await fs.readdir(dir);
      const sessions = [];
      for (const f of files) {
        if (!f.endsWith('.json')) continue;
        try {
          const data = JSON.parse(await fs.readFile(path.join(dir, f), 'utf8'));
          sessions.push({
            id: data.id,
            name: data.name,
            createdAt: data.createdAt,
            lastActiveAt: data.lastActiveAt,
            messageCount: data.messages.filter(m => m.role === 'user').length,
            tokenUsage: data.tokenUsage,
          });
        } catch {}
      }
      sessions.sort((a, b) => new Date(b.lastActiveAt) - new Date(a.lastActiveAt));
      return sessions;
    } catch {
      return [];
    }
  }

  async clear(userId) {
    const session = await this.getActive(userId);
    session.messages = [];
    session.tokenUsage = { input: 0, output: 0, total: 0 };
    await this.save(userId, session);
    return session;
  }

  async deleteSession(userId, sessionId) {
    try {
      await fs.unlink(this._sessionPath(userId, sessionId));
    } catch {}
    if (this.activeSessions.get(userId) === sessionId) {
      this.activeSessions.set(userId, 'default');
    }
  }

  // ========== 消息 + Token ==========

  async addMessage(userId, role, content) {
    const session = await this.getActive(userId);
    session.messages.push({ role, content, timestamp: new Date().toISOString() });
    // 保留最近 40 条 user 消息
    const userMsgs = session.messages.filter(m => m.role === 'user');
    while (userMsgs.length > 40) {
      const idx = session.messages.findIndex(m => m === userMsgs.shift());
      session.messages.splice(idx, 1);
    }
    await this.save(userId, session);
    return session;
  }

  async addTokenUsage(userId, inputTokens, outputTokens) {
    const session = await this.getActive(userId);
    session.tokenUsage.input += inputTokens;
    session.tokenUsage.output += outputTokens;
    session.tokenUsage.total += inputTokens + outputTokens;
    await this.save(userId, session);
  }

  getTurnCount(session) {
    return session.messages.filter(m => m.role === 'user').length;
  }
}

export const sessionManager = new SessionManager();

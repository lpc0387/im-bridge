import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';

import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '..', 'mcp-config.json');

// ========== MCP SSE 客户端 ==========

class MCPSSEClient extends EventEmitter {
  constructor(name, url) {
    super();
    this.name = name;
    this.url = url;
    this.transport = 'sse';
    this.tools = [];
    this.sessionId = null;
    this.messageEndpoint = null;
    this.connected = false;
    this._idCounter = 1;
    this._pending = new Map();
    this._sseAbort = null;
  }

  async connect() {
    console.log(`[MCP:${this.name}] SSE 连接 ${this.url}...`);
    const controller = new AbortController();
    this._sseAbort = controller;

    try {
      const resp = await fetch(this.url, {
        headers: { Accept: 'text/event-stream' },
        signal: controller.signal,
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let endpointReceived = false;

      const readLoop = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6).trim();
                if (!endpointReceived && data.startsWith('/messages/')) {
                  this.messageEndpoint = data;
                  this.sessionId = new URL('http://x' + data).searchParams.get('session_id');
                  endpointReceived = true;
                  await this._initialize();
                } else if (endpointReceived) {
                  try { this._handleMessage(JSON.parse(data)); } catch {}
                }
              }
            }
          }
        } catch (err) {
          if (err.name !== 'AbortError') console.error(`[MCP:${this.name}] SSE 错误:`, err.message);
        }
        this.connected = false;
        this.emit('disconnect');
      };
      readLoop();

      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('超时')), 10000);
        this.once('_initialized', () => { clearTimeout(timer); resolve(); });
        this.once('_error', (err) => { clearTimeout(timer); reject(err); });
      });
    } catch (err) {
      console.error(`[MCP:${this.name}] 连接失败:`, err.message);
      throw err;
    }
  }

  async _send(method, params = {}) {
    if (!this.messageEndpoint) throw new Error('未连接');
    const id = this._idCounter++;
    const msg = { jsonrpc: '2.0', id, method, params };
    const fullUrl = new URL('http://x' + this.messageEndpoint).pathname;

    await fetch(`https://${new URL(this.url).host}${fullUrl}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(msg),
    });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this._pending.delete(id); reject(new Error('请求超时')); }, 30000);
      this._pending.set(id, { resolve, reject, timeout });
    });
  }

  async _notify(method, params = {}) {
    if (!this.messageEndpoint) return;
    const msg = { jsonrpc: '2.0', method, params };
    const fullUrl = new URL('http://x' + this.messageEndpoint).pathname;
    await fetch(`https://${new URL(this.url).host}${fullUrl}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(msg),
    }).catch(() => {});
  }

  _handleMessage(msg) {
    if (msg.id !== undefined) {
      const pending = this._pending.get(msg.id);
      if (pending) {
        this._pending.delete(msg.id);
        clearTimeout(pending.timeout);
        msg.error ? pending.reject(new Error(msg.error.message)) : pending.resolve(msg.result);
      }
    }
  }

  async _initialize() {
    try {
      const result = await this._send('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'im-bridge', version: '1.0.0' },
      });
      console.log(`[MCP:${this.name}] 服务器: ${result.serverInfo?.name} v${result.serverInfo?.version}`);
      await this._notify('notifications/initialized', {});
      const toolsResult = await this._send('tools/list', {});
      this.tools = toolsResult.tools || [];
      this.connected = true;
      console.log(`[MCP:${this.name}] ✅ 已加载 ${this.tools.length} 个工具`);
      this.tools.forEach((t) => console.log(`  - ${t.name}: ${t.description?.substring(0, 50)}`));
      this.emit('_initialized');
    } catch (err) {
      this.emit('_error', err);
    }
  }

  async callTool(toolName, args) {
    if (!this.connected) throw new Error(`${this.name} 未连接`);
    return await this._send('tools/call', { name: toolName, arguments: args });
  }

  disconnect() {
    this._sseAbort?.abort();
    this.connected = false;
    for (const [, p] of this._pending) { clearTimeout(p.timeout); p.reject(new Error('断开')); }
    this._pending.clear();
  }
}

// ========== MCP Stdio 客户端 ==========

class MCPStdioClient extends EventEmitter {
  constructor(name, command, args = [], env = {}) {
    super();
    this.name = name;
    this.command = command;
    this.args = args;
    this.env = env;
    this.transport = 'stdio';
    this.tools = [];
    this.connected = false;
    this._idCounter = 1;
    this._pending = new Map();
    this._process = null;
    this._buffer = '';
  }

  async connect() {
    console.log(`[MCP:${this.name}] Stdio 启动 ${this.command}...`);

    const mergedEnv = { ...process.env, ...this.env };
    this._process = spawn(this.command, this.args, {
      env: mergedEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: true,  // Windows 需要 shell 来找到 npx 等命令
    });

    this._process.stdout.on('data', (data) => this._onData(data));
    this._process.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) console.log(`[MCP:${this.name}] ${msg}`);
    });
    this._process.on('exit', (code) => {
      console.log(`[MCP:${this.name}] 进程退出 (code=${code})`);
      this.connected = false;
      for (const [, p] of this._pending) { clearTimeout(p.timeout); p.reject(new Error('进程退出')); }
      this._pending.clear();
    });

    // 初始化
    const result = await this._send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'im-bridge', version: '1.0.0' },
    });
    console.log(`[MCP:${this.name}] 服务器: ${result.serverInfo?.name} v${result.serverInfo?.version}`);

    this._sendNotification('notifications/initialized', {});
    const toolsResult = await this._send('tools/list', {});
    this.tools = toolsResult.tools || [];
    this.connected = true;
    console.log(`[MCP:${this.name}] ✅ 已加载 ${this.tools.length} 个工具`);
    this.tools.forEach((t) => console.log(`  - ${t.name}: ${t.description?.substring(0, 50)}`));
  }

  _onData(data) {
    this._buffer += data.toString();
    // JSON-RPC 用换行分隔
    let lines = this._buffer.split('\n');
    this._buffer = lines.pop();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed);
        this._handleMessage(msg);
      } catch {}
    }
  }

  _handleMessage(msg) {
    if (msg.id !== undefined) {
      const pending = this._pending.get(msg.id);
      if (pending) {
        this._pending.delete(msg.id);
        clearTimeout(pending.timeout);
        msg.error ? pending.reject(new Error(msg.error.message)) : pending.resolve(msg.result);
      }
    }
  }

  _send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this._idCounter++;
      const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params });
      this._process.stdin.write(msg + '\n');
      const timeout = setTimeout(() => { this._pending.delete(id); reject(new Error('请求超时')); }, 30000);
      this._pending.set(id, { resolve, reject, timeout });
    });
  }

  _sendNotification(method, params = {}) {
    const msg = JSON.stringify({ jsonrpc: '2.0', method, params });
    this._process.stdin.write(msg + '\n');
  }

  async callTool(toolName, args) {
    if (!this.connected) throw new Error(`${this.name} 未连接`);
    return await this._send('tools/call', { name: toolName, arguments: args });
  }

  disconnect() {
    this._process?.kill();
    this.connected = false;
    for (const [, p] of this._pending) { clearTimeout(p.timeout); p.reject(new Error('断开')); }
    this._pending.clear();
  }
}

// ========== MCP 管理器 ==========

class MCPManager {
  constructor() {
    this.clients = new Map();
  }

  async loadConfig() {
    try {
      return JSON.parse(await fs.readFile(CONFIG_PATH, 'utf8'));
    } catch {
      return { servers: {} };
    }
  }

  async saveConfig(config) {
    await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
  }

  async init() {
    const config = await this.loadConfig();
    for (const [name, cfg] of Object.entries(config.servers || {})) {
      if (cfg.enabled === false) continue;
      try {
        await this.addServer(name, cfg);
      } catch (err) {
        console.error(`[MCP] 启动 ${name} 失败:`, err.message);
      }
    }
  }

  /**
   * 添加 MCP 服务器
   * @param {string} name - 服务器名称
   * @param {object|string} cfg - 配置对象 { url: "sse-url" } 或 { command: "path", args: [], env: {} }
   */
  async addServer(name, cfg) {
    if (this.clients.has(name)) {
      this.clients.get(name).disconnect();
    }

    let client;
    if (typeof cfg === 'string') {
      // 简写：字符串当作 SSE URL
      cfg = { url: cfg };
    }

    if (cfg.url) {
      client = new MCPSSEClient(name, cfg.url);
    } else if (cfg.command) {
      client = new MCPStdioClient(name, cfg.command, cfg.args || [], cfg.env || {});
    } else {
      throw new Error('配置必须包含 url (SSE) 或 command (Stdio)');
    }

    this.clients.set(name, client);
    await client.connect();

    // 保存配置
    const config = await this.loadConfig();
    config.servers = config.servers || {};
    config.servers[name] = cfg;
    await this.saveConfig(config);

    return client;
  }

  async removeServer(name) {
    const client = this.clients.get(name);
    if (client) { client.disconnect(); this.clients.delete(name); }
    const config = await this.loadConfig();
    delete config.servers?.[name];
    await this.saveConfig(config);
  }

  async reloadAll() {
    for (const [, c] of this.clients) c.disconnect();
    this.clients.clear();
    await this.init();
  }

  getAllTools() {
    const tools = [];
    for (const [name, client] of this.clients) {
      if (!client.connected) continue;
      for (const tool of client.tools) {
        tools.push({
          name: `mcp_${name}_${tool.name}`,
          description: `[MCP:${name}] ${tool.description || tool.name}`,
          input_schema: tool.inputSchema || { type: 'object', properties: {} },
        });
      }
    }
    return tools;
  }

  async callTool(fullName, args) {
    const match = fullName.match(/^mcp_(.+?)_(.+)$/);
    if (!match) throw new Error(`无效工具名: ${fullName}`);
    const [, serverName, toolName] = match;
    const client = this.clients.get(serverName);
    if (!client?.connected) throw new Error(`MCP ${serverName} 未连接`);
    const result = await client.callTool(toolName, args);
    if (result?.content) {
      return result.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    }
    return JSON.stringify(result);
  }

  getStatus() {
    const status = [];
    for (const [name, client] of this.clients) {
      status.push({
        name,
        transport: client.transport,
        url: client.url || client.command,
        connected: client.connected,
        tools: client.tools.map((t) => t.name),
      });
    }
    return status;
  }
}

export const mcpManager = new MCPManager();

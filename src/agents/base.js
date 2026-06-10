import { spawn } from 'child_process';
import { EventEmitter } from 'events';

/**
 * Agent 基类
 */
export class BaseAgent extends EventEmitter {
  constructor(name, config) {
    super();
    this.name = name;
    this.config = config;
    this.type = 'base';
    this.busy = false;
  }

  /**
   * 执行任务
   */
  async execute(prompt, options = {}) {
    throw new Error('子类必须实现 execute() 方法');
  }

  /**
   * 停止当前任务
   */
  async stop() {
    throw new Error('子类必须实现 stop() 方法');
  }

  /**
   * 获取状态
   */
  getStatus() {
    return {
      name: this.name,
      type: this.type,
      busy: this.busy,
    };
  }
}

/**
 * Claude API Agent
 * 直接调用 Claude API
 */
export class ClaudeAPIAgent extends BaseAgent {
  constructor(name, config) {
    super(name, config);
    this.type = 'claude-api';
    this.client = null;
  }

  async init() {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    this.client = new Anthropic({
      apiKey: this.config.apiKey || this.config.authToken,
      baseURL: this.config.baseUrl || undefined,
    });
  }

  async execute(prompt, options = {}) {
    if (!this.client) await this.init();
    
    this.busy = true;
    this.emit('start', { prompt });

    try {
      const response = await this.client.messages.create({
        model: this.config.model || 'claude-sonnet-4-20250514',
        max_tokens: options.maxTokens || 4096,
        messages: [{ role: 'user', content: prompt }],
      });

      const result = response.content[0]?.text || '';
      this.emit('complete', { result });
      return result;
    } catch (err) {
      this.emit('error', { error: err.message });
      throw err;
    } finally {
      this.busy = false;
    }
  }

  async stop() {
    // Claude API 不支持中断请求
    this.busy = false;
  }
}

/**
 * Claude Code CLI Agent
 * 调用本地 Claude Code CLI
 */
export class ClaudeCodeAgent extends BaseAgent {
  constructor(name, config) {
    super(name, config);
    this.type = 'claude-code';
    this.process = null;
  }

  async execute(prompt, options = {}) {
    this.busy = true;
    this.emit('start', { prompt });

    return new Promise((resolve, reject) => {
      const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose'];
      const env = { ...process.env };

      if (this.config.authToken) env.ANTHROPIC_AUTH_TOKEN = this.config.authToken;
      if (this.config.baseUrl) env.ANTHROPIC_BASE_URL = this.config.baseUrl;
      if (this.config.model) env.ANTHROPIC_MODEL = this.config.model;

      console.log(`[ClaudeCode] 执行: claude -p "${prompt.substring(0, 60)}..."`);

      this.process = spawn('claude', args, {
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true,
      });

      let finalText = '';
      const bashCommands = [];
      let isTruncated = false;

      this.process.stdout.on('data', (data) => {
        const lines = data.toString().split('\n').filter(l => l.trim());
        
        for (const line of lines) {
          try {
            const msg = JSON.parse(line);
            
            if (msg.type === 'assistant' && msg.message?.content) {
              for (const block of msg.message.content) {
                if (block.type === 'tool_use') {
                  const cmd = block.input?.command || JSON.stringify(block.input);
                  bashCommands.push(cmd);
                  this.emit('progress', { status: `$ ${cmd.substring(0, 60)}` });
                }
                if (block.type === 'text') {
                  finalText = block.text;
                }
              }
            }

            if (msg.type === 'result' && msg.result) {
              finalText = msg.result;
              // 检测是否因为 token 限制被截断
              if (msg.stop_reason === 'max_tokens') {
                isTruncated = true;
              }
            }

            // 检测 assistant 消息中的 stop_reason
            if (msg.type === 'assistant' && msg.message?.stop_reason) {
              if (msg.message.stop_reason === 'max_tokens') {
                isTruncated = true;
              }
            }
          } catch {
            // 非 JSON 行忽略
          }
        }
      });

      this.process.stderr.on('data', (data) => {
        console.log(`[ClaudeCode:stderr] ${data.toString().trim()}`);
      });

      const timeout = options.timeout || 300000;
      const timer = setTimeout(() => {
        this.process.kill();
        reject(new Error('执行超时'));
      }, timeout);

      this.process.on('close', (code) => {
        clearTimeout(timer);
        this.busy = false;

        if (code !== 0 && !finalText) {
          this.emit('error', { error: `退出码 ${code}` });
          reject(new Error(`Claude Code 退出码 ${code}`));
          return;
        }

        // 检测是否因为 token 限制被截断
        if (isTruncated) {
          finalText += '\n\n⚠️ 任务因输出 Token 限制被截断，可能未完成。如需完整执行，请简化任务或分步执行。';
        }

        this.emit('complete', { result: finalText, truncated: isTruncated });
        resolve(finalText);
      });

      this.process.on('error', (err) => {
        clearTimeout(timer);
        this.busy = false;
        this.emit('error', { error: err.message });
        reject(err);
      });
    });
  }

  async stop() {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.busy = false;
  }
}

/**
 * Codex CLI Agent (OpenAI)
 */
export class CodexAgent extends BaseAgent {
  constructor(name, config) {
    super(name, config);
    this.type = 'codex';
    this.process = null;
  }

  async execute(prompt, options = {}) {
    this.busy = true;
    this.emit('start', { prompt });

    return new Promise((resolve, reject) => {
      const args = [prompt];
      const env = { ...process.env };

      if (this.config.apiKey) env.OPENAI_API_KEY = this.config.apiKey;

      console.log(`[Codex] 执行: codex "${prompt.substring(0, 60)}..."`);

      this.process = spawn('codex', args, {
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true,
      });

      let output = '';

      this.process.stdout.on('data', (data) => {
        output += data.toString();
        this.emit('progress', { status: data.toString().substring(0, 100) });
      });

      this.process.stderr.on('data', (data) => {
        console.log(`[Codex:stderr] ${data.toString().trim()}`);
      });

      const timeout = options.timeout || 300000;
      const timer = setTimeout(() => {
        this.process.kill();
        reject(new Error('执行超时'));
      }, timeout);

      this.process.on('close', (code) => {
        clearTimeout(timer);
        this.busy = false;

        if (code !== 0) {
          this.emit('error', { error: `退出码 ${code}` });
          reject(new Error(`Codex 退出码 ${code}`));
          return;
        }

        this.emit('complete', { result: output });
        resolve(output);
      });

      this.process.on('error', (err) => {
        clearTimeout(timer);
        this.busy = false;
        this.emit('error', { error: err.message });
        reject(err);
      });
    });
  }

  async stop() {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.busy = false;
  }
}

/**
 * Gemini CLI Agent
 */
export class GeminiAgent extends BaseAgent {
  constructor(name, config) {
    super(name, config);
    this.type = 'gemini';
    this.process = null;
  }

  async execute(prompt, options = {}) {
    this.busy = true;
    this.emit('start', { prompt });

    return new Promise((resolve, reject) => {
      const args = ['-p', prompt];
      const env = { ...process.env };

      if (this.config.apiKey) env.GEMINI_API_KEY = this.config.apiKey;

      console.log(`[Gemini] 执行: gemini "${prompt.substring(0, 60)}..."`);

      this.process = spawn('gemini', args, {
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true,
      });

      let output = '';

      this.process.stdout.on('data', (data) => {
        output += data.toString();
        this.emit('progress', { status: data.toString().substring(0, 100) });
      });

      this.process.stderr.on('data', (data) => {
        console.log(`[Gemini:stderr] ${data.toString().trim()}`);
      });

      const timeout = options.timeout || 300000;
      const timer = setTimeout(() => {
        this.process.kill();
        reject(new Error('执行超时'));
      }, timeout);

      this.process.on('close', (code) => {
        clearTimeout(timer);
        this.busy = false;

        if (code !== 0) {
          this.emit('error', { error: `退出码 ${code}` });
          reject(new Error(`Gemini 退出码 ${code}`));
          return;
        }

        this.emit('complete', { result: output });
        resolve(output);
      });

      this.process.on('error', (err) => {
        clearTimeout(timer);
        this.busy = false;
        this.emit('error', { error: err.message });
        reject(err);
      });
    });
  }

  async stop() {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.busy = false;
  }
}

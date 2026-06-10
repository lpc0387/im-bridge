import { spawn } from 'child_process';
import { config } from './config.js';

/**
 * 解析 @@命令 格式: @@密码 命令内容
 */
export function parseCliCommand(message) {
  const trimmed = message.trim();
  if (!trimmed.startsWith('@@')) return { valid: false };

  const rest = trimmed.slice(2);
  const spaceIdx = rest.indexOf(' ');
  if (spaceIdx === -1) {
    return { valid: false, error: '格式: @@密码 命令内容' };
  }

  const password = rest.slice(0, spaceIdx);
  const command = rest.slice(spaceIdx + 1).trim();

  if (!password || !command) {
    return { valid: false, error: '格式: @@密码 命令内容' };
  }

  return { valid: true, password, command };
}

/**
 * 验证密码
 */
export function verifyPassword(inputPassword) {
  const expected = config.cli.password;
  if (!expected) return false;
  return inputPassword === expected;
}

/**
 * 执行 Claude Code CLI 命令
 * @param {string} command - 用户的 prompt
 * @param {function} onStatus - 状态回调
 * @param {number} timeoutMs - 超时毫秒数
 * @returns {Promise<{output: string, duration: number}>}
 */
export function executeCliCommand(command, onStatus, timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    const args = ['-p', command, '--output-format', 'text'];
    const env = { ...process.env };

    if (config.anthropic.authToken) env.ANTHROPIC_AUTH_TOKEN = config.anthropic.authToken;
    if (config.anthropic.baseUrl) env.ANTHROPIC_BASE_URL = config.anthropic.baseUrl;
    if (config.anthropic.model) env.ANTHROPIC_MODEL = config.anthropic.model;

    const startTime = Date.now();
    console.log(`[CLI] 执行: claude -p "${command.substring(0, 60)}..."`);
    if (onStatus) onStatus('正在启动 CLI...');

    const proc = spawn('claude', args, {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
    });

    let stdout = '';
    let stderr = '';
    let lastProgressTime = startTime;

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
      // 每 10 秒发送一次进度
      const now = Date.now();
      if (onStatus && now - lastProgressTime > 10000) {
        lastProgressTime = now;
        const elapsed = Math.round((now - startTime) / 1000);
        onStatus(`CLI 执行中... (${elapsed}s)`);
      }
      if (stdout.length > 100000) {
        proc.kill();
        stdout += '\n...(输出被截断，超过 100KB)';
      }
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error('CLI 执行超时（5分钟）'));
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timer);
      const duration = Math.round((Date.now() - startTime) / 1000);
      if (code === 0 || stdout.length > 0) {
        resolve({ output: stdout.trim() || '(无输出)', duration });
      } else {
        reject(new Error(`CLI 退出码 ${code} (${duration}s): ${stderr.trim()}`));
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`CLI 启动失败: ${err.message}`));
    });
  });
}

/**
 * 处理完整的 @@命令 流程
 * @param {string} message - 原始消息
 * @param {function} onStatus - 状态回调
 * @returns {Promise<string>}
 */
export async function handleCliPassthrough(message, onStatus) {
  const parsed = parseCliCommand(message);

  if (!parsed.valid) {
    return parsed.error || '❌ 格式错误。用法: @@密码 命令内容';
  }

  if (!verifyPassword(parsed.password)) {
    return '❌ 密码错误';
  }

  try {
    if (onStatus) onStatus(`🖥️ 执行 CLI: ${parsed.command.substring(0, 50)}...`);
    const { output, duration } = await executeCliCommand(parsed.command, onStatus);
    return `🖥️ CLI 执行完成 (${duration}s)\n\n${output}`;
  } catch (err) {
    return `❌ ${err.message}`;
  }
}

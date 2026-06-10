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
  if (spaceIdx === -1) return { valid: false, error: '格式: @@密码 命令内容' };

  const password = rest.slice(0, spaceIdx);
  const command = rest.slice(spaceIdx + 1).trim();

  if (!password || !command) return { valid: false, error: '格式: @@密码 命令内容' };

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
 * 执行 Claude Code CLI 命令（流式解析，不缓存全部输出）
 */
export function executeCliCommand(command, onStatus, timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    const args = ['-p', command, '--output-format', 'stream-json', '--verbose'];
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

    // 边读边解析，只保留需要的数据
    let buffer = '';
    let lastProgressTime = startTime;
    const bashCommands = [];
    let finalText = '';

    proc.stdout.on('data', (data) => {
      buffer += data.toString();

      // 按行处理
      const lines = buffer.split('\n');
      buffer = lines.pop(); // 保留不完整的最后一行

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);

          // 提取工具调用
          if (msg.type === 'assistant' && msg.message?.content) {
            for (const block of msg.message.content) {
              if (block.type === 'tool_use') {
                const name = block.name;
                const input = block.input || {};
                if (name === 'Bash' || name === 'bash' || name === 'run_command') {
                  const cmd = input.command || JSON.stringify(input);
                  bashCommands.push(cmd);
                  if (onStatus) onStatus(`$ ${cmd.substring(0, 60)}`);
                } else {
                  bashCommands.push(`[${name}] ${JSON.stringify(input).substring(0, 80)}`);
                }
              }
              if (block.type === 'text') {
                finalText = block.text;
              }
            }
          }

          // 最终结果
          if (msg.type === 'result' && msg.result) {
            finalText = msg.result;
          }
        } catch {
          // 非 JSON 行忽略
        }
      }

      // 进度反馈
      const now = Date.now();
      if (onStatus && now - lastProgressTime > 10000) {
        lastProgressTime = now;
        const elapsed = Math.round((now - startTime) / 1000);
        onStatus(`CLI 执行中... (${elapsed}s)`);
      }
    });

    proc.stderr.on('data', (data) => {
      // stderr 只记日志，不缓存
      const msg = data.toString().trim();
      if (msg) console.log(`[CLI:stderr] ${msg}`);
    });

    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error('CLI 执行超时（5分钟）'));
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timer);
      const duration = Math.round((Date.now() - startTime) / 1000);

      if (code !== 0 && !finalText) {
        reject(new Error(`CLI 退出码 ${code} (${duration}s)`));
        return;
      }

      // 组装输出
      let result = '';
      if (bashCommands.length > 0) {
        result += '📋 执行的命令:\n';
        bashCommands.forEach((cmd, i) => {
          result += `  ${i + 1}. $ ${cmd}\n`;
        });
        result += '\n';
      }
      result += finalText.trim() || '(无输出)';

      resolve({ output: result, duration });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`CLI 启动失败: ${err.message}`));
    });
  });
}

/**
 * 处理完整的 @@命令 流程
 */
export async function handleCliPassthrough(message, onStatus) {
  const parsed = parseCliCommand(message);

  if (!parsed.valid) return parsed.error || '❌ 格式错误。用法: @@密码 命令内容';
  if (!verifyPassword(parsed.password)) return '❌ 密码错误';

  try {
    if (onStatus) onStatus(`🖥️ 执行 CLI: ${parsed.command.substring(0, 50)}...`);
    const { output, duration } = await executeCliCommand(parsed.command, onStatus);
    return `🖥️ CLI 执行完成 (${duration}s)\n\n${output}`;
  } catch (err) {
    return `❌ ${err.message}`;
  }
}

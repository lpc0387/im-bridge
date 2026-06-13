import { spawn } from 'child_process';
import { config } from './config.js';
import { classifyDeliverableFile, dedupeFiles, extractWorkspacePaths, stripKnownPaths } from './file-delivery.js';

// 存储每个用户的CLI会话ID (userId -> sessionId)
const cliSessions = new Map();

/**
 * 获取用户的CLI会话ID
 */
export function getCliSessionId(userId) {
  return cliSessions.get(userId) || null;
}

/**
 * 保存用户的CLI会话ID
 */
export function saveCliSessionId(userId, sessionId) {
  if (userId && sessionId) {
    cliSessions.set(userId, sessionId);
    console.log(`[CLI] 保存会话ID: ${userId} -> ${sessionId}`);
  }
}

/**
 * 清除用户的CLI会话ID
 */
export function clearCliSessionId(userId) {
  cliSessions.delete(userId);
  console.log(`[CLI] 清除会话ID: ${userId}`);
}

/**
 * 解析 @@命令 格式: @@密码 命令内容 或 @@密码（接入上次会话）
 */
export function parseCliCommand(message) {
  const trimmed = message.trim();
  if (!trimmed.startsWith('@@')) return { valid: false };

  const rest = trimmed.slice(2);
  const spaceIdx = rest.indexOf(' ');

  // 如果没有空格，说明只有密码，命令为空（用于接入上次会话）
  if (spaceIdx === -1) {
    const password = rest.trim();
    if (!password) return { valid: false, error: '格式: @@密码 命令内容 或 @@密码（接入上次会话）' };
    return { valid: true, password, command: '', isResumeOnly: true };
  }

  const password = rest.slice(0, spaceIdx);
  const command = rest.slice(spaceIdx + 1).trim();

  if (!password) return { valid: false, error: '格式: @@密码 命令内容 或 @@密码（接入上次会话）' };

  // 如果有密码但命令为空，也视为接入上次会话
  if (!command) {
    return { valid: true, password, command: '', isResumeOnly: true };
  }

  return { valid: true, password, command, isResumeOnly: false };
}

/**
 * 验证密码
 */
export function verifyPassword(inputPassword) {
  const expected = config.cli.password;
  if (!expected) return false;
  return inputPassword === expected;
}

function textResult(text) {
  return { text, files: [] };
}

async function buildDeliverableFiles(candidateFiles, outputText = '') {
  const candidates = new Set(candidateFiles);
  for (const filePath of extractWorkspacePaths(outputText)) {
    candidates.add(filePath);
  }

  const files = [];
  for (const filePath of candidates) {
    const classified = await classifyDeliverableFile(filePath);
    if (classified.ok) {
      files.push(classified.file);
    } else {
      console.log(`[CLI] 跳过文件下发 ${filePath}: ${classified.reason}`);
    }
  }
  return dedupeFiles(files);
}

function collectToolFile(name, input) {
  const fileTools = new Set(['Write', 'write_file', 'Edit', 'edit_file', 'NotebookEdit', 'notebook_edit']);
  if (!fileTools.has(name)) return '';
  return input.file_path || input.path || input.notebook_path || '';
}

/**
 * 执行 Claude Code CLI 命令（流式解析，不缓存全部输出）
 * @param {string} command - 要执行的命令
 * @param {Function} onStatus - 状态回调
 * @param {string|null} sessionId - 可选的会话ID，用于恢复会话
 */
export function executeCliCommand(command, onStatus, sessionId = null) {
  return new Promise((resolve, reject) => {
    let args;
    if (sessionId) {
      // 恢复已有会话
      args = ['--resume', sessionId, '-p', command, '--output-format', 'stream-json', '--verbose', '--permission-mode', 'auto'];
      console.log(`[CLI] 恢复会话 ${sessionId}: claude --resume ${sessionId} -p "${command.substring(0, 60)}..."`);
    } else {
      // 新建会话
      args = ['-p', command, '--output-format', 'stream-json', '--verbose', '--permission-mode', 'auto'];
      console.log(`[CLI] 新建会话: claude -p "${command.substring(0, 60)}..."`);
    }
    const env = { ...process.env };

    if (config.anthropic.authToken) env.ANTHROPIC_AUTH_TOKEN = config.anthropic.authToken;
    if (config.anthropic.baseUrl) env.ANTHROPIC_BASE_URL = config.anthropic.baseUrl;
    if (config.anthropic.model) env.ANTHROPIC_MODEL = config.anthropic.model;

    const startTime = Date.now();
    const stallTimeout = 3 * 60 * 1000; // 3 分钟无输出视为卡死
    console.log(`[CLI] 执行: claude -p "${command.substring(0, 60)}..."`);
    if (onStatus) onStatus('正在启动 CLI...');

    const proc = spawn('claude', args, {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    });

    // 边读边解析，只保留需要的数据
    let buffer = '';
    let lastOutputTime = startTime;
    const bashCommands = [];
    const candidateFiles = new Set();
    let finalText = '';
    let stopReason = null;
    let isTruncated = false;
    let killed = false;
    let sessionIdOut = null; // 从输出中提取的session_id

    // 静默超时检测 — 每 30 秒检查一次
    const stallTimer = setInterval(() => {
      if (killed) return;
      const silentMs = Date.now() - lastOutputTime;
      if (silentMs > stallTimeout) {
        killed = true;
        clearInterval(stallTimer);
        console.warn(`[CLI] 静默超时 (${Math.round(silentMs/1000)}s 无输出)，自动 kill`);
        proc.kill('SIGTERM');
        if (onStatus) onStatus('⚠️ 执行超时（3分钟无输出），已自动终止');
      } else if (silentMs > stallTimeout * 0.5) {
        const remaining = Math.round((stallTimeout - silentMs) / 1000);
        if (onStatus) onStatus(`⏳ 已静默 ${Math.round(silentMs/1000)}s，${remaining}s 后自动终止...`);
      }
    }, 30000);

    proc.stdout.on('data', (data) => {
      buffer += data.toString();
      lastOutputTime = Date.now(); // 有输出，重置静默计时

      // 按行处理
      const lines = buffer.split('\n');
      buffer = lines.pop(); // 保留不完整的最后一行

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);

          // 提取session_id
          if (msg.session_id && !sessionIdOut) {
            sessionIdOut = msg.session_id;
          }

          // 提取工具调用
          if (msg.type === 'assistant' && msg.message?.content) {
            for (const block of msg.message.content) {
              if (block.type === 'tool_use') {
                const name = block.name;
                const input = block.input || {};
                if (name === 'Bash' || name === 'bash' || name === 'run_command') {
                  const cmd = input.command || JSON.stringify(input);
                  bashCommands.push(cmd);
                  if (onStatus) onStatus(`$ ${cmd.substring(0, 80)}`);
                } else if (name === 'Write' || name === 'write_file') {
                  const filePath = collectToolFile(name, input);
                  if (filePath) candidateFiles.add(filePath);
                  if (onStatus) onStatus(`📝 写入: ${filePath.split('/').pop()}`);
                } else if (name === 'Edit' || name === 'edit_file' || name === 'NotebookEdit' || name === 'notebook_edit') {
                  const filePath = collectToolFile(name, input);
                  if (filePath) candidateFiles.add(filePath);
                  if (onStatus) onStatus(`✏️ 编辑: ${filePath.split('/').pop()}`);
                } else if (name === 'Read' || name === 'read_file') {
                  const filePath = input.file_path || input.path || '';
                  if (onStatus) onStatus(`📖 读取: ${filePath.split('/').pop()}`);
                } else {
                  if (onStatus) onStatus(`🔧 ${name}`);
                }
              }
              if (block.type === 'text') {
                finalText = block.text;
              }
            }
          }

          // 权限请求事件
          if (msg.type === 'permission_request') {
            const tool = msg.tool || msg.permission?.tool || '未知操作';
            const desc = msg.description || msg.permission?.description || '';
            if (onStatus) onStatus(`🔐 需要权限: ${tool} ${desc.substring(0, 40)}`);
          }

          // 最终结果
          if (msg.type === 'result' && msg.result) {
            finalText = msg.result;
            // 检测是否因为 token 限制被截断
            if (msg.stop_reason === 'max_tokens') {
              isTruncated = true;
              stopReason = 'max_tokens';
            }
          }

          // 检测 assistant 消息中的 stop_reason
          if (msg.type === 'assistant' && msg.message?.stop_reason) {
            if (msg.message.stop_reason === 'max_tokens') {
              isTruncated = true;
              stopReason = 'max_tokens';
            }
          }
        } catch {
          // 非 JSON 行忽略
        }
      }

      // 进度反馈
      const now = Date.now();
      if (onStatus && now - lastOutputTime > 10000) {
        const elapsed = Math.round((now - startTime) / 1000);
        onStatus(`CLI 执行中... (${elapsed}s)`);
      }
    });

    proc.stderr.on('data', (data) => {
      // stderr 只记日志，不缓存
      const msg = data.toString().trim();
      if (msg) console.log(`[CLI:stderr] ${msg}`);
    });

    proc.on('close', async (code) => {
      clearInterval(stallTimer);
      const duration = Math.round((Date.now() - startTime) / 1000);

      // 被静默超时 kill
      if (killed) {
        let result = '';
        if (bashCommands.length > 0) {
          result += '📋 已执行的命令:\n';
          bashCommands.forEach((cmd, i) => { result += `  ${i + 1}. $ ${cmd}\n`; });
          result += '\n';
        }
        result += finalText ? `⚠️ 部分结果:\n${finalText}` : '（无输出）';
        result += '\n\n💡 任务因 3 分钟无输出被自动终止。如需继续，请重新发送命令。';
        const files = await buildDeliverableFiles(candidateFiles, result);
        result = stripKnownPaths(result, files);
        resolve({ output: result, files, duration, stalled: true, sessionId: sessionIdOut });
        return;
      }

      if (code !== 0 && !finalText) {
        reject(new Error(`CLI 退出码 ${code} (${duration}s)`));
        return;
      }

      // 组装输出
      let result = '';
      if (bashCommands.length > 0) {
        result += '📋 执行的命令:\n';
        bashCommands.forEach((cmd, i) => { result += `  ${i + 1}. $ ${cmd}\n`; });
        result += '\n';
      }
      result += finalText.trim() || '(无输出)';

      if (isTruncated) {
        result += '\n\n⚠️ 任务因输出 Token 限制被截断，可能未完成。如需完整执行，请简化任务或分步执行。';
      }

      const files = await buildDeliverableFiles(candidateFiles, result);
      result = stripKnownPaths(result, files);
      resolve({ output: result, files, duration, truncated: isTruncated, stopReason, bashCommands, sessionId: sessionIdOut });
    });

    proc.on('error', (err) => {
      clearInterval(stallTimer);
      reject(new Error(`CLI 启动失败: ${err.message}`));
    });
  });
}

/**
 * 处理完整的 @@命令 流程（带断点续传）
 * 卡死后自动重试，带上已执行上下文，最多重试 2 次
 * @param {string} message - 完整的@@命令消息
 * @param {Function} onStatus - 状态回调
 * @param {string|null} userId - 用户ID，用于会话恢复
 */
export async function handleCliPassthrough(message, onStatus, userId = null) {
  const parsed = parseCliCommand(message);

  if (!parsed.valid) return textResult(parsed.error || '❌ 格式错误。用法: @@密码 命令内容 或 @@密码（接入上次会话）');
  if (!verifyPassword(parsed.password)) return textResult('❌ 密码错误');

  // 处理 CLI 子命令（/new 强制新建会话，/clear 清除会话）
  const cliCmd = parsed.command.trim();
  if (cliCmd === '/new' || cliCmd.startsWith('/new ')) {
    if (userId) clearCliSessionId(userId);
    const realCommand = cliCmd.slice(4).trim();
    if (!realCommand) {
      return textResult('✅ 已开启新的CLI会话，下次发送 @@密码 命令内容 将创建新会话');
    }
    // 用 /new 后面的内容作为实际命令，继续执行（会话已清除，会新建）
    parsed.command = realCommand;
  } else if (cliCmd === '/clear') {
    if (userId) clearCliSessionId(userId);
    return textResult('✅ CLI会话已清空，下次@@命令将创建新会话');
  }

  // 获取用户的CLI会话ID（用于恢复会话）
  const existingSessionId = userId ? getCliSessionId(userId) : null;
  if (existingSessionId) {
    console.log(`[CLI] 用户 ${userId} 有现有会话: ${existingSessionId}`);
  }

  // 处理只输入密码的情况（接入上次会话）
  if (parsed.isResumeOnly) {
    if (!existingSessionId) {
      return textResult('❌ 没有找到上次会话。请先使用 @@密码 命令内容 执行一次命令来创建会话。');
    }

    // 使用默认命令恢复会话
    const resumeCommand = '继续';
    if (onStatus) onStatus(`🖥️ 接入上次会话: ${existingSessionId}`);

    try {
      const result = await executeCliCommand(resumeCommand, onStatus, existingSessionId);

      // 保存新的session_id（如果有的话）
      if (result.sessionId && userId) {
        saveCliSessionId(userId, result.sessionId);
      }

      const statusIcon = result.truncated ? '⚠️' : '🖥️';
      const statusText = result.truncated ? '会话已接入（输出被截断）' : '会话已接入';
      const sessionNote = `\n📌 会话ID: ${existingSessionId}`;
      return { text: `${statusIcon} ${statusText} (${result.duration}s)\n\n${result.output}${sessionNote}`, files: result.files || [] };
    } catch (err) {
      return textResult(`❌ 接入会话失败: ${err.message}`);
    }
  }

  // 正常的命令执行流程
  const maxRetries = 2;
  let attempt = 0;
  let lastOutput = '';
  let currentSessionId = existingSessionId;
  const allFiles = [];

  while (attempt <= maxRetries) {
    attempt++;
    try {
      const label = attempt === 1 ? '执行' : `断点续传 (${attempt}/${maxRetries + 1})`;
      const sessionInfo = currentSessionId ? ' (恢复会话)' : ' (新会话)';
      if (onStatus) onStatus(`🖥️ ${label}${sessionInfo}: ${parsed.command.substring(0, 50)}...`);

      // 重试时带上上次的上下文
      let command = parsed.command;
      if (attempt > 1 && lastOutput) {
        command = `继续之前的任务。原始指令：${parsed.command}\n\n上次已执行的结果（从断点继续，不要重复执行已完成的部分）：\n${lastOutput.substring(0, 2000)}`;
      }

      const result = await executeCliCommand(command, onStatus, currentSessionId);
      allFiles.push(...(result.files || []));

      // 保存新的session_id
      if (result.sessionId && userId) {
        saveCliSessionId(userId, result.sessionId);
        currentSessionId = result.sessionId;
      }

      if (result.stalled && attempt <= maxRetries) {
        lastOutput = result.output;
        if (onStatus) onStatus(`⚠️ 任务卡死 (${attempt}/${maxRetries + 1})，正在自动续传...`);
        continue;
      }

      // 正常完成或最后一次重试
      const files = dedupeFiles(allFiles);
      const statusIcon = result.truncated ? '⚠️' : '🖥️';
      const statusText = result.truncated ? 'CLI 执行被截断' : 'CLI 执行完成';
      const retryNote = attempt > 1 ? `，经过 ${attempt} 次尝试` : '';
      const sessionNote = currentSessionId ? `\n📌 会话ID: ${currentSessionId}` : '';
      const text = stripKnownPaths(`${statusIcon} ${statusText} (${result.duration}s${retryNote})\n\n${result.output}${sessionNote}`, files);
      return { text, files };
    } catch (err) {
      if (attempt <= maxRetries) {
        if (onStatus) onStatus(`❌ 执行失败 (${attempt}/${maxRetries + 1})，正在重试...`);
        continue;
      }
      return textResult(`❌ ${err.message}`);
    }
  }
}

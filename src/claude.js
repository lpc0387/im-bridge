import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';
import { config } from './config.js';
import { mcpManager } from './mcp-client.js';

const client = new Anthropic({
  apiKey: config.anthropic.apiKey || config.anthropic.authToken,
  baseURL: config.anthropic.baseUrl || undefined,
});

// 每个用户独立的对话历史
const conversations = new Map();

// 系统提示词
const SYSTEM_PROMPT = `你是一个运行在用户电脑上的智能助手，通过IM工具与用户对话。
你有能力访问用户电脑上的文件和执行命令。
请用简洁友好的中文回复。如果消息很长，适当分段。
支持 Markdown 格式。

当前日期：${new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}

重要规则：
- 当用户问"今天"相关的问题时，必须使用上面提供的当前日期，不要从搜索结果中推断日期
- 搜索新闻时，在搜索词中加入具体日期以获取最新结果
- 读取文件时，如果文件太大，只返回前面部分内容
- 执行命令时，输出太长会被截断
- 不要执行危险命令（如删除系统文件、格式化等）

## MCP 工具管理能力

你可以帮用户安装和管理 MCP 工具：

1. **搜索 MCP 工具**: 用 web_search 搜索 "mcp-server-xxx npm" 或 "xxx MCP server github"
2. **安装 npm 包**: 用 run_command 执行 npm install
3. **注册 MCP 服务器**: 用 install_mcp 工具将新 MCP 服务器注册到配置中
4. **查看已安装**: 用 list_mcps 工具查看当前所有 MCP 服务器

当用户说"帮我找一个xxx的MCP工具"时：
1. 先搜索找到合适的 MCP 包
2. 确认后用 install_mcp 安装并注册
3. 安装完成后立即可用，无需重启`;

// ========== 工具定义 ==========

const TOOLS = [
  {
    name: 'read_file',
    description: '读取用户电脑上的文件内容。可以读取文本文件、代码文件等。',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件的绝对路径或相对于用户主目录的路径' },
        max_lines: { type: 'number', description: '最多读取的行数，默认200', default: 200 },
      },
      required: ['path'],
    },
  },
  {
    name: 'list_dir',
    description: '列出目录下的文件和子目录。',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '目录路径，默认为用户主目录' },
      },
      required: [],
    },
  },
  {
    name: 'run_command',
    description: '在用户电脑上执行 shell 命令（Windows 环境）。禁止执行危险命令。',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '要执行的命令' },
        cwd: { type: 'string', description: '工作目录，默认为用户主目录' },
      },
      required: ['command'],
    },
  },
  {
    name: 'write_file',
    description: '向用户电脑写入文件。',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径' },
        content: { type: 'string', description: '文件内容' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'install_mcp',
    description: '安装并注册一个新的 MCP 服务器到配置中。安装后立即生效，无需重启。',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'MCP 服务器名称（英文，简短）' },
        type: { type: 'string', enum: ['npm', 'command', 'sse'], description: '类型：npm=npm包, command=本地命令, sse=远程SSE' },
        package: { type: 'string', description: 'npm 包名（type=npm 时必填）' },
        command: { type: 'string', description: '可执行命令路径（type=command 时必填）' },
        url: { type: 'string', description: 'SSE 端点 URL（type=sse 时必填）' },
        args: { type: 'array', items: { type: 'string' }, description: '额外参数', default: [] },
        env: { type: 'object', description: '环境变量', default: {} },
      },
      required: ['name', 'type'],
    },
  },
  {
    name: 'list_mcps',
    description: '查看当前所有已注册的 MCP 服务器及其工具列表。',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'remove_mcp',
    description: '移除一个已注册的 MCP 服务器。',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '要移除的 MCP 服务器名称' },
      },
      required: ['name'],
    },
  },
];

// ========== 工具执行 ==========

const HOME_DIR = 'C:/Users/Administrator';

function resolvePath(p) {
  if (!p) return HOME_DIR;
  if (path.isAbsolute(p)) return p;
  return path.join(HOME_DIR, p);
}

async function executeTool(name, input) {
  try {
    switch (name) {
      case 'read_file': {
        const filePath = resolvePath(input.path);
        const maxLines = input.max_lines || 200;
        const content = await fs.readFile(filePath, 'utf8');
        const lines = content.split('\n');
        const truncated = lines.length > maxLines;
        const result = lines.slice(0, maxLines).join('\n');
        return truncated
          ? `（文件共 ${lines.length} 行，显示前 ${maxLines} 行）\n\n${result}`
          : result;
      }

      case 'list_dir': {
        const dirPath = resolvePath(input.path);
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        const items = entries.map((e) => ({
          name: e.name,
          type: e.isDirectory() ? '📁' : '📄',
        }));
        return items.map((i) => `${i.type} ${i.name}`).join('\n');
      }

      case 'run_command': {
        const cmd = input.command;
        // 安全检查：禁止危险命令
        const dangerous = ['format', 'del /s', 'rd /s', 'rmdir /s', 'rm -rf /', 'shutdown'];
        if (dangerous.some((d) => cmd.toLowerCase().includes(d))) {
          return '❌ 拒绝执行：该命令可能造成危险';
        }
        const cwd = resolvePath(input.cwd) || HOME_DIR;
        const output = execSync(cmd, {
          cwd,
          encoding: 'utf8',
          timeout: 15000,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        return output.length > 3000 ? output.substring(0, 3000) + '\n...(输出被截断)' : output;
      }

      case 'write_file': {
        const filePath = resolvePath(input.path);
        await fs.writeFile(filePath, input.content, 'utf8');
        return `✅ 已写入文件: ${filePath}`;
      }

      case 'install_mcp': {
        const { name, type, package: pkg, command, url, args = [], env = {} } = input;
        let mcpConfig = {};

        if (type === 'npm') {
          if (!pkg) return '❌ npm 类型必须指定 package';
          // 先安装 npm 包
          console.log(`[MCP Install] 安装 npm 包: ${pkg}`);
          const installResult = execSync(`npm install -g ${pkg}`, {
            encoding: 'utf8',
            timeout: 60000,
            windowsHide: true,
            shell: true,
          });
          console.log(`[MCP Install] ${installResult}`);
          // 找到包的入口
          const pkgPath = execSync(`npm root -g`, { encoding: 'utf8', shell: true }).trim();
          const pkgJson = JSON.parse(await fs.readFile(`${pkgPath}/${pkg}/package.json`, 'utf8'));
          const binEntry = pkgJson.bin ? Object.values(pkgJson.bin)[0] : pkgJson.main;
          const fullPath = `${pkgPath}/${pkg}/${binEntry}`;
          mcpConfig = { command: 'node', args: [fullPath, ...args], env };
        } else if (type === 'command') {
          if (!command) return '❌ command 类型必须指定 command';
          mcpConfig = { command, args, env };
        } else if (type === 'sse') {
          if (!url) return '❌ sse 类型必须指定 url';
          mcpConfig = { url };
        } else {
          return '❌ 未知类型，支持: npm, command, sse';
        }

        // 注册到 MCP 管理器
        await mcpManager.addServer(name, mcpConfig);
        const tools = mcpManager.clients.get(name)?.tools || [];
        return `✅ 已安装并注册 MCP: **${name}**\n类型: ${type}\n工具数: ${tools.length}\n工具: ${tools.map(t => t.name).join(', ')}`;
      }

      case 'list_mcps': {
        const status = mcpManager.getStatus();
        if (!status.length) return '📭 暂无 MCP 服务器';
        return status.map(s =>
          `**${s.name}** (${s.transport}) ${s.connected ? '🟢' : '🔴'}\n工具: ${s.tools.join(', ') || '无'}`
        ).join('\n\n');
      }

      case 'remove_mcp': {
        const { name } = input;
        if (!mcpManager.clients.has(name)) return `❌ 未找到 MCP 服务器: ${name}`;
        await mcpManager.removeServer(name);
        return `✅ 已移除 MCP: ${name}`;
      }

      default:
        return `未知工具: ${name}`;
    }
  } catch (err) {
    return `❌ 工具执行失败: ${err.message}`;
  }
}

// ========== 对话 ==========

function getHistory(userId) {
  if (!conversations.has(userId)) {
    conversations.set(userId, []);
  }
  const history = conversations.get(userId);
  while (history.length > 40) history.shift();
  return history;
}

/**
 * 发送消息给 Claude，支持工具调用循环
 */
export async function chat(userId, message) {
  const history = getHistory(userId);
  history.push({ role: 'user', content: message });

  // 合并内置工具 + MCP 工具
  const mcpTools = mcpManager.getAllTools();
  const allTools = [...TOOLS, ...mcpTools];

  const MAX_TOOL_ROUNDS = 8; // MCP 工具可能需要更多轮

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    try {
      console.log(`[Chat] 轮次 ${round + 1}/${MAX_TOOL_ROUNDS}, 历史长度: ${history.length}`);

      const response = await client.messages.create({
        model: config.anthropic.model,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools: allTools,
        messages: history,
      });

      console.log(`[Chat] stop_reason: ${response.stop_reason}, content blocks: ${response.content.length}`);
      // 调试：打印每个 block 的详细信息
      response.content.forEach((b, i) => {
        const info = { type: b.type };
        if (b.name) info.name = b.name;
        if (b.id) info.id = b.id;
        if (b.text) info.text = b.text.substring(0, 100);
        if (b.thinking) info.thinking = b.thinking.substring(0, 100);
        if (b.input) info.input = JSON.stringify(b.input).substring(0, 100);
        console.log(`[Chat]   block[${i}]:`, JSON.stringify(info));
      });

      // 把完整响应加入历史
      history.push({ role: 'assistant', content: response.content });

      // 方式1: 标准 tool_use 块
      const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use');

      // 方式2: 从 text 块中解析 XML 格式的工具调用（兼容 mimo 等非标准模型）
      const textBlocks = response.content.filter((b) => b.type === 'text');
      const parsedToolCalls = [];
      for (const block of textBlocks) {
        const matches = [...block.text.matchAll(/<tool_call>\n<function=([^>]+)>\n((?:<parameter=[^>]+>[^<]*<\/parameter>\n?)+)<\/function>\n<\/tool_call>/g)];
        for (const match of matches) {
          const funcName = match[1];
          const paramsStr = match[2];
          const params = {};
          const paramMatches = [...paramsStr.matchAll(/<parameter=([^>]+)>([^<]*)<\/parameter>/g)];
          for (const pm of paramMatches) {
            try { params[pm[1]] = JSON.parse(pm[2]); } catch { params[pm[1]] = pm[2]; }
          }
          parsedToolCalls.push({ name: funcName, input: params, id: `parsed_${round}_${parsedToolCalls.length}` });
        }
      }

      // 如果没有标准 tool_use，也没有解析到工具调用，返回文本
      if (toolUseBlocks.length === 0 && parsedToolCalls.length === 0) {
        const textParts = textBlocks.map((b) => b.text).join('\n');
        // 清理残留的 <tool_call> 标签
        const cleaned = textParts.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '').trim();
        console.log(`[Chat] 返回文本: ${cleaned.substring(0, 80)}...`);
        return cleaned || '(无回复)';
      }

      // 执行所有工具调用
      const toolResults = [];
      const allCalls = [...toolUseBlocks.map(b => ({ name: b.name, input: b.input, id: b.id, isStandard: true })),
                        ...parsedToolCalls.map(c => ({ ...c, isStandard: false }))];

      for (const call of allCalls) {
        console.log(`[Tool] ${call.name}(${JSON.stringify(call.input).substring(0, 80)})`);
        let result;
        try {
          if (call.name.startsWith('mcp_')) {
            result = await mcpManager.callTool(call.name, call.input);
          } else {
            result = await executeTool(call.name, call.input);
          }
        } catch (err) {
          result = `❌ 工具调用失败: ${err.message}`;
        }
        console.log(`[Tool] 结果: ${result.substring(0, 80)}...`);

        if (call.isStandard) {
          toolResults.push({ type: 'tool_result', tool_use_id: call.id, content: result });
        } else {
          // 非标准格式：以文本形式注入结果
          toolResults.push({ type: 'text', text: `[工具 ${call.name} 的返回结果]\n${result}` });
        }
      }

      // 把工具结果加入历史
      if (toolResults.some(r => r.type === 'tool_result')) {
        history.push({ role: 'user', content: toolResults });
      } else {
        // 非标准格式：合并为一条文本消息
        history.push({ role: 'user', content: toolResults.map(r => r.text).join('\n\n') });
      }

    } catch (err) {
      history.pop();
      console.error('[Claude API Error]', err.message);
      throw err;
    }
  }

  return '⚠️ 工具调用轮数已达上限';
}

export function clearHistory(userId) {
  conversations.delete(userId);
}

export function getTurnCount(userId) {
  const history = conversations.get(userId);
  if (!history) return 0;
  return Math.floor(history.filter((m) => m.role === 'user' && typeof m.content === 'string').length);
}

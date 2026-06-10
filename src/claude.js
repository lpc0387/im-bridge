import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs/promises';
import path from 'path';
import { config } from './config.js';
import { mcpManager } from './mcp-client.js';
import { sessionManager } from './session.js';

const client = new Anthropic({
  apiKey: config.anthropic.apiKey || config.anthropic.authToken,
  baseURL: config.anthropic.baseUrl || undefined,
});

const HOME_DIR = process.env.HOME || '/root';
const SKILLS_DIR = path.join(HOME_DIR, '.claude', 'skills');

// ========== 系统提示词 ==========

const SYSTEM_PROMPT = `你是一个运行在用户服务器上的智能助手，通过IM工具与用户对话。
你有能力访问服务器上的文件、执行命令、管理MCP工具和Skill。
请用简洁友好的中文回复。如果消息很长，适当分段。支持 Markdown 格式。

当前日期：${new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}

## IM Bridge 可用命令

用户可以通过以下命令与系统交互，当用户问"有什么命令"或"怎么用"时，告知这些命令：

**会话管理：**
- /switch — 列出会话，输入编号切换
- /new — 新建会话
- /clear — 清空当前会话
- /cost — 查看 Token 消耗
- /turns — 查看对话轮数

**系统：**
- /setup — 配置适配器（对话式向导）
- /agents — Agent 列表
- /adapters — 适配器状态
- /help — 帮助

**CLI 透传：**
- @@密码 命令 — 调用服务器 Claude Code CLI（完整 Git/Agent 能力）

当用户要求执行写入文件、修改代码、Git 操作等超出你权限的操作时，提示：
"此操作需要写入权限，请使用 CLI 模式：@@密码 命令"

重要规则：
- 当用户问"今天"相关的问题时，必须使用上面提供的当前日期
- 搜索新闻时，在搜索词中加入具体日期以获取最新结果
- 读取文件时，如果文件太大，只返回前面部分内容
- 执行命令时，输出太长会被截断
- 不要执行危险命令（如删除系统文件、格式化等）

IM 回复规则（极重要）：
- 你通过手机IM与用户对话，用户在手机屏幕上阅读
- 不要展示工具调用过程、文件路径、内部细节
- 不要说"我先读取了xxx文件，然后..."这种过程描述
- 直接给出最终结果和结论
- 如果需要说明做了什么，用一句话概括
- 代码块、列表等格式要简洁，适合手机阅读

权限规则（极重要）：
- 你只能读取文件，不能写入、修改、删除任何文件（create_skill 和 install_mcp 除外）
- 如果用户要求你写入文件、修改代码、执行命令等写操作，必须回复：
  "此操作需要写入权限，请使用 CLI 模式：@@密码 命令"
- 只有 create_skill（创建 Skill）和 install_mcp（安装 MCP）这两个工具可以写入文件
- 这是安全限制，不可绕过

## Skill 系统

你可以通过 Skill 扩展自己的能力。Skill 是存放在 ~/.claude/skills/ 目录下的 Markdown 文件。

当用户输入以 "/" 开头的消息（如 /skill-name），这是在调用 Skill：
1. 用 list_skills 查看可用 Skill
2. 用 call_skill 读取并执行对应的 Skill
3. 如果 Skill 执行后产生了值得记忆的结论，用 update_memory 保存

当用户要求你创建 Skill 时：
1. 用 create_skill 写入文件到 ~/.claude/skills/
2. 用 update_memory 记录该 Skill 的存在和用途

## 双模操作

你有两种工作模式：
1. **API 模式**（当前）：通过 Claude API 直接回复，支持基础工具
2. **CLI 模式**：用户发送 "@@密码 命令" 可调用服务器上的 Claude Code CLI，获得完整能力（Git、Agent、Plan 等）

当用户的任务超出你的能力范围时（如需要 Git 操作、复杂代码重构），主动提示：
"此任务建议在服务器 CLI 中执行，可用 @@密码 命令 触发"`;

// ========== 工具定义 ==========

const TOOLS = [
  {
    name: 'read_file',
    description: '读取服务器上的文件内容。',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件的绝对路径或相对于主目录的路径' },
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
        path: { type: 'string', description: '目录路径，默认为主目录' },
      },
      required: [],
    },
  },
  {
    name: 'list_skills',
    description: '列出所有可用的 Skill。Skill 是存放在 ~/.claude/skills/ 下的 Markdown 能力扩展文件。',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'call_skill',
    description: '读取并执行一个 Skill。Skill 中的指令会被注入当前对话上下文。',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Skill 名称（不含 .md 后缀）' },
        args: { type: 'string', description: '传递给 Skill 的参数', default: '' },
      },
      required: ['name'],
    },
  },
  {
    name: 'create_skill',
    description: '创建或更新一个 Skill 文件到 ~/.claude/skills/ 目录。',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Skill 名称（英文，简短）' },
        content: { type: 'string', description: 'Skill 的完整 Markdown 内容' },
      },
      required: ['name', 'content'],
    },
  },
  {
    name: 'update_memory',
    description: '写入一条持久化记忆到 ~/.claude/projects/-root/memory/ 并更新 MEMORY.md 索引。',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '记忆文件名（短横线分隔）' },
        content: { type: 'string', description: '记忆内容，含 frontmatter' },
        description: { type: 'string', description: '一行摘要，用于 MEMORY.md 索引' },
      },
      required: ['name', 'content', 'description'],
    },
  },
  {
    name: 'install_mcp',
    description: '安装并注册一个新的 MCP 服务器。',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'MCP 服务器名称' },
        type: { type: 'string', enum: ['npm', 'command', 'sse'], description: '类型' },
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
        return truncated ? `（文件共 ${lines.length} 行，显示前 ${maxLines} 行）\n\n${result}` : result;
      }

      case 'list_dir': {
        const dirPath = resolvePath(input.path);
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        return entries.map((e) => `${e.isDirectory() ? '📁' : '📄'} ${e.name}`).join('\n');
      }

      case 'list_skills': {
        try {
          const files = await fs.readdir(SKILLS_DIR);
          const skills = [];
          for (const f of files) {
            if (!f.endsWith('.md')) continue;
            const content = await fs.readFile(path.join(SKILLS_DIR, f), 'utf8');
            const firstLine = content.split('\n').find(l => l.startsWith('#')) || f;
            skills.push(`- /${f.replace('.md', '')} — ${firstLine.replace(/^#+\s*/, '')}`);
          }
          return skills.length ? skills.join('\n') : '📭 暂无 Skill。用 create_skill 创建。';
        } catch {
          return '📭 暂无 Skill 目录。用 create_skill 创建第一个。';
        }
      }

      case 'call_skill': {
        const skillPath = path.join(SKILLS_DIR, `${input.name}.md`);
        try {
          const content = await fs.readFile(skillPath, 'utf8');
          const argsNote = input.args ? `\n\n用户传入的参数: ${input.args}` : '';
          return `📖 已加载 Skill: ${input.name}\n\n---\n${content}\n---${argsNote}\n\n请按照以上 Skill 中的指令执行。`;
        } catch {
          return `❌ 未找到 Skill: ${input.name}。用 list_skills 查看可用列表。`;
        }
      }

      case 'create_skill': {
        await fs.mkdir(SKILLS_DIR, { recursive: true });
        const skillPath = path.join(SKILLS_DIR, `${input.name}.md`);
        await fs.writeFile(skillPath, input.content, 'utf8');
        return `✅ 已创建 Skill: ${skillPath}`;
      }

      case 'update_memory': {
        const memDir = path.join(HOME_DIR, '.claude', 'projects', '-root', 'memory');
        await fs.mkdir(memDir, { recursive: true });
        const memPath = path.join(memDir, `${input.name}.md`);
        await fs.writeFile(memPath, input.content, 'utf8');

        // 更新 MEMORY.md 索引
        const indexPath = path.join(memDir, 'MEMORY.md');
        let index = '';
        try { index = await fs.readFile(indexPath, 'utf8'); } catch {}
        const link = `- [${input.name}](${input.name}.md) — ${input.description}`;
        if (!index.includes(input.name)) {
          index = index.trim() + '\n' + link + '\n';
          await fs.writeFile(indexPath, index, 'utf8');
        }
        return `✅ 已保存记忆: ${input.name}`;
      }

      case 'install_mcp': {
        const { name, type, package: pkg, command, url, args = [], env = {} } = input;
        let mcpConfig = {};
        if (type === 'npm') {
          if (!pkg) return '❌ npm 类型必须指定 package';
          execSync(`npm install -g ${pkg}`, { encoding: 'utf8', timeout: 60000, shell: true });
          const pkgPath = execSync(`npm root -g`, { encoding: 'utf8', shell: true }).trim();
          const pkgJson = JSON.parse(await fs.readFile(`${pkgPath}/${pkg}/package.json`, 'utf8'));
          const binEntry = pkgJson.bin ? Object.values(pkgJson.bin)[0] : pkgJson.main;
          mcpConfig = { command: 'node', args: [`${pkgPath}/${pkg}/${binEntry}`, ...args], env };
        } else if (type === 'command') {
          if (!command) return '❌ command 类型必须指定 command';
          mcpConfig = { command, args, env };
        } else if (type === 'sse') {
          if (!url) return '❌ sse 类型必须指定 url';
          mcpConfig = { url };
        } else {
          return '❌ 未知类型，支持: npm, command, sse';
        }
        await mcpManager.addServer(name, mcpConfig);
        const tools = mcpManager.clients.get(name)?.tools || [];
        return `✅ 已安装 MCP: **${name}**\n工具: ${tools.map(t => t.name).join(', ')}`;
      }

      case 'list_mcps': {
        const status = mcpManager.getStatus();
        if (!status.length) return '📭 暂无 MCP 服务器';
        return status.map(s => `**${s.name}** (${s.transport}) ${s.connected ? '🟢' : '🔴'}\n工具: ${s.tools.join(', ') || '无'}`).join('\n\n');
      }

      case 'remove_mcp': {
        if (!mcpManager.clients.has(input.name)) return `❌ 未找到 MCP: ${input.name}`;
        await mcpManager.removeServer(input.name);
        return `✅ 已移除 MCP: ${input.name}`;
      }

      default:
        return `未知工具: ${name}`;
    }
  } catch (err) {
    return `❌ 工具执行失败: ${err.message}`;
  }
}

// ========== 工具友好名称 ==========

const TOOL_DISPLAY_NAMES = {
  read_file: '读取文件',
  list_dir: '查看目录',
  run_command: '执行命令',
  write_file: '写入文件',
  list_skills: '查看 Skill 列表',
  call_skill: '执行 Skill',
  create_skill: '创建 Skill',
  update_memory: '保存记忆',
  install_mcp: '安装 MCP 工具',
  list_mcps: '查看 MCP 列表',
  remove_mcp: '移除 MCP',
  baidu_search: '搜索百度',
  search: '搜索网页',
  web_search: '搜索网页',
  fetch_web_content: '抓取网页内容',
  fetchWebContent: '抓取网页内容',
  fetch_github_readme: '读取 GitHub README',
  fetchGithubReadme: '读取 GitHub README',
  fetch_csdn_article: '读取 CSDN 文章',
  fetchCsdnArticle: '读取 CSDN 文章',
  fetch_juejin_article: '读取掘金文章',
  fetchJuejinArticle: '读取掘金文章',
  fetch_zhihu_article: '读取知乎文章',
  fetch_linuxdo_article: '读取 Linux.do 文章',
  fetchLinuxDoArticle: '读取 Linux.do 文章',
};

function getToolDisplayName(name) {
  if (name.startsWith('mcp_')) {
    const parts = name.match(/^mcp_(.+?)_(.+)$/);
    if (parts) return TOOL_DISPLAY_NAMES[parts[2]] || parts[2];
  }
  return TOOL_DISPLAY_NAMES[name] || name;
}

// ========== 对话 ==========

export async function chat(userId, message, onStatus) {
  const session = await sessionManager.addMessage(userId, 'user', message);
  const history = session.messages;

  const mcpTools = mcpManager.getAllTools();
  const allTools = [...TOOLS, ...mcpTools];
  const MAX_TOOL_ROUNDS = 12; // 工具调用轮数上限（普通对话足够，复杂任务用 @@命令 调 CLI）

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

      // 记录 token 消耗
      if (response.usage) {
        await sessionManager.addTokenUsage(userId, response.usage.input_tokens, response.usage.output_tokens);
      }

      console.log(`[Chat] stop_reason: ${response.stop_reason}, content blocks: ${response.content.length}`);
      response.content.forEach((b, i) => {
        const info = { type: b.type };
        if (b.name) info.name = b.name;
        if (b.text) info.text = b.text.substring(0, 100);
        console.log(`[Chat]   block[${i}]:`, JSON.stringify(info));
      });

      history.push({ role: 'assistant', content: response.content });
      await sessionManager.save(userId, session);

      const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use');
      const textBlocks = response.content.filter((b) => b.type === 'text');

      // 兼容 mimo 等非标准模型的 XML 工具调用
      const parsedToolCalls = [];
      for (const block of textBlocks) {
        const matches = [...block.text.matchAll(/<tool_call>\n<function=([^>]+)>\n((?:<parameter=[^>]+>[^<]*<\/parameter>\n?)+)<\/function>\n<\/tool_call>/g)];
        for (const match of matches) {
          const funcName = match[1];
          const params = {};
          const paramMatches = [...match[2].matchAll(/<parameter=([^>]+)>([^<]*)<\/parameter>/g)];
          for (const pm of paramMatches) {
            try { params[pm[1]] = JSON.parse(pm[2]); } catch { params[pm[1]] = pm[2]; }
          }
          parsedToolCalls.push({ name: funcName, input: params, id: `parsed_${round}_${parsedToolCalls.length}` });
        }
      }

      if (toolUseBlocks.length === 0 && parsedToolCalls.length === 0) {
        const textParts = textBlocks.map((b) => b.text).join('\n');
        const cleaned = textParts.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '').trim();
        console.log(`[Chat] 返回文本: ${cleaned.substring(0, 80)}...`);
        return cleaned || '(无回复)';
      }

      const toolResults = [];
      const allCalls = [
        ...toolUseBlocks.map(b => ({ name: b.name, input: b.input, id: b.id, isStandard: true })),
        ...parsedToolCalls.map(c => ({ ...c, isStandard: false })),
      ];

      for (const call of allCalls) {
        const displayName = getToolDisplayName(call.name);
        console.log(`[Tool] ${call.name}(${JSON.stringify(call.input).substring(0, 80)})`);
        if (onStatus) onStatus(`正在${displayName}...`);
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
          toolResults.push({ type: 'text', text: `[工具 ${call.name} 的返回结果]\n${result}` });
        }
      }

      if (toolResults.some(r => r.type === 'tool_result')) {
        history.push({ role: 'user', content: toolResults });
      } else {
        history.push({ role: 'user', content: toolResults.map(r => r.text).join('\n\n') });
      }
      await sessionManager.save(userId, session);

    } catch (err) {
      history.pop();
      await sessionManager.save(userId, session);
      console.error('[Claude API Error]', err.message);
      throw err;
    }
  }

  return '⚠️ 工具调用轮数已达上限';
}

export async function clearHistory(userId) {
  await sessionManager.clear(userId);
}

export async function getTurnCount(userId) {
  const session = await sessionManager.getActive(userId);
  return sessionManager.getTurnCount(session);
}

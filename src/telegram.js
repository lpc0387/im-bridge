import { Telegraf } from 'telegraf';
import { config } from './config.js';
import { chat, clearHistory, getTurnCount } from './claude.js';

let bot = null;

/**
 * 启动 Telegram Bot
 */
export function startTelegramBot() {
  if (!config.telegram.botToken) {
    console.log('[Telegram] 未配置 BOT_TOKEN，跳过');
    return;
  }

  bot = new Telegraf(config.telegram.botToken);

  // /start 命令
  bot.start((ctx) => {
    ctx.reply(
      '👋 你好！我是 Claude AI 助手。\n\n' +
      '直接发消息给我就可以对话。\n\n' +
      '📋 命令：\n' +
      '/clear - 清除对话历史，重新开始\n' +
      '/turns - 查看当前对话轮数'
    );
  });

  // /clear 命令 - 清除对话历史
  bot.command('clear', (ctx) => {
    const userId = `tg:${ctx.from.id}`;
    clearHistory(userId);
    ctx.reply('✅ 对话历史已清除，可以重新开始了。');
  });

  // /turns 命令 - 查看对话轮数
  bot.command('turns', (ctx) => {
    const userId = `tg:${ctx.from.id}`;
    const turns = getTurnCount(userId);
    ctx.reply(`📊 当前对话轮数: ${turns}`);
  });

  // 处理文本消息
  bot.on('text', async (ctx) => {
    const userId = `tg:${ctx.from.id}`;
    const message = ctx.message.text;
    const userName = ctx.from.first_name || '用户';

    console.log(`[Telegram] ${userName}: ${message.substring(0, 50)}...`);

    // 显示"正在输入"
    await ctx.replyWithChatAction('typing');

    try {
      const reply = await chat(userId, message);

      // Telegram 消息长度限制 4096 字符
      if (reply.length <= 4096) {
        await ctx.reply(reply, { parse_mode: 'Markdown' });
      } else {
        // 分段发送
        const chunks = splitMessage(reply, 4000);
        for (const chunk of chunks) {
          await ctx.reply(chunk, { parse_mode: 'Markdown' });
        }
      }
    } catch (err) {
      console.error('[Telegram] 回复失败:', err.message);
      await ctx.reply('❌ 抱歉，处理消息时出错了，请稍后再试。');
    }
  });

  // 启动轮询
  bot.launch();
  console.log('[Telegram] ✅ Bot 已启动');

  // 优雅退出
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

/**
 * 将长消息按长度分段
 */
function splitMessage(text, maxLen) {
  const chunks = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    // 尝试在换行符处分割
    let splitIdx = remaining.lastIndexOf('\n', maxLen);
    if (splitIdx < maxLen * 0.5) splitIdx = maxLen;
    chunks.push(remaining.substring(0, splitIdx));
    remaining = remaining.substring(splitIdx);
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

/**
 * 消息守卫 — 控制并发输入，防止任务重叠
 *
 * 逻辑：
 * 1. 用户发消息时，如果当前有任务在执行，提示等待
 * 2. 用户回复 "1" 或 "等待" → 继续等待
 * 3. 用户回复 "2" 或 "新会话" → 开启新会话处理
 * 4. 任务完成后自动清除忙碌状态
 */

// 用户忙碌状态: userId → { busy, taskId, startedAt, pendingMessage }
const busyUsers = new Map();

// 等待选择状态: userId → { originalMessage, startedAt }
const waitingChoice = new Map();

/**
 * 检查用户是否忙碌，返回处理策略
 * @returns { action: 'process' | 'wait' | 'choice' | 'new_session', message?: string }
 */
export function checkMessageGuard(userId, content) {
  const busy = busyUsers.get(userId);
  const choice = waitingChoice.get(userId);

  // 没有忙碌状态，正常处理
  if (!busy && !choice) {
    return { action: 'process' };
  }

  // 用户正在等待选择
  if (choice) {
    const input = content.trim();
    if (input === '1' || input.includes('等待') || input.includes('继续')) {
      waitingChoice.delete(userId);
      return { action: 'waiting', message: '⏳ 好的，继续等待当前任务完成...' };
    }
    if (input === '2' || input.includes('新会话') || input.includes('新的')) {
      waitingChoice.delete(userId);
      return { action: 'new_session', message: '✅ 已开启新会话，请重新输入你的消息。' };
    }
    // 无效输入，重新提示
    return { action: 'choice_again' };
  }

  // 用户忙碌中，收到新消息
  if (busy) {
    const elapsed = Math.round((Date.now() - busy.startedAt) / 1000);
    const taskInfo = busy.taskName ? `「${busy.taskName}」` : '任务';

    // 存储待处理消息
    waitingChoice.set(userId, { originalMessage: content, startedAt: Date.now() });

    return {
      action: 'choice',
      message: `⏳ ${taskInfo}执行中（已 ${elapsed}s），请等待结束后输入。\n\n回复：\n1️⃣ 继续等待\n2️⃣ 开启新的会话`,
    };
  }

  return { action: 'process' };
}

/**
 * 标记用户开始忙碌
 */
export function markBusy(userId, taskName = '') {
  busyUsers.set(userId, {
    busy: true,
    taskName,
    startedAt: Date.now(),
  });
}

/**
 * 标记用户空闲
 */
export function markIdle(userId) {
  busyUsers.delete(userId);
  waitingChoice.delete(userId);
}

/**
 * 检查用户是否忙碌
 */
export function isBusy(userId) {
  return busyUsers.has(userId);
}

/**
 * 获取忙碌用户的原始消息（用于新会话）
 */
export function getPendingMessage(userId) {
  const choice = waitingChoice.get(userId);
  return choice?.originalMessage || null;
}

/**
 * 清除等待选择状态
 */
export function clearChoice(userId) {
  waitingChoice.delete(userId);
}

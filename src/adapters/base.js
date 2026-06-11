/**
 * IM 适配器基类
 * 所有平台适配器都需要继承此类
 */
export class BaseAdapter {
  constructor(name, config) {
    this.name = name;
    this.config = config;
    this.connected = false;
    this.messageHandler = null;
  }

  /**
   * 设置消息处理器
   */
  onMessage(handler) {
    this.messageHandler = handler;
  }

  /**
   * 启动适配器
   */
  async start() {
    throw new Error('子类必须实现 start() 方法');
  }

  /**
   * 停止适配器
   */
  async stop() {
    throw new Error('子类必须实现 stop() 方法');
  }

  /**
   * 发送消息
   */
  async sendMessage(userId, content, options = {}) {
    throw new Error('子类必须实现 sendMessage() 方法');
  }

  /**
   * 发送状态更新
   */
  async sendStatus(userId, status) {
    // 默认实现：发送文本消息
    await this.sendMessage(userId, `⏳ ${status}`);
  }

  /**
   * 获取连接状态
   */
  getStatus() {
    return {
      name: this.name,
      connected: this.connected,
      config: this._getConfigSummary(),
    };
  }

  /**
   * 获取配置摘要（隐藏敏感信息）
   */
  _getConfigSummary() {
    return {};
  }

  /**
   * 分割长消息为多段（换行优先分割，避免截断句子）
   * @param {string} text - 原始文本
   * @param {number} maxLen - 每段最大长度（字符数）
   * @returns {string[]} 分段后的文本数组
   */
  splitMessage(text, maxLen) {
    const chunks = [];
    let remaining = text;
    while (remaining.length > maxLen) {
      let splitIdx = remaining.lastIndexOf('\n', maxLen);
      if (splitIdx < maxLen * 0.5) splitIdx = maxLen;
      chunks.push(remaining.substring(0, splitIdx));
      remaining = remaining.substring(splitIdx);
    }
    if (remaining) chunks.push(remaining);
    return chunks;
  }
}

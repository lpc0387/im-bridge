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
}

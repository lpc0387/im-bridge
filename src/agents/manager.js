import { ClaudeAPIAgent, ClaudeCodeAgent, CodexAgent, GeminiAgent } from './base.js';

/**
 * Agent 管理器
 * 统一管理所有 AI Agent
 */
export class AgentManager {
  constructor() {
    this.agents = new Map(); // name -> agent
    this.defaultAgent = null;
  }

  /**
   * 注册 Agent
   */
  register(name, agent) {
    this.agents.set(name, agent);
    if (!this.defaultAgent) {
      this.defaultAgent = name;
    }
    console.log(`[AgentManager] 注册 Agent: ${name} (${agent.type})`);
  }

  /**
   * 创建并注册 Claude API Agent
   */
  registerClaudeAPI(name, config) {
    const agent = new ClaudeAPIAgent(name, config);
    this.register(name, agent);
    return agent;
  }

  /**
   * 创建并注册 Claude Code Agent
   */
  registerClaudeCode(name, config) {
    const agent = new ClaudeCodeAgent(name, config);
    this.register(name, agent);
    return agent;
  }

  /**
   * 创建并注册 Codex Agent
   */
  registerCodex(name, config) {
    const agent = new CodexAgent(name, config);
    this.register(name, agent);
    return agent;
  }

  /**
   * 创建并注册 Gemini Agent
   */
  registerGemini(name, config) {
    const agent = new GeminiAgent(name, config);
    this.register(name, agent);
    return agent;
  }

  /**
   * 获取 Agent
   */
  getAgent(name) {
    return this.agents.get(name || this.defaultAgent);
  }

  /**
   * 执行任务
   */
  async execute(prompt, options = {}) {
    const agentName = options.agent || this.defaultAgent;
    const agent = this.agents.get(agentName);

    if (!agent) {
      throw new Error(`未找到 Agent: ${agentName}`);
    }

    return await agent.execute(prompt, options);
  }

  /**
   * 停止指定 Agent
   */
  async stopAgent(name) {
    const agent = this.agents.get(name);
    if (agent) {
      await agent.stop();
    }
  }

  /**
   * 停止所有 Agent
   */
  async stopAll() {
    for (const agent of this.agents.values()) {
      await agent.stop();
    }
  }

  /**
   * 设置默认 Agent
   */
  setDefault(name) {
    if (this.agents.has(name)) {
      this.defaultAgent = name;
      console.log(`[AgentManager] 默认 Agent 已切换到: ${name}`);
    }
  }

  /**
   * 获取所有 Agent 状态
   */
  getStatus() {
    const status = [];
    for (const [name, agent] of this.agents) {
      status.push({
        ...agent.getStatus(),
        isDefault: name === this.defaultAgent,
      });
    }
    return status;
  }

  /**
   * 获取可用 Agent 列表
   */
  listAgents() {
    return Array.from(this.agents.keys());
  }
}

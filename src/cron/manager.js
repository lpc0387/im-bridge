import fs from 'fs/promises';
import path from 'path';
import cron from 'node-cron';

/**
 * 定时任务管理器
 */
export class CronManager {
  constructor(config = {}) {
    this.tasks = new Map(); // name -> task
    this.configPath = config.configPath || path.join(process.env.HOME || '/root', '.im-bridge', 'cron.json');
    this.agentManager = null;
    this.adapterManager = null;
    this.notifyUserId = config.notifyUserId;
    this.notifyPlatform = config.notifyPlatform || 'wecom';
  }

  /**
   * 设置 Agent 管理器
   */
  setAgentManager(agentManager) {
    this.agentManager = agentManager;
  }

  /**
   * 设置适配器管理器
   */
  setAdapterManager(adapterManager) {
    this.adapterManager = adapterManager;
  }

  /**
   * 添加定时任务
   */
  async addTask(name, schedule, prompt, options = {}) {
    if (this.tasks.has(name)) {
      await this.removeTask(name);
    }

    const task = {
      name,
      schedule,
      prompt,
      options: {
        agent: options.agent,
        notify: options.notify !== false,
        enabled: options.enabled !== false,
      },
      job: null,
      lastRun: null,
      lastResult: null,
    };

    // 创建 cron 任务
    if (task.options.enabled) {
      task.job = this.createCronJob(task);
    }

    this.tasks.set(name, task);
    await this.saveTasks();

    console.log(`[Cron] 添加任务: ${name} (${schedule})`);
    return task;
  }

  /**
   * 创建 cron 任务
   */
  createCronJob(task) {
    return cron.schedule(task.schedule, async () => {
      console.log(`[Cron] 执行任务: ${task.name}`);
      task.lastRun = new Date().toISOString();

      try {
        if (!this.agentManager) {
          throw new Error('未设置 AgentManager');
        }

        const result = await this.agentManager.execute(task.prompt, task.options);
        task.lastResult = { success: true, result: result.substring(0, 200) };

        // 发送通知
        if (task.options.notify && this.adapterManager && this.notifyUserId) {
          const message = `⏰ 定时任务完成: ${task.name}\n\n${result.substring(0, 500)}`;
          await this.adapterManager.sendMessage(this.notifyPlatform, this.notifyUserId, message);
        }

        console.log(`[Cron] 任务完成: ${task.name}`);
      } catch (err) {
        console.error(`[Cron] 任务失败: ${task.name}`, err.message);
        task.lastResult = { success: false, error: err.message };

        // 发送错误通知
        if (task.options.notify && this.adapterManager && this.notifyUserId) {
          const message = `❌ 定时任务失败: ${task.name}\n\n错误: ${err.message}`;
          await this.adapterManager.sendMessage(this.notifyPlatform, this.notifyUserId, message);
        }
      }
    });
  }

  /**
   * 移除任务
   */
  async removeTask(name) {
    const task = this.tasks.get(name);
    if (task) {
      if (task.job) {
        task.job.stop();
      }
      this.tasks.delete(name);
      await this.saveTasks();
      console.log(`[Cron] 移除任务: ${name}`);
    }
  }

  /**
   * 启用任务
   */
  async enableTask(name) {
    const task = this.tasks.get(name);
    if (task) {
      task.options.enabled = true;
      if (!task.job) {
        task.job = this.createCronJob(task);
      }
      await this.saveTasks();
      console.log(`[Cron] 启用任务: ${name}`);
    }
  }

  /**
   * 禁用任务
   */
  async disableTask(name) {
    const task = this.tasks.get(name);
    if (task) {
      task.options.enabled = false;
      if (task.job) {
        task.job.stop();
        task.job = null;
      }
      await this.saveTasks();
      console.log(`[Cron] 禁用任务: ${name}`);
    }
  }

  /**
   * 手动执行任务
   */
  async runTask(name) {
    const task = this.tasks.get(name);
    if (!task) {
      throw new Error(`未找到任务: ${name}`);
    }

    console.log(`[Cron] 手动执行任务: ${name}`);
    task.lastRun = new Date().toISOString();

    try {
      const result = await this.agentManager.execute(task.prompt, task.options);
      task.lastResult = { success: true, result: result.substring(0, 200) };
      return result;
    } catch (err) {
      task.lastResult = { success: false, error: err.message };
      throw err;
    }
  }

  /**
   * 获取任务列表
   */
  getTasks() {
    const tasks = [];
    for (const [name, task] of this.tasks) {
      tasks.push({
        name,
        schedule: task.schedule,
        prompt: task.prompt.substring(0, 100),
        enabled: task.options.enabled,
        lastRun: task.lastRun,
        lastResult: task.lastResult,
      });
    }
    return tasks;
  }

  /**
   * 保存任务配置
   */
  async saveTasks() {
    const dir = path.dirname(this.configPath);
    await fs.mkdir(dir, { recursive: true });

    const data = {};
    for (const [name, task] of this.tasks) {
      data[name] = {
        schedule: task.schedule,
        prompt: task.prompt,
        options: task.options,
      };
    }

    await fs.writeFile(this.configPath, JSON.stringify(data, null, 2), 'utf8');
  }

  /**
   * 加载任务配置
   */
  async loadTasks() {
    try {
      const data = JSON.parse(await fs.readFile(this.configPath, 'utf8'));
      
      for (const [name, config] of Object.entries(data)) {
        await this.addTask(name, config.schedule, config.prompt, config.options);
      }

      console.log(`[Cron] 已加载 ${Object.keys(data).length} 个定时任务`);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error('[Cron] 加载任务配置失败:', err.message);
      }
    }
  }

  /**
   * 停止所有任务
   */
  stopAll() {
    for (const task of this.tasks.values()) {
      if (task.job) {
        task.job.stop();
      }
    }
    console.log('[Cron] 已停止所有任务');
  }
}

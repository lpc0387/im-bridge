import 'dotenv/config';

export const config = {
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    authToken: process.env.ANTHROPIC_AUTH_TOKEN,
    baseUrl: process.env.ANTHROPIC_BASE_URL,
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
  },
  wecom: {
    corpId: process.env.WECOM_CORPID,
    corpSecret: process.env.WECOM_CORPSECRET,
    agentId: process.env.WECOM_AGENTID,
    token: process.env.WECOM_TOKEN,
    encodingAESKey: process.env.WECOM_ENCODING_AES_KEY,
    webhookUrl: process.env.WECOM_WEBHOOK_URL,
  },
  feishu: {
    appId: process.env.FEISHU_APP_ID,
    appSecret: process.env.FEISHU_APP_SECRET,
  },
  dingtalk: {
    appKey: process.env.DINGTALK_APP_KEY,
    appSecret: process.env.DINGTALK_APP_SECRET,
    robotCode: process.env.DINGTALK_ROBOT_CODE,
  },
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN,
  },
  cli: {
    password: process.env.CLI_ACCESS_PASSWORD,
    timeoutMs: parseInt(process.env.CLI_TIMEOUT_MS || '300000', 10),
  },
  web: {
    port: parseInt(process.env.WEB_PORT || '8081', 10),
    auth: {
      username: process.env.WEB_AUTH_USERNAME,
      password: process.env.WEB_AUTH_PASSWORD,
    },
  },
  port: parseInt(process.env.PORT || '3000', 10),
};

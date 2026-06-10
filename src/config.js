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
  },
  weixin: {
    token: process.env.WEIXIN_TOKEN,
    baseURL: process.env.WEIXIN_BASE_URL || 'https://ilinkai.weixin.qq.com',
    allowFrom: process.env.WEIXIN_ALLOW_FROM || '',
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
  slack: {
    botToken: process.env.SLACK_BOT_TOKEN,
    appToken: process.env.SLACK_APP_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
  },
  discord: {
    token: process.env.DISCORD_BOT_TOKEN,
  },
  line: {
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.LINE_CHANNEL_SECRET,
  },
  whatsapp: {
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN,
  },
  signal: {
    apiUrl: process.env.SIGNAL_API_URL,
    number: process.env.SIGNAL_NUMBER,
  },
  matrix: {
    homeserver: process.env.MATRIX_HOMESERVER,
    accessToken: process.env.MATRIX_ACCESS_TOKEN,
    userId: process.env.MATRIX_USER_ID,
  },
  teams: {
    appId: process.env.TEAMS_APP_ID,
    appPassword: process.env.TEAMS_APP_PASSWORD,
  },
  googlechat: {
    credentials: process.env.GOOGLECHAT_CREDENTIALS,
    projectId: process.env.GOOGLECHAT_PROJECT_ID,
  },
  cli: {
    password: process.env.CLI_ACCESS_PASSWORD,
    timeoutMs: parseInt(process.env.CLI_TIMEOUT_MS || '300000', 10),
  },
  port: parseInt(process.env.PORT || '3000', 10),
};

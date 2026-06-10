import 'dotenv/config';

export const config = {
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    authToken: process.env.ANTHROPIC_AUTH_TOKEN,
    baseUrl: process.env.ANTHROPIC_BASE_URL,
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
  },
  wecom: {
    webhookUrl: process.env.WECOM_WEBHOOK_URL,
    corpId: process.env.WECOM_CORPID,
    corpSecret: process.env.WECOM_CORPSECRET,
    agentId: process.env.WECOM_AGENTID,
    token: process.env.WECOM_TOKEN,
    encodingAESKey: process.env.WECOM_ENCODING_AES_KEY,
  },
  port: parseInt(process.env.PORT || '3000', 10),
};

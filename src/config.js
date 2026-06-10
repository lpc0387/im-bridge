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
  cli: {
    password: process.env.CLI_ACCESS_PASSWORD,
    timeoutMs: parseInt(process.env.CLI_TIMEOUT_MS || '300000', 10),
  },
  port: parseInt(process.env.PORT || '3000', 10),
};

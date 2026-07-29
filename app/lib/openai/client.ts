import OpenAI from 'openai';

// 全域共用的 OpenAI client（Responses API 遷移後統一入口）
let _client: OpenAI | null = null;

export function getOpenAI(): OpenAI {
  if (!_client) {
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _client;
}

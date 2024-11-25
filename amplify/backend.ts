import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { secret } from '@aws-amplify/backend';

const backend = defineBackend({
  auth,
  data
});

// 定义 OpenAI 相关的密钥
export const openaiApiKey = secret('OPENAI_API_KEY');
export const openaiOrgId = secret('OPENAI_ORG_ID');

export default backend;

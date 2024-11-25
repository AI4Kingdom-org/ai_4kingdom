import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { Secret } from '@aws-amplify/backend';

const backend = defineBackend({
  auth,
  data
});

// 定义 OpenAI 相关的密钥
export const openaiApiKey = new Secret('OPENAI_API_KEY', {
  description: 'OpenAI API Key'
});

export const openaiOrgId = new Secret('OPENAI_ORG_ID', {
  description: 'OpenAI Organization ID'
});

export default backend;

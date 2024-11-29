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

<<<<<<< HEAD
export const awsAccessKey = secret('AWS_ACCESS_KEY');
export const awsSecretKey = secret('AWS_SECRET_KEY');

=======
>>>>>>> 44d991b40406b5ed12dbd3731740d81f976b7b04
export default backend;

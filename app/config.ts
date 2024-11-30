export const amplifyConfig = {
  Auth: {
    Cognito: {
      identityPoolId: process.env.NEXT_PUBLIC_IDENTITY_POOL_ID,
      userPoolId: process.env.NEXT_PUBLIC_USER_POOL_ID,
      userPoolClientId: process.env.NEXT_PUBLIC_USER_POOL_CLIENT_ID
    }
  }
};

export const openAIConfig = {
  apiKey: process.env.OPENAI_API_KEY,
  orgId: process.env.OPENAI_ORG_ID
}; 
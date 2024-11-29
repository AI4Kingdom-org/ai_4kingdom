<<<<<<< HEAD
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
=======
export const config = {
  Auth: {
    Cognito: {
      userPoolId: process.env.NEXT_PUBLIC_USER_POOL_ID!,
      userPoolClientId: process.env.NEXT_PUBLIC_USER_POOL_CLIENT_ID!,
      identityPoolId: process.env.NEXT_PUBLIC_IDENTITY_POOL_ID!,
      region: process.env.NEXT_PUBLIC_REGION!
    }
  }
>>>>>>> 44d991b40406b5ed12dbd3731740d81f976b7b04
}; 
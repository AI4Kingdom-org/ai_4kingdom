export async function getDynamoDBConfig() {
  if (process.env.NODE_ENV === 'development') {
    return {
      region: process.env.NEXT_PUBLIC_REGION || "us-east-2",
      credentials: {
        accessKeyId: process.env.NEXT_PUBLIC_AWS_ACCESS_KEY!,
        secretAccessKey: process.env.NEXT_PUBLIC_AWS_SECRET_KEY!
      }
    };
  }

  const { fromCognitoIdentityPool } = await import("@aws-sdk/credential-providers");
  return {
    region: process.env.NEXT_PUBLIC_REGION || "us-east-2",
    credentials: await fromCognitoIdentityPool({
      clientConfig: { region: process.env.NEXT_PUBLIC_REGION || "us-east-2" },
      identityPoolId: process.env.NEXT_PUBLIC_IDENTITY_POOL_ID!
    })()
  };
} 
/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY?.trim(),
    OPENAI_ORG_ID: process.env.OPENAI_ORG_ID?.trim(),
  },
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          {
            key: 'Access-Control-Allow-Credentials',
            value: 'true',
          },
          {
            key: 'Access-Control-Allow-Origin',
            // 使用主要網域環境變數，預設改為 .org；若需要多來源請在各 API route 動態處理 CORS
            value: process.env.NEXT_PUBLIC_PRIMARY_DOMAIN || 'https://ai4kingdom.org',
          },
        ],
      },
    ]
  },
}

module.exports = nextConfig
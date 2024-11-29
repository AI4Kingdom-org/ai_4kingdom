/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY?.trim(),
    OPENAI_ORG_ID: process.env.OPENAI_ORG_ID?.trim(),
  }
}

module.exports = nextConfig

export const CHAT_TYPES = {
  GENERAL: 'general',
  HOMESCHOOL: 'homeschool'
} as const;

export type ChatType = typeof CHAT_TYPES[keyof typeof CHAT_TYPES];

export interface ChatTypeConfig {
  type: ChatType;
  title: string;
  description: string;
}

export const CHAT_TYPE_CONFIGS: Record<ChatType, ChatTypeConfig> = {
  [CHAT_TYPES.GENERAL]: {
    type: CHAT_TYPES.GENERAL,
    title: '普通对话',
    description: '日常对话助手'
  },
  [CHAT_TYPES.HOMESCHOOL]: {
    type: CHAT_TYPES.HOMESCHOOL,
    title: '家校对话',
    description: '家校沟通助手'
  }
}; 
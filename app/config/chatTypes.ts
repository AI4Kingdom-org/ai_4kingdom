import { ASSISTANT_IDS, VECTOR_STORE_IDS } from './constants';

export const CHAT_TYPES: Record<string, ChatType> = {
  GENERAL: 'general',
  HOMESCHOOL: 'homeschool',
  SUNDAY_GUIDE: 'sunday-guide',
  BIBLE_STUDY: 'bible-study',
  SPIRITUAL_PARTNER: 'spiritual-partner',
  CHILDREN_MENTAL: 'children-mental',
  JOHNSUNG: 'johnsung',
  TEEN_CONSOLE: 'teen-console',
  HOME_CONSOLE: 'home-console',
  AGAPE_CHURCH: 'agape-church',
  EAST_CHRIST_HOME: 'east-christ-home',
  CFSC_CHURCH: 'cfsc-church',
  CHINESE_PASTOR_NETWORK: 'chinese-pastor-network',
  ZHIMING_YUAN: 'zhiming-yuan',
} as const;


export type ChatType = 'general' | 'sunday-guide' | 'bible-study' | 'homeschool' | 'spiritual-partner' | 'children-mental' | 'johnsung' | 'teen-console' | 'home-console' | 'agape-church' | 'east-christ-home' | 'cfsc-church' | 'chinese-pastor-network' | 'zhiming-yuan';


export interface ChatTypeConfig {
  type: ChatType;
  title: string;
  description: string;
  assistantId?: string;
  vectorStoreId?: string;
}

export const CHAT_TYPE_CONFIGS: Record<ChatType, ChatTypeConfig> = {
  'general': {
    type: 'general',
    title: '通用对话',
    description: '可以和AI进行任何话题的交谈',
    assistantId: ASSISTANT_IDS.GENERAL,
    vectorStoreId: VECTOR_STORE_IDS.GENERAL
  },
  'homeschool': {
    type: 'homeschool',
    title: '家庭教育',
    description: '专注于家庭教育相关的咨询和建议',
    assistantId: ASSISTANT_IDS.HOMESCHOOL,
    vectorStoreId: VECTOR_STORE_IDS.HOMESCHOOL
  },
  'sunday-guide': {
    type: 'sunday-guide',
    title: '主日导读',
  description: '主日经文导读助手',
  // 補上實際使用的牧者助手與向量庫，避免預設 fallback 到 GENERAL
  assistantId: ASSISTANT_IDS.SUNDAY_GUIDE,
  vectorStoreId: VECTOR_STORE_IDS.SUNDAY_GUIDE
  },
  'bible-study': {
    type: 'bible-study',
    title: '查经',
    description: '圣经学习助手'
  },
  'spiritual-partner': {
    type: 'spiritual-partner',
    title: '灵修伙伴',
    description: '灵修伙伴',
    assistantId: ASSISTANT_IDS.SPIRITUAL_PARTNER,
    vectorStoreId: VECTOR_STORE_IDS.SPIRITUAL_PARTNER
  },
  'children-mental': {
    type: 'children-mental',
    title: '对话',
    description: '儿童心理咨询',
    assistantId: ASSISTANT_IDS.CHILDREN_MENTAL,
    vectorStoreId: VECTOR_STORE_IDS.CHILDREN_MENTAL
  },
  'johnsung': {
    type: 'johnsung',
    title: '宋尚节牧师解答属灵问题',
    description: '宋尚节牧师解答属灵问题',
    assistantId: ASSISTANT_IDS.JOHNSUNG,
    vectorStoreId: VECTOR_STORE_IDS.JOHNSUNG
  },
  'teen-console': {
    type: 'teen-console',
    title: '儿童辅导',
    description: '儿童心理辅导',
    assistantId: ASSISTANT_IDS.TEEN_CONSOLE,
    vectorStoreId: VECTOR_STORE_IDS.TEEN_CONSOLE
  },
  'home-console': {
    type: 'home-console',
    title: '家庭辅导',
    description: '家庭关系咨询',
    assistantId: ASSISTANT_IDS.HOME_CONSOLE,
    vectorStoreId: VECTOR_STORE_IDS.HOME_CONSOLE
  },
  'agape-church': {
    type: 'agape-church',
    title: '愛加倍教會',
    description: '愛加倍教會牧者助手',
    assistantId: ASSISTANT_IDS.AGAPE_CHURCH,
    vectorStoreId: VECTOR_STORE_IDS.AGAPE_CHURCH
  },
  'east-christ-home': {
    type: 'east-christ-home',
    title: '東基家',
    description: '東基家牧者助手',
    assistantId: ASSISTANT_IDS.EAST_CHRIST_HOME,
    vectorStoreId: VECTOR_STORE_IDS.EAST_CHRIST_HOME
  },
  'cfsc-church': {
    type: 'cfsc-church',
    title: 'CFSC Church',
    description: 'CFSC Church 牧者助手',
    assistantId: ASSISTANT_IDS.CFSC_CHURCH,
    vectorStoreId: VECTOR_STORE_IDS.CFSC_CHURCH
  },
  'chinese-pastor-network': {
    type: 'chinese-pastor-network',
    title: '华牧网络教会事工联盟',
    description: '华牧网络教会事工联盟牧者助手',
    assistantId: ASSISTANT_IDS.CHINESE_PASTOR_NETWORK,
    vectorStoreId: VECTOR_STORE_IDS.CHINESE_PASTOR_NETWORK
  },
  'zhiming-yuan': {
    type: 'zhiming-yuan',
    title: '遠志明耶穌頌 AI 助手',
    description: '遠志明神學問答集牧者助手',
    assistantId: ASSISTANT_IDS.ZHIMING_YUAN,
    vectorStoreId: VECTOR_STORE_IDS.ZHIMING_YUAN
  },

};

interface ChatConfig {
  title: string;
  description: string;
  icon?: string;
}

export const CHAT_CONFIGS: Record<ChatType, ChatConfig> = {
  'general': {
    title: '通用对话',
    description: '可以和AI进行任何话题的交谈'
  },
  'sunday-guide': {
    title: '主日导读',
    description: '主日经文导读助手'
  },
  'bible-study': {
    title: '查经',
    description: '圣经学习助手'
  },
  'homeschool': {
    title: '家庭教育',
    description: '专注于家庭教育相关的咨询和建议'
  },
  'spiritual-partner': {
    title: '灵修伙伴',
    description: '灵修伙伴'
  },
  'children-mental': {
    title: '对话',
    description: '儿童心理咨询'
  },
  'johnsung': {
    title: '與宋尚节牧师对话',
    description: '宋尚节牧师解答属灵问题'
  },
  'teen-console': {
    title: '儿童辅导',
    description: '儿童心理辅导'
  },
  'home-console': {
    title: '家庭辅导',
    description: '家庭关系咨询'
  },
  'agape-church': {
    title: '愛加倍教會',
    description: '愛加倍教會牧者助手'
  },
  'east-christ-home': {
    title: '東基家',
    description: '東基家牧者助手'
  },
  'cfsc-church': {
    title: 'CFSC Church',
    description: 'CFSC Church 牧者助手'
  },
  'chinese-pastor-network': {
    title: '华牧网络教会事工联盟',
    description: '华牧网络教会事工联盟牧者助手'
  },
  'zhiming-yuan': {
    title: '遠志明耶穌頌 AI 助手',
    description: '遠志明神學問答集牧者助手'
  },

};
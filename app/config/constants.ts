export const ASSISTANT_IDS = {
  GENERAL: 'asst_O9yodhRcFLqS28ZybIF35Y4o',  // 通用助手
  HOMESCHOOL: 'asst_fNylZyKusZ3fKmcR5USxIzbY',  // 暂时使用相同的，之后可以替换为专门的家庭教育助手
  SPIRITUAL_PARTNER: 'asst_fKy4T9OgaIDNXjGTlQB9aoLm',  // 灵修伙伴助手
  CHILDREN_MENTAL: 'asst_LvMdndv0ZetWAaftw76CRraM',  // 儿童心理助手
  JOHNSUNG: 'asst_5QAFGCqN0BJvgz6FDc5bKhXx', //宋尚节牧师解答属灵问题
  SUNDAY_GUIDE: 'asst_4QKJubuGno3Rw4iALWHExIh4',//牧者助手
  TEEN_CONSOLE: 'asst_FYGpQuorHCcdFuTJCMT4vHde',  //儿童貼心属灵辅导
  HOME_CONSOLE: 'asst_0p6WP3BaiYidMkfcsyM8EPyM',  //家庭辅导
  AGAPE_CHURCH: 'asst_Vm0kpSHh7snqF5SAJ32SmAMN', // 愛加倍教會專用牧者助手（獨立）
  JIAN_ZHU: 'asst_bGYjfmBTbjuF0tCGbJ0yEa8I' // 祝建牧師助手（獨立）
  // ... 其他类型的助手

};
export const VECTOR_STORE_IDS = {
  GENERAL: 'vs_AMJIJ1zfGnzHpI1msv4T8Ww3',
  HOMESCHOOL: 'vs_67b28ec53da48191863817002d79222b',
  SPIRITUAL_PARTNER: 'vs_67b2781f3d048191a8c9fc35d9ecd3ab',
  CHILDREN_MENTAL: 'vs_67b28ec53da48191863817002d79222b',
  JOHNSUNG: 'vs_67c549731c10819192a57550f0dd37f4',
  SUNDAY_GUIDE: 'vs_67c549731c10819192a57550f0dd37f4', //牧者助手
  TEEN_CONSOLE: 'vs_67b28ec53da48191863817002d79222b',  // 使用與 CHILDREN_MENTAL 相同的向量存儲 ID
  HOME_CONSOLE: 'vs_67b28ec53da48191863817002d79222b',  // 使用與 CHILDREN_MENTAL 相同的向量存儲 ID
  AGAPE_CHURCH: 'vs_68a9ee54724c8191b6a7d574a59ca91a', // 愛加倍教會專用向量庫
  JIAN_ZHU: 'vs_6853c96fdfb88191a8421097e5bea232' // 祝建牧師助手向量庫
  // ... 其他类型的向量存储
};

// 牧者助手單位配置：default 為共用；其餘為獨立單位。
export const SUNDAY_GUIDE_UNITS = {
  default: {
    assistantId: ASSISTANT_IDS.SUNDAY_GUIDE,
    vectorStoreId: VECTOR_STORE_IDS.SUNDAY_GUIDE,
    // 共用版本：沿用全域 canUserUpload 機制，此陣列通常保持空或做額外白名單補強
    allowedUploaders: [] as string[],
    accessType: 'public' as const
  },
  agape: {
    // 改為共用 Agape Church 專屬助手/向量庫
    assistantId: ASSISTANT_IDS.AGAPE_CHURCH,
    vectorStoreId: VECTOR_STORE_IDS.AGAPE_CHURCH,
  // 指定愛加倍教會可上傳使用者（填入 Cognito user_sub 或系統 user_id）
  allowedUploaders: [ '1', '24', '6', '108'] as string[],
  accessType: 'public' as const
  },
  // East Christ Home：改為共用 Agape Church 專屬助手/向量庫
  eastChristHome: {
    assistantId: ASSISTANT_IDS.AGAPE_CHURCH,
    vectorStoreId: VECTOR_STORE_IDS.AGAPE_CHURCH,
    allowedUploaders: [ '1', '24', '22'] as string[],
    accessType: 'public' as const
  },
  // Jian Zhu：沿用 Sunday Guide 助手/向量庫，透過 unitId 分流
  jianZhu: {
  assistantId: ASSISTANT_IDS.JIAN_ZHU,
  vectorStoreId: VECTOR_STORE_IDS.JIAN_ZHU,
    allowedUploaders: [ '1', '24', '22', '6'] as string[],
    accessType: 'public' as const
  }
} as const;

export type SundayGuideUnit = keyof typeof SUNDAY_GUIDE_UNITS;
export function getSundayGuideUnitConfig(unitId?: string) {
  if (!unitId) return SUNDAY_GUIDE_UNITS.default;
  return (SUNDAY_GUIDE_UNITS as any)[unitId] || SUNDAY_GUIDE_UNITS.default;
}

// 由 assistantId 反查所屬單位；找不到則回傳 'default'
export function findUnitByAssistantId(assistantId?: string): SundayGuideUnit {
  if (!assistantId) return 'default';
  const entry = Object.entries(SUNDAY_GUIDE_UNITS).find(([, cfg]) => cfg.assistantId === assistantId);
  return (entry?.[0] as SundayGuideUnit) || 'default';
}
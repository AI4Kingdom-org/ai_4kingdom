// 家庭教育 Prompt 資料型別
export interface HomeschoolPromptData {
  userId: string;
  childName: string;
  age?: number;  // 年齡
  gender?: 'male' | 'female';  // 性別：男孩/女孩
  concerns?: string[];  // 關注問題（多選）
  basicInfo: string;
  recentChanges: string;
  threadId?: string;
  assistantId?: string;
  updatedAt?: string;
}

// 問題類型選項
export const CONCERN_OPTIONS = [
  { value: 'attention', label: '注意力問題' },
  { value: 'internet_addiction', label: '網路沉迷' },
  { value: 'social_interaction', label: '人際交往' },
  { value: 'parent_child_communication', label: '親子溝通' },
  { value: 'learning_motivation', label: '學習動機' },
  { value: 'emotional_management', label: '情緒管理' },
  { value: 'behavior_issues', label: '行為問題' },
  { value: 'other', label: '其他' }
] as const;

// 輔助函數：取得問題標籤
export function getConcernLabel(value: string): string {
  const option = CONCERN_OPTIONS.find(opt => opt.value === value);
  return option?.label || value;
}

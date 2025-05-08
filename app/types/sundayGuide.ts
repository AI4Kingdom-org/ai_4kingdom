export interface SundayGuideItem {
  userId: string;      // 改為小寫開頭，與實現保持一致
  Timestamp: string;
  assistantId?: string;
  vectorStoreId?: string;
  youtubeUrl?: string;
  transcription?: string;
  documents?: string[];
  fileName?: string;   // 添加常用欄位
  fileId?: string;     // 添加常用欄位
  fileSize?: number;   // 添加常用欄位
  fileType?: string;   // 添加常用欄位
  uploadTimestamp?: string; // 添加常用欄位
  updatedAt?: string;  // 添加常用欄位
  summary?: string;    // 添加常用欄位
  fullText?: string;   // 添加常用欄位
  devotional?: string; // 添加常用欄位
  bibleStudy?: string; // 添加常用欄位
  status?: string;     // 添加常用欄位
  type?: string;       // 添加常用欄位
}
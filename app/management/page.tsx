'use client';

import Link from 'next/link';
import styles from './management.module.css';

interface ManagementTool {
  title: string;
  description: string;
  path: string;
  iconEmoji: string;
}

const managementTools: ManagementTool[] = [
  {
    title: '提示管理',
    description: '查看和編輯系統的提示模板',
    path: '/admin/prompts',
    iconEmoji: '📝'
  },
  {
    title: '用戶點數管理',
    description: '管理用戶點數和查看使用情況',
    path: '/token-management',
    iconEmoji: '💰'
  },
  {
    title: '檔案上傳',
    description: '上傳單一或多個檔案到指定的助手知識庫',
    path: '/file-upload',
    iconEmoji: '⬆️'
  },
  {
    title: '文件記錄管理',
    description: '查看和管理上傳的檔案',
    path: '/file-records',
    iconEmoji: '📁'
  },
  {
    title: '用戶權限管理',
    description: '管理用戶上傳權限，控制誰可以上傳文檔',
    path: '/user-permissions',
    iconEmoji: '👥'
  },
  {
    title: '獨立創作助手',
    description: '使用 3 張圖片與文字摘要建立 10 秒短影音草稿與影片任務',
    path: '/creative-studio',
    iconEmoji: '🎬'
  }
];

export default function ManagementPortal() {
  return (
    <div className={styles.managementPortalContainer}>
      <header className={styles.managementHeader}>
        <h1>後台管理</h1>
        <p>選擇您要訪問的管理功能</p>
      </header>

      <div className={styles.managementToolsGrid}>
        {managementTools.map((tool, index) => (
          <Link href={tool.path} key={index} className={styles.toolCard}>
            <div className={styles.toolIcon}>{tool.iconEmoji}</div>
            <h2>{tool.title}</h2>
            <p>{tool.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}

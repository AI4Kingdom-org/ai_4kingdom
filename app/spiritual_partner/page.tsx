'use client';

import WithChat from '../components/layouts/WithChat';
import Chat from '../components/Chat/Chat';
import { ASSISTANT_IDS, VECTOR_STORE_IDS } from '../config/constants';

export default function SpiritualPartnerPage() {  // 将函数名改为符合你的页面名称
  return (
    <WithChat chatType="spiritual-partner">  // 确保这里的 chatType 与 CHAT_TYPES 中定义的一致
      <Chat

        type="spiritual-partner"  // 确保这里的 type 与 CHAT_TYPES 中定义的一致
        assistantId={ASSISTANT_IDS.SPIRITUAL_PARTNER}  // 确保这里的键名与 ASSISTANT_IDS 中定义的一致
        vectorStoreId={VECTOR_STORE_IDS.SPIRITUAL_PARTNER}  // 确保这里的键名与 VECTOR_STORE_IDS 中定义的一致
      />

    </WithChat>
  );
}
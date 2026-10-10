'use client';

import HomeschoolProfileForm from '../components/HomeschoolProfileForm';

export default function HomeschoolPrompt() {
  return (
    <HomeschoolProfileForm
      onSaved={() => {
        // 跨分頁通知
        localStorage.setItem('homeschool_data_updated', Date.now().toString());
        window.dispatchEvent(new Event('homeschool_data_updated'));
      }}
    />
  );
}

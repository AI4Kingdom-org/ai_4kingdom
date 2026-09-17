'use client';

import { useEffect } from 'react';

// 嵌在 WordPress shortcode iframe 裡時，把頁面實際高度回報給外層，讓 iframe 跟著內容長高，
// 整頁只剩 WordPress 本身一條 scroll bar。
//
// 協定（外層腳本在 WordPress 的 a4k iframe shortcode 內）：
//   iframe → 外層  { type: 'a4k-iframe-height', height }
//   外層 → iframe  { type: 'a4k-iframe-viewport', top, bottom, height }
//     top / bottom 是使用者目前「看得到」的範圍在 iframe 內的座標。
//
// 收到第一個 viewport 訊息才切換成自動高度模式（html.a4k-autoheight），
// 所以舊版固定高度的 shortcode 行為完全不變。
// iframe 變高後 position: fixed 會以整個 iframe 為基準，
// 因此把可視範圍寫成 CSS 變數 --a4k-vp-top / --a4k-vp-bottom / --a4k-vp-height，
// 浮動聊天按鈕與面板用它們貼齊使用者看得到的畫面。

const HEIGHT_MESSAGE = 'a4k-iframe-height';
const VIEWPORT_MESSAGE = 'a4k-iframe-viewport';
const AUTO_HEIGHT_CLASS = 'a4k-autoheight';

export default function IframeAutoHeight() {
  useEffect(() => {
    if (window.parent === window) return;

    const root = document.documentElement;
    let parentOrigin: string | null = null;
    let lastHeight = 0;

    const measure = () => {
      const main = document.querySelector('main');
      const height = Math.ceil((main ?? document.body).getBoundingClientRect().height);
      if (height === lastHeight) return;
      lastHeight = height;
      window.parent.postMessage({ type: HEIGHT_MESSAGE, height }, parentOrigin ?? '*');
    };

    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      const data = event.data;
      if (!data || data.type !== VIEWPORT_MESSAGE) return;

      const top = Number(data.top) || 0;
      const bottom = Number(data.bottom) || 0;
      const frameHeight = Number(data.height) || window.innerHeight;

      root.style.setProperty('--a4k-vp-top', `${top}px`);
      root.style.setProperty('--a4k-vp-bottom', `${Math.max(0, frameHeight - bottom)}px`);
      root.style.setProperty('--a4k-vp-height', `${Math.max(0, bottom - top)}px`);

      if (!parentOrigin) {
        parentOrigin = event.origin;
        root.classList.add(AUTO_HEIGHT_CLASS);
        lastHeight = 0;
        setTimeout(measure, 0);
      }
    };

    window.addEventListener('message', onMessage);

    const observer = new ResizeObserver(() => measure());
    observer.observe(document.body);
    const main = document.querySelector('main');
    if (main) observer.observe(main);
    measure();

    return () => {
      window.removeEventListener('message', onMessage);
      observer.disconnect();
      root.classList.remove(AUTO_HEIGHT_CLASS);
      ['--a4k-vp-top', '--a4k-vp-bottom', '--a4k-vp-height'].forEach((name) => root.style.removeProperty(name));
    };
  }, []);

  return null;
}

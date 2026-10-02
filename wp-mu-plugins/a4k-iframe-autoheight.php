<?php
/**
 * Plugin Name: AI4Kingdom Iframe Auto Height
 * Description: 讓 [*_iframe] shortcode 嵌入的 Next.js 助手頁面跟著內容長高，整頁只剩 WordPress 一條 scroll bar。
 * Version:     1.0.0
 *
 * 為什麼是 mu-plugin 而不是改 shortcode 本身：shortcode 寫在 hello-biz 主題裡，
 * 主題更新會整個資料夾覆蓋（auth.php 就這樣消失過）。這裡用 do_shortcode_tag
 * 在所有 *_iframe shortcode 的輸出後面附上一次腳本，效果等同改 shortcode，且不受更新影響。
 *
 * 只有 iframe 內頁面主動回報高度（app/components/IframeAutoHeight.tsx）才會生效；
 * 沒回報的頁面（聊天型助手等）維持原本固定高度，完全不受影響。
 *
 * 協定：
 *   iframe → 外層  { type: 'a4k-iframe-height', height }
 *   外層 → iframe  { type: 'a4k-iframe-viewport', top, bottom, height }
 *
 * @package AI4Kingdom
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_filter(
	'do_shortcode_tag',
	function ( $output, $tag ) {
		static $printed = false;

		if ( $printed || ! is_string( $output ) || substr( $tag, -7 ) !== '_iframe' ) {
			return $output;
		}
		$printed = true;

		ob_start();
		?>
<script id="a4k-iframe-autoheight">
(function () {
  if (window.__a4kIframeAutoHeight) return;
  window.__a4kIframeAutoHeight = true;

  var ALLOWED = (window.A4K_IFRAME_ORIGINS || ['https://main.d1b5nk0vz3t0hz.amplifyapp.com']);
  var frames = [];
  var pending = false;

  function findFrame(source) {
    var list = document.getElementsByTagName('iframe');
    for (var i = 0; i < list.length; i++) {
      if (list[i].contentWindow === source) return list[i];
    }
    return null;
  }

  function sendViewport(frame) {
    if (!frame.contentWindow) return;
    var rect = frame.getBoundingClientRect();
    var viewHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    var top = Math.max(0, -rect.top);
    var bottom = Math.max(top, Math.min(rect.height, viewHeight - rect.top));
    frame.contentWindow.postMessage({
      type: 'a4k-iframe-viewport',
      top: Math.round(top),
      bottom: Math.round(bottom),
      height: Math.round(rect.height)
    }, frame.__a4kOrigin);
  }

  function sendAll() {
    pending = false;
    for (var i = 0; i < frames.length; i++) sendViewport(frames[i]);
  }

  function schedule() {
    if (pending) return;
    pending = true;
    window.requestAnimationFrame(sendAll);
  }

  window.addEventListener('message', function (event) {
    if (ALLOWED.indexOf(event.origin) === -1) return;
    var data = event.data;
    if (!data || data.type !== 'a4k-iframe-height') return;
    var height = Math.ceil(Number(data.height));
    if (!(height > 0)) return;

    var frame = findFrame(event.source);
    if (!frame) return;

    if (!frame.__a4kOrigin) {
      frame.__a4kOrigin = event.origin;
      frames.push(frame);
      var box = frame.parentElement;
      if (box) {
        box.style.setProperty('height', 'auto', 'important');
        box.style.setProperty('min-height', '0', 'important');
        box.style.setProperty('overflow', 'visible', 'important');
      }
      frame.setAttribute('scrolling', 'no');
    }

    frame.style.setProperty('height', height + 'px', 'important');
    sendViewport(frame);
  });

  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', schedule);
    window.visualViewport.addEventListener('scroll', schedule);
  }
})();
</script>
		<?php
		return $output . ob_get_clean();
	},
	10,
	2
);

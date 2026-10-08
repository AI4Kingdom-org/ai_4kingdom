<?php
/**
 * Plugin Name: AI4Kingdom PMS Checkout Design
 * Description: 會員註冊與更改方案表單的改版樣式與互動（方案卡片、按月/按年切換、訂單摘要、額度說明）。
 * Version:     1.1.0
 *
 * 樣式與腳本放在同目錄的 a4k-pms-checkout.css / .js，版本號取檔案修改時間。
 * 這台機器的 OPcache 不會重新編譯「已存在」的 PHP 檔，改 PHP 必須換檔名或重啟 Apache；
 * 靜態檔不受影響，所以日後調整樣式或互動只需重新上傳 .css / .js。
 *
 * 只做「加強」：PMS 原本的 radio、欄位、送出按鈕、Stripe 付款區全部保留在原位，
 * 伺服器收到的表單內容與改版前完全相同。腳本失敗時表單退回 PMS 預設樣式仍可使用。
 * 刻意不搬動 #pms-stripe-connect（Stripe iframe 被搬動會重新載入而失效），所以所有寬度都是單欄；
 * 也不改原送出按鈕的 value（PMS 可能以按鈕文字判斷升級/降級），改用代理按鈕 click() 原按鈕。
 *
 * 依賴 a4k-pms-styles.php 的 a4k_pms_page_needs_styles()，只在會員頁面載入。
 *
 * 取代 1.0.0 的 a4k-pms-design.php（CSS/JS 內嵌於 PHP），兩者不可同時存在。
 *
 * @package AI4Kingdom
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_action(
	'wp_enqueue_scripts',
	function () {
		if ( ! function_exists( 'a4k_pms_page_needs_styles' ) || ! a4k_pms_page_needs_styles() ) {
			return;
		}

		foreach ( array( 'css', 'js' ) as $ext ) {
			$file = WPMU_PLUGIN_DIR . '/a4k-pms-checkout.' . $ext;
			if ( ! file_exists( $file ) ) {
				continue;
			}
			$url = WPMU_PLUGIN_URL . '/a4k-pms-checkout.' . $ext;
			$ver = (string) filemtime( $file );

			if ( 'css' === $ext ) {
				wp_enqueue_style( 'a4k-pms-checkout', $url, array(), $ver );
			} else {
				wp_enqueue_script( 'a4k-pms-checkout', $url, array(), $ver, true );
			}
		}
	},
	20
);

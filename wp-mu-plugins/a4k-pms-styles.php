<?php
/**
 * Plugin Name: AI4Kingdom PMS Styles
 * Description: 在 <head> 載入 Paid Member Subscriptions 的前台樣式。
 * Version:     1.0.0
 *
 * PMS 在頁面內容渲染時才 enqueue 樣式，屬於「晚到」的樣式，WordPress 會把它排到頁尾。
 * 本站（WordPress 7.1 + Weglot 整頁輸出緩衝）頁尾樣式一律不會輸出——Query Monitor
 * 顯示 pms-style-front-end 已排入頁尾佇列，但頁面上找不到它，<body> 裡的樣式表是 0 個。
 *
 * 後果不只是表單沒樣式：蜜罐欄位 beehive 的隱藏規則就在這支 CSS 裡，所以蜜罐以
 * 「Custom Field」的樣子露出來，真人填了會被擋下註冊與改方案。
 *
 * 這裡在 wp_enqueue_scripts 提早用同一個 handle 排入，樣式就會在 <head> 輸出；
 * PMS 之後的 enqueue 因為 handle 已存在而不會重複。
 *
 * @package AI4Kingdom
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** 這一頁是否需要 PMS 樣式：PMS 設定裡的會員頁面，或內容含 [pms-*] shortcode 的頁面。 */
function a4k_pms_page_needs_styles() {
	if ( ! is_singular() ) {
		return false;
	}

	$post = get_post();
	if ( ! $post ) {
		return false;
	}

	$settings = get_option( 'pms_general_settings', array() );
	$pages    = array();
	foreach ( array( 'register_page', 'login_page', 'account_page', 'lost_password_page' ) as $key ) {
		if ( ! empty( $settings[ $key ] ) && '-1' !== (string) $settings[ $key ] ) {
			$pages[] = (int) $settings[ $key ];
		}
	}

	if ( in_array( (int) $post->ID, $pages, true ) ) {
		return true;
	}

	if ( false !== strpos( (string) $post->post_content, '[pms-' ) ) {
		return true;
	}

	// Elementor 頁面的 shortcode 存在 _elementor_data，不在 post_content。
	$elementor = get_post_meta( $post->ID, '_elementor_data', true );
	return is_string( $elementor ) && false !== strpos( $elementor, '[pms-' );
}

add_action(
	'wp_enqueue_scripts',
	function () {
		if ( ! defined( 'PMS_PLUGIN_DIR_URL' ) || ! defined( 'PMS_VERSION' ) ) {
			return;
		}

		$settings = get_option( 'pms_general_settings', array() );
		if ( empty( $settings['use_pms_css'] ) ) {
			return;
		}

		if ( a4k_pms_page_needs_styles() ) {
			wp_enqueue_style(
				'pms-style-front-end',
				PMS_PLUGIN_DIR_URL . 'assets/css/style-front-end.css',
				array(),
				PMS_VERSION
			);
		}
	},
	5
);

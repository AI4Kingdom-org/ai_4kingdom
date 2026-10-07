<?php
/**
 * Plugin Name: AI4Kingdom Public Assistant Iframes
 * Description: 讓未登入訪客也能看到助手頁面：主題的 [*_iframe] shortcode 對訪客只輸出「请先登录查看内容」，這裡改成輸出 iframe。
 * Version:     1.0.0
 *
 * 2026-10 起所有助手與牧者／教會頁面對訪客開放（訪客有 50 點一次性試用額度，
 * 額度與權限由 Next.js 伺服器端以簽章身分判定，見 a4k-app-identity.php）。
 *
 * 為什麼不直接改主題：shortcode 定義在 hello-biz 主題的 functions.php，主題更新會覆蓋；
 * 而且 wp-admin 已停用檔案編輯。這裡只在「未登入 + 白名單內的 shortcode」時替換輸出，
 * 會員看到的仍是主題原本的輸出（含 userId / nonce 參數）。
 *
 * 用 do_shortcode_tag（priority 5）而非 pre_do_shortcode_tag：後者會略過 do_shortcode_tag，
 * 使 a4k-iframe-autoheight.php（priority 10）的自動高度腳本不會附上。
 *
 * @package AI4Kingdom
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! defined( 'A4K_APP_BASE' ) ) {
	define( 'A4K_APP_BASE', 'https://main.d1b5nk0vz3t0hz.amplifyapp.com' );
}

/**
 * 對訪客開放的 shortcode → Next.js 頁面路徑。
 * 未列出的（user_credit、user_data、homeschool_prompt、test_module、ai_tools_admin 等）
 * 屬於帳戶或管理頁，維持主題原本「需登入」的行為。
 */
function a4k_public_iframe_map() {
	return apply_filters(
		'a4k_public_iframe_map',
		array(
			'spiritual_partner_iframe'      => '/spiritual-partner/',
			'life_mentor_iframe'            => '/life-mentor/',
			'teen_console_iframe'           => '/teen-console/',
			'child_mental_iframe'           => '/child-mental/',
			'home_console_iframe'           => '/home-console/',
			'johnsung_iframe'               => '/johnsung/',
			'kou_shih_yuan_iframe'          => '/kou-shih-yuan/',
			'homeschool_iframe'             => '/homeschool/',
			'jian_zhu_navigator_iframe'     => '/jian-zhu/navigator/',
			'agape_church_iframe'           => '/agape-church/',
			'east_christ_home_iframe'       => '/east-christ-home/',
			'cfsc_church_iframe'            => '/cfsc-church/',
			'chinese_pastor_network_iframe' => '/chinese-pastor-network/',
			'zhiming_yuan_iframe'           => '/zhiming-yuan/',
			'sunday_guide_v2_iframe'        => '/sunday-guide-v2/',
			'ai_tools_iframe'               => '/ai-tools/',
		)
	);
}

/** 產生與主題相同結構的 iframe（優先沿用主題的 get_iframe_html，取得相同樣式）。 */
function a4k_public_iframe_html( $tag, $path ) {
	$module = substr( $tag, 0, -7 ) . '_module'; // agape_church_iframe → agape_church_module
	$url    = A4K_APP_BASE . $path;

	if ( function_exists( 'get_iframe_html' ) ) {
		try {
			$html = get_iframe_html( $module, $url );
			if ( is_string( $html ) && '' !== $html ) {
				return $html;
			}
		} catch ( \Throwable $e ) {
			// 主題函式簽名若改變就退回下方的備用標記
			error_log( '[a4k-public-iframes] get_iframe_html failed: ' . $e->getMessage() );
		}
	}

	return sprintf(
		'<div class="%1$s-container" style="width:100%%;height:100vh;"><iframe src="%2$s" class="%1$s-iframe" style="width:100%%;height:100%%;border:0;" sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups" allow="clipboard-write; microphone" loading="lazy"></iframe></div>',
		esc_attr( $module ),
		esc_url( $url )
	);
}

add_filter(
	'do_shortcode_tag',
	function ( $output, $tag ) {
		if ( is_user_logged_in() ) {
			return $output;
		}
		$map = a4k_public_iframe_map();
		if ( ! isset( $map[ $tag ] ) ) {
			return $output;
		}
		return a4k_public_iframe_html( $tag, $map[ $tag ] );
	},
	5,
	2
);

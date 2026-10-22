<?php
/**
 * Plugin Name: AI4Kingdom Slug Redirects
 * Description: 頁面 slug 由中文改成英文後，把舊的中文網址 301 轉到新網址。
 * Version:     1.0.0
 *
 * 為什麼要自己做：WordPress 只替「文章」記 _wp_old_slug 自動轉址，「頁面」改 slug
 * 後舊網址直接 404；站上也沒有 Redirection 之類的外掛。
 *
 * 只在請求本來會 404 時才轉址，所以 slug 改之前上傳也不會影響舊網址。
 * Weglot 的 /en/、/tw/ 前綴會保留；Weglot 會改寫 REQUEST_URI，所以在 mu-plugin
 * 載入時（早於一般外掛）先記下原始路徑。
 *
 * @package AI4Kingdom
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$GLOBALS['a4k_slug_redirects_uri'] = isset( $_SERVER['REQUEST_URI'] ) ? (string) $_SERVER['REQUEST_URI'] : '';

add_action(
	'template_redirect',
	function () {
		if ( ! is_404() ) {
			return;
		}

		// 舊 slug（解碼後）=> 新 slug。
		$map = array(
			'主日教導'                 => 'sunday-guide',
			'主日教导-远志明牧师'          => 'zhiming-yuan',
			'主日教導-祝健牧師'           => 'jian-zhu',
			'主日教導-東區基督之家'         => 'east-christ-home',
			'主日教導-愛修基督教會'         => 'agape-church',
			'爱修基督教会ai儿童主日学'       => 'agape-church-kids-sunday-school',
			'愛修基督教會ai儿童主日学'       => 'agape-church-kids-sunday-school',
			'耶稣团契-csfc-church'     => 'csfc-church',
			'华牧网络教会事工联盟'          => 'chinese-pastor-network',
			'宋尚節牧師屬靈問答'           => 'johnsung',
			'信仰與家庭属灵辅导助手'         => 'life-mentor',
			'儿童貼心属灵辅导'            => 'kids-spiritual-counselor',
			'家庭属灵辅导'              => 'family-spiritual-counselor',
			'信仰问答'                => 'spiritual-partner',
			'hbu-學生ai作品展示'        => 'hbu-student-ai-showcase',
			'最新-ai-tools-工具介紹'    => 'ai-tools',
			'使用國度ai最新gpt'         => 'kingdom-ai-gpt',
			'最新發佈'                => 'latest',
			'国度ai'                => 'kingdom-ai',
			'國度ai'                => 'kingdom-ai-tw',
		);

		$uri   = $GLOBALS['a4k_slug_redirects_uri'];
		$path  = rawurldecode( (string) wp_parse_url( $uri, PHP_URL_PATH ) );
		$query = (string) wp_parse_url( $uri, PHP_URL_QUERY );

		if ( ! preg_match( '#^/(?:(en|tw)/)?([^/]+)/?$#u', $path, $m ) ) {
			return;
		}

		$old = function_exists( 'mb_strtolower' ) ? mb_strtolower( $m[2], 'UTF-8' ) : strtolower( $m[2] );
		if ( ! isset( $map[ $old ] ) ) {
			return;
		}

		$target = home_url( '/' . ( $m[1] ? $m[1] . '/' : '' ) . $map[ $old ] . '/' );
		if ( '' !== $query ) {
			$target .= '?' . $query;
		}

		wp_safe_redirect( $target, 301, 'AI4Kingdom Slug Redirects' );
		exit;
	},
	1
);

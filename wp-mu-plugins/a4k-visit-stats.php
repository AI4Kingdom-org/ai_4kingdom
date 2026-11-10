<?php
/**
 * Plugin Name: A4K Visit Stats
 * Description: 網站流量統計（app 的 /site-analytics 後台頁）。前台頁尾送出匿名瀏覽紀錄到 app；提供 service token 保護的註冊統計端點。
 * Version: 1.0.0
 *
 * 上線位置：wp-content/mu-plugins/a4k-visit-stats.php
 *
 * 1) 前台頁尾內嵌一小段腳本，以 navigator.sendBeacon 送到
 *    A4K_APP_BASE/api/analytics/collect（site=wp）。資料寫在 app 的 DynamoDB，
 *    WordPress 不做任何資料庫寫入；不設 cookie。
 *    後台、預覽、Elementor 編輯器、可編輯文章的登入者（管理員／編輯）都不計入。
 *
 * 2) GET /wp-json/custom/v1/signup_stats?from=YYYY-MM-DD&to=YYYY-MM-DD
 *    需 X-A4K-Service-Token（與 a4kmembershipv2.php 相同的 A4K_SERVICE_TOKEN）。
 *    回傳區間內每日（UTC）新註冊數與總帳號數；一次 GROUP BY 查詢，結果快取 10 分鐘。
 *
 * @package AI4Kingdom
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function a4k_visit_stats_app_base() {
	return defined( 'A4K_APP_BASE' ) ? A4K_APP_BASE : 'https://main.d1b5nk0vz3t0hz.amplifyapp.com';
}

function a4k_visit_stats_should_track() {
	if ( is_admin() || is_feed() || is_robots() || is_trackback() || is_preview() || is_customize_preview() ) {
		return false;
	}
	// Elementor 編輯器／預覽
	if ( isset( $_GET['elementor-preview'] ) || isset( $_GET['elementor_library'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification
		return false;
	}
	if ( is_user_logged_in() && current_user_can( 'edit_posts' ) ) {
		return false;
	}
	return true;
}

add_action(
	'wp_footer',
	function () {
		if ( ! a4k_visit_stats_should_track() ) {
			return;
		}
		$endpoint = a4k_visit_stats_app_base() . '/api/analytics/collect';
		?>
<script id="a4k-visit-stats">
(function(){try{
var n=navigator;if(n.webdriver||!n.sendBeacon||!window.Blob)return;
var p=location.pathname;try{p=decodeURIComponent(p);}catch(e){}
var tz='';try{tz=Intl.DateTimeFormat().resolvedOptions().timeZone||'';}catch(e){}
var d=JSON.stringify({site:'wp',path:<?php echo is_404() ? "'(404)'" : 'p'; ?>,ref:document.referrer||'',tz:tz});
n.sendBeacon(<?php echo wp_json_encode( $endpoint ); ?>,new Blob([d],{type:'text/plain'}));
}catch(e){}})();
</script>
		<?php
	},
	100
);

/** 與 a4kmembershipv2.php 的 a4k_is_service_request() 相同判定；該檔載入順序在本檔之後，故不直接依賴。 */
function a4k_visit_stats_is_service_request( WP_REST_Request $request ) {
	if ( ! defined( 'A4K_SERVICE_TOKEN' ) || ! A4K_SERVICE_TOKEN ) {
		return false;
	}
	$sent = (string) $request->get_header( 'x_a4k_service_token' );
	return '' !== $sent && hash_equals( (string) A4K_SERVICE_TOKEN, $sent );
}

function a4k_visit_stats_valid_date( $value ) {
	return is_string( $value ) && preg_match( '/^\d{4}-\d{2}-\d{2}$/', $value ) && strtotime( $value . ' 00:00:00 UTC' );
}

function a4k_visit_stats_signups( WP_REST_Request $request ) {
	$from = (string) $request->get_param( 'from' );
	$to   = (string) $request->get_param( 'to' );
	if ( ! a4k_visit_stats_valid_date( $from ) || ! a4k_visit_stats_valid_date( $to ) || $from > $to ) {
		return new WP_Error( 'a4k_bad_range', 'from/to must be YYYY-MM-DD and from <= to', array( 'status' => 400 ) );
	}

	$cache_key = 'a4k_signups_' . md5( $from . '|' . $to );
	$cached    = get_transient( $cache_key );
	if ( false !== $cached ) {
		return rest_ensure_response( $cached );
	}

	global $wpdb;
	$end_exclusive = gmdate( 'Y-m-d', strtotime( $to . ' 00:00:00 UTC' ) + DAY_IN_SECONDS );
	// user_registered 以 UTC 儲存。
	$rows = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT DATE(user_registered) AS day, COUNT(*) AS signups
			 FROM {$wpdb->users}
			 WHERE user_registered >= %s AND user_registered < %s
			 GROUP BY DATE(user_registered)
			 ORDER BY day",
			$from . ' 00:00:00',
			$end_exclusive . ' 00:00:00'
		),
		ARRAY_A
	);

	$daily = array();
	foreach ( (array) $rows as $row ) {
		$daily[] = array(
			'day'     => $row['day'],
			'signups' => (int) $row['signups'],
		);
	}

	$payload = array(
		'from'       => $from,
		'to'         => $to,
		'daily'      => $daily,
		'totalUsers' => (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$wpdb->users}" ),
		'generated'  => gmdate( 'c' ),
	);
	set_transient( $cache_key, $payload, 10 * MINUTE_IN_SECONDS );
	return rest_ensure_response( $payload );
}

add_action(
	'rest_api_init',
	function () {
		register_rest_route(
			'custom/v1',
			'/signup_stats',
			array(
				'methods'             => 'GET',
				'callback'            => 'a4k_visit_stats_signups',
				'permission_callback' => 'a4k_visit_stats_is_service_request',
			)
		);
	}
);

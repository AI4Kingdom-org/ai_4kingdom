<?php
/**
 * Plugin Name: AI4Kingdom App Identity
 * Description: 在 session 端點回應中附上簽章的 app_token，讓 Next.js 伺服器端能確認會員身分。
 * Version:     1.0.0
 *
 * 為什麼需要：Next.js app 與 WordPress 不同網域，伺服器端讀不到 WP 登入 cookie，
 * 過去只能相信前端帶來的 userId（任何人都能冒用）。現在由 WP 在確認 cookie 後簽發
 * 短效 token，app 端用同一把衍生金鑰驗章即可，不必每次回呼 WordPress。
 *
 * 金鑰：hash_hmac('sha256', 'a4k-identity-v1', A4K_SERVICE_TOKEN, true)
 *       app 端以 WP_SERVICE_TOKEN 算出同一把（app/lib/identity/server.ts）。
 *
 * 為什麼是獨立檔案而不是改 a4k-membership-v2.php：這台主機的 OPcache 不會重載
 * 已存在的同名 PHP 檔，新檔名才會立即生效。
 *
 * @package AI4Kingdom
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** token 有效期（秒）。前端每 30 分鐘重新取得 session，快到期時也會主動刷新。 */
const A4K_APP_TOKEN_TTL = 7200;

function a4k_app_b64url( $raw ) {
	return rtrim( strtr( base64_encode( $raw ), '+/', '-_' ), '=' );
}

/** 簽發會員 token；未設定 A4K_SERVICE_TOKEN 時回傳 null（app 端會以訪客處理）。 */
function a4k_app_member_token( $user_id ) {
	if ( ! defined( 'A4K_SERVICE_TOKEN' ) || ! A4K_SERVICE_TOKEN ) {
		return null;
	}

	$plan = 'free';
	if ( function_exists( 'a4k_get_subscription' ) ) {
		$subscription = a4k_get_subscription( $user_id );
		if ( ! empty( $subscription['type'] ) ) {
			$plan = (string) $subscription['type'];
		}
	}

	$payload = a4k_app_b64url(
		wp_json_encode(
			array(
				't'    => 'm',
				'uid'  => (string) $user_id,
				'plan' => $plan,
				'exp'  => time() + A4K_APP_TOKEN_TTL,
			)
		)
	);

	$key = hash_hmac( 'sha256', 'a4k-identity-v1', (string) A4K_SERVICE_TOKEN, true );
	return $payload . '.' . a4k_app_b64url( hash_hmac( 'sha256', $payload, $key, true ) );
}

/**
 * 只在「以 cookie 判定目前使用者」的回應上附 token。
 * 服務端用 userId 查他人方案（POST validate_session）時不附，避免持有 service token 的呼叫端代簽任意使用者。
 */
add_filter(
	'rest_post_dispatch',
	function ( $result, $server, $request ) {
		$route = $request->get_route();
		$is_session_route = ( '/hello-biz/v1/session' === $route )
			|| ( '/custom/v1/validate_session' === $route && 'GET' === $request->get_method() && ! $request->get_param( 'userId' ) );

		if ( ! $is_session_route || ! ( $result instanceof WP_REST_Response ) ) {
			return $result;
		}

		$data = $result->get_data();
		$user_id = get_current_user_id();
		if ( empty( $data['logged_in'] ) || ! $user_id || (int) ( $data['user']['id'] ?? 0 ) !== $user_id ) {
			return $result;
		}

		$token = a4k_app_member_token( $user_id );
		if ( $token ) {
			$data['app_token'] = $token;
			$result->set_data( $data );
		}
		return $result;
	},
	10,
	3
);

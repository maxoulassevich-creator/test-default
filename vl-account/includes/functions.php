<?php
/**
 * Общие функции-помощники.
 *
 * @package VL_Account
 */

defined( 'ABSPATH' ) || exit;

/**
 * Загрузить шаблон плагина с возможностью переопределения в теме.
 *
 * Порядок поиска:
 *  1. wp-content/themes/child-theme/vl-account/{$template}
 *  2. wp-content/themes/theme/vl-account/{$template}
 *  3. wp-content/plugins/vl-account/templates/{$template}
 *
 * @param string $template Относительный путь, например 'form-login.php'.
 * @param array  $args     Переменные шаблона.
 * @param bool   $return   Вернуть строкой вместо вывода.
 * @return string|void
 */
function vlacc_template( $template, $args = array(), $return = false ) {
	$template = ltrim( $template, '/' );

	$located = locate_template( array( 'vl-account/' . $template ) );
	if ( ! $located ) {
		$located = VLACC_PATH . 'templates/' . $template;
	}

	$located = apply_filters( 'vlacc_template_path', $located, $template, $args );

	if ( ! file_exists( $located ) ) {
		return $return ? '' : null;
	}

	if ( is_array( $args ) ) {
		// phpcs:ignore WordPress.PHP.DontExtract.extract_extract -- контролируемый массив шаблона.
		extract( $args, EXTR_SKIP );
	}

	if ( $return ) {
		ob_start();
		include $located;
		return ob_get_clean();
	}

	include $located;
}

/**
 * IP клиента (с учётом прокси/CDN).
 *
 * @return string
 */
function vlacc_client_ip() {
	$keys = array( 'HTTP_CF_CONNECTING_IP', 'HTTP_X_REAL_IP', 'HTTP_X_FORWARDED_FOR', 'REMOTE_ADDR' );

	foreach ( $keys as $key ) {
		if ( empty( $_SERVER[ $key ] ) ) {
			continue;
		}
		$value = sanitize_text_field( wp_unslash( $_SERVER[ $key ] ) );
		$parts = explode( ',', $value );
		$ip    = trim( $parts[0] );
		if ( filter_var( $ip, FILTER_VALIDATE_IP ) ) {
			return $ip;
		}
	}

	return '0.0.0.0';
}

/**
 * Запись в журнал плагина (последние 200 записей в опции).
 *
 * @param string $message Сообщение.
 * @param array  $context Контекст.
 */
function vlacc_log( $message, $context = array() ) {
	if ( ! VL_Account_Settings::get( 'logging', 1 ) ) {
		return;
	}

	$log = get_option( 'vlacc_log', array() );
	if ( ! is_array( $log ) ) {
		$log = array();
	}

	array_unshift(
		$log,
		array(
			'time'    => current_time( 'mysql' ),
			'message' => (string) $message,
			'context' => $context,
		)
	);

	$log = array_slice( $log, 0, 200 );
	update_option( 'vlacc_log', $log, false );
}

/**
 * Маскирование телефона для вывода: +7 (926) ***-**-12.
 *
 * @param string $phone Телефон в любом формате.
 * @return string
 */
function vlacc_mask_phone( $phone ) {
	$digits = preg_replace( '/\D+/', '', (string) $phone );
	if ( strlen( $digits ) < 4 ) {
		return '';
	}
	$tail = substr( $digits, -2 );
	$head = substr( $digits, 0, 4 );
	return sprintf( '+%s (%s) ***-**-%s', substr( $head, 0, 1 ), substr( $digits, 1, 3 ), $tail );
}

/**
 * Маскирование e-mail: iva***@mail.ru.
 *
 * @param string $email E-mail.
 * @return string
 */
function vlacc_mask_email( $email ) {
	if ( ! is_email( $email ) ) {
		return '';
	}
	list( $name, $domain ) = explode( '@', $email, 2 );
	$visible               = mb_substr( $name, 0, min( 3, mb_strlen( $name ) ) );
	return $visible . '***@' . $domain;
}

/**
 * Активен ли WooCommerce.
 *
 * @return bool
 */
function vlacc_is_woo() {
	return class_exists( 'WooCommerce' );
}

/**
 * Безопасный редирект-URL из запроса.
 *
 * @param string $fallback Куда вести, если ничего не передано.
 * @return string
 */
function vlacc_redirect_url( $fallback = '' ) {
	$redirect = '';

	if ( ! empty( $_REQUEST['redirect_to'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$redirect = esc_url_raw( wp_unslash( $_REQUEST['redirect_to'] ) ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended
	}

	if ( ! $redirect ) {
		$redirect = $fallback ? $fallback : VL_Account_Settings::account_url();
	}

	return wp_validate_redirect( $redirect, VL_Account_Settings::account_url() );
}

/**
 * Иконка из набора плагина.
 *
 * @param string $name Имя иконки.
 * @param int    $size Размер.
 * @return string SVG-разметка.
 */
function vlacc_icon( $name, $size = 20 ) {
	$icons = array(
		'user'     => '<path d="M12 12a5 5 0 100-10 5 5 0 000 10zm0 2c-4.4 0-8 2.4-8 5.5V22h16v-2.5c0-3.1-3.6-5.5-8-5.5z"/>',
		'logout'   => '<path d="M14 3h5a2 2 0 012 2v14a2 2 0 01-2 2h-5v-2h5V5h-5V3zM9.7 7.3l1.4 1.4L8.8 11H16v2H8.8l2.3 2.3-1.4 1.4L5 12l4.7-4.7z"/>',
		'orders'   => '<path d="M6 2h9l5 5v15H6a2 2 0 01-2-2V4a2 2 0 012-2zm8 1.5V8h4.5L14 3.5zM8 12h8v2H8v-2zm0 4h8v2H8v-2z"/>',
		'heart'    => '<path d="M12 21s-8-4.9-8-10.3A4.7 4.7 0 0112 7a4.7 4.7 0 018 3.7C20 16.1 12 21 12 21z"/>',
		'gift'     => '<path d="M20 8h-2.2a3 3 0 00-4.3-4A3 3 0 0012 5.2 3 3 0 0010.5 4a3 3 0 00-4.3 4H4v4h16V8zm-9 6H4v7h7v-7zm2 0v7h7v-7h-7z"/>',
		'star'     => '<path d="M12 2l3 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.9 21l1.2-6.8-5-4.9 6.9-1L12 2z"/>',
		'bell'     => '<path d="M12 22a2.5 2.5 0 002.5-2.5h-5A2.5 2.5 0 0012 22zm7-5.5V11a7 7 0 10-14 0v5.5L3 18v1h18v-1l-2-1.5z"/>',
		'settings' => '<path d="M12 8a4 4 0 100 8 4 4 0 000-8zm9 4l2 1.6-1.9 3.3-2.4-.8a7.8 7.8 0 01-1.7 1l-.4 2.5h-3.8l-.4-2.5a7.8 7.8 0 01-1.7-1l-2.4.8L1 13.6 3 12l-2-1.6 1.9-3.3 2.4.8c.5-.4 1.1-.7 1.7-1L7.4 4h3.8l.4 2.5c.6.3 1.2.6 1.7 1l2.4-.8L23 10.4 21 12z"/>',
		'lock'     => '<path d="M17 9V7a5 5 0 00-10 0v2H5v12h14V9h-2zM9 7a3 3 0 016 0v2H9V7z"/>',
		'copy'     => '<path d="M16 1H4a2 2 0 00-2 2v14h2V3h12V1zm3 4H8a2 2 0 00-2 2v14a2 2 0 002 2h11a2 2 0 002-2V7a2 2 0 00-2-2z"/>',
		'check'    => '<path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/>',
		'phone'    => '<path d="M6.6 10.8a15 15 0 006.6 6.6l2.2-2.2a1 1 0 011-.2c1.1.4 2.3.6 3.6.6a1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1c0 1.3.2 2.5.6 3.6a1 1 0 01-.2 1l-2.3 2.2z"/>',
		'telegram' => '<path d="M21.9 4.3l-3 14.2c-.2 1-.8 1.3-1.7.8l-4.6-3.4-2.2 2.2c-.3.3-.5.5-1 .5l.3-4.7L18.3 6c.4-.3-.1-.5-.6-.2L7.2 12.4l-4.5-1.4c-1-.3-1-1 .2-1.5l17.6-6.8c.8-.3 1.5.2 1.4 1.6z"/>',
	);

	if ( ! isset( $icons[ $name ] ) ) {
		return '';
	}

	return sprintf(
		'<svg class="vl-icon vl-icon--%1$s" width="%2$d" height="%2$d" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">%3$s</svg>',
		esc_attr( $name ),
		(int) $size,
		$icons[ $name ]
	);
}

/**
 * Разрешённые HTML-теги для вывода наших SVG/разметки.
 *
 * @return array
 */
function vlacc_allowed_html() {
	$allowed = wp_kses_allowed_html( 'post' );

	$allowed['svg']  = array(
		'class'       => true,
		'width'       => true,
		'height'      => true,
		'viewbox'     => true,
		'fill'        => true,
		'aria-hidden' => true,
		'focusable'   => true,
		'xmlns'       => true,
	);
	$allowed['path'] = array(
		'd'    => true,
		'fill' => true,
	);

	return $allowed;
}

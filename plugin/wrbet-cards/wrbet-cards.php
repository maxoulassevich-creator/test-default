<?php
/**
 * Plugin Name:       Wrbet Cards
 * Plugin URI:        https://github.com/maxoulassevich-creator/test-default
 * Description:       Two animated betting widgets — a live odds card and a crash-round card — rendered through shortcodes. Text, fonts, colours and animation are all configurable, and the widgets paint no background of their own.
 * Version:           1.0.0
 * Requires at least: 5.8
 * Requires PHP:      7.4
 * Author:            Wrbet
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       wrbet-cards
 * Domain Path:       /languages
 *
 * @package Wrbet_Cards
 */

defined( 'ABSPATH' ) || exit;

define( 'WRBET_CARDS_VERSION', '1.0.0' );
define( 'WRBET_CARDS_FILE', __FILE__ );
define( 'WRBET_CARDS_DIR', plugin_dir_path( __FILE__ ) );
define( 'WRBET_CARDS_URL', plugin_dir_url( __FILE__ ) );
define( 'WRBET_CARDS_OPTION', 'wrbet_cards_options' );

require_once WRBET_CARDS_DIR . 'includes/class-wrbet-cards-settings.php';
require_once WRBET_CARDS_DIR . 'includes/class-wrbet-cards-shortcodes.php';

/**
 * Every setting the plugin knows about, with its default value.
 *
 * The same keys work as shortcode attributes, so anything on this list can be
 * overridden per instance without touching the global settings.
 *
 * @return array<string, mixed>
 */
function wrbet_cards_defaults() {
	return array(

		/* ---- colours ---- */
		'accent'      => '#00FFF7',
		'ink'         => '#1B1B1B',
		'text'        => '#f2f2f2',
		'muted'       => 'rgba(242,242,242,0.66)',
		'faint'       => 'rgba(242,242,242,0.58)',
		'card_bg'     => '#202020',
		'card_bg2'    => '#1B1B1B',
		'border'      => 'rgba(242,242,242,0.18)',
		'gray'        => '#494949',
		'danger'      => '#8D0203',
		'danger_text' => '#ff8f8f',

		/* ---- shape ---- */
		'radius'      => '24',
		'padding'     => '22',
		'max_width'   => '460',
		'shadow'      => '1',
		'surface'     => '1', // 0 renders the card itself transparent too.

		/* ---- typography ---- */
		'font_source' => 'bundled', // bundled | theme | custom
		'font_head'   => 'Sora',
		'font_body'   => 'Public Sans',
		'font_scale'  => '100',

		/* ---- animation ---- */
		'animate'     => '1',
		'pulse'       => '1',
		'reveal'      => '1',
		'speed'       => '1',
		'crash_min'   => '1.2',
		'crash_max'   => '8',
		'live_odds'   => '1',

		/* ---- odds card content ---- */
		'live_label'  => 'Live',
		'meta'        => 'Football · 68\'',
		'teams'       => 'HB|Harambee Bay|1, NU|Nairobi United|0',
		'odds'        => '1|1.85, X|3.40*, 2|4.20',
		'odds_note'   => 'Illustrative odds — shown to explain formats, not to place bets.',

		/* ---- crash card content ---- */
		'crash_label' => 'Crash round',
		'history'     => '1.42, 2.06, 1.01!, 7.35',
		'crash_note'  => '',
		'variant'     => 'compact', // compact | full
		'grid'        => '1',
		// Shown whenever the card is not animating: the curve is drawn in full,
		// so the number beside it has to read as a completed round, not 1.00x.
		'static_mult' => '3.20',
	);
}

/**
 * Saved settings merged over the defaults.
 *
 * @return array<string, mixed>
 */
function wrbet_cards_options() {
	static $cache = null;

	if ( null === $cache ) {
		$saved  = get_option( WRBET_CARDS_OPTION, array() );
		$cache  = wp_parse_args( is_array( $saved ) ? $saved : array(), wrbet_cards_defaults() );
	}

	return $cache;
}

/**
 * Accept hex, rgb(a), hsl(a) and the CSS-wide keywords; fall back otherwise.
 *
 * sanitize_hex_color() alone would reject the translucent values this design
 * relies on, so anything that is not a hex colour is pattern-matched instead.
 *
 * @param string $value    Raw colour.
 * @param string $fallback Value to use when $value is not a colour.
 * @return string
 */
function wrbet_cards_sanitize_color( $value, $fallback = 'transparent' ) {
	$value = trim( (string) $value );

	if ( '' === $value ) {
		return $fallback;
	}

	if ( in_array( strtolower( $value ), array( 'transparent', 'none', 'currentcolor', 'inherit' ), true ) ) {
		return strtolower( $value );
	}

	$hex = sanitize_hex_color( $value );
	if ( $hex ) {
		return $hex;
	}

	if ( preg_match( '/^(rgb|hsl)a?\(\s*[0-9.,%\s\/deg-]+\)$/i', $value ) ) {
		return $value;
	}

	return $fallback;
}

/**
 * Clamp a numeric setting.
 *
 * @param mixed $value Raw value.
 * @param float $min   Lower bound.
 * @param float $max   Upper bound.
 * @param float $fall  Fallback when not numeric.
 * @return string
 */
function wrbet_cards_sanitize_number( $value, $min, $max, $fall ) {
	if ( ! is_numeric( $value ) ) {
		return (string) $fall;
	}

	return (string) max( $min, min( $max, (float) $value ) );
}

/**
 * Boot the two halves of the plugin.
 */
function wrbet_cards_init() {
	load_plugin_textdomain( 'wrbet-cards', false, dirname( plugin_basename( WRBET_CARDS_FILE ) ) . '/languages' );

	Wrbet_Cards_Shortcodes::init();

	if ( is_admin() ) {
		Wrbet_Cards_Settings::init();
	}
}
add_action( 'plugins_loaded', 'wrbet_cards_init' );

/**
 * Link straight to the settings screen from the plugins list.
 *
 * @param array $links Existing action links.
 * @return array
 */
function wrbet_cards_action_links( $links ) {
	$url = admin_url( 'options-general.php?page=wrbet-cards' );

	array_unshift(
		$links,
		'<a href="' . esc_url( $url ) . '">' . esc_html__( 'Settings', 'wrbet-cards' ) . '</a>'
	);

	return $links;
}
add_filter( 'plugin_action_links_' . plugin_basename( __FILE__ ), 'wrbet_cards_action_links' );

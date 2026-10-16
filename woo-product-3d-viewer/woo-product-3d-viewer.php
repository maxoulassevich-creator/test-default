<?php
/**
 * Plugin Name: Woo Product 3D Viewer
 * Description: До трёх GLB/FBX/OBJ-моделей на товар WooCommerce, адаптивное окно с переключателем, настройка вида кнопки и окна, шорткод [product_3d_button].
 * Version: 1.3.0
 * Requires at least: 6.5
 * Requires PHP: 7.4
 * Requires Plugins: woocommerce
 * WC requires at least: 8.0
 * Author: Custom Development
 * License: GPL-2.0-or-later
 * Text Domain: woo-product-3d-viewer
 */

defined( 'ABSPATH' ) || exit;
define( 'W3DPV_VERSION', '1.3.0' );
define( 'W3DPV_FILE', __FILE__ );
define( 'W3DPV_PATH', plugin_dir_path( __FILE__ ) );
define( 'W3DPV_URL', plugin_dir_url( __FILE__ ) );

require_once W3DPV_PATH . 'includes/class-w3dpv-model.php';
require_once W3DPV_PATH . 'includes/class-w3dpv-cache.php';
require_once W3DPV_PATH . 'includes/class-w3dpv-plugin.php';
require_once W3DPV_PATH . 'includes/class-w3dpv-settings.php';
W3DPV_Cache::init();
register_deactivation_hook( __FILE__, array( 'W3DPV_Cache', 'deactivate' ) );

// The plugin does not read or write orders. Settings use the classic product editor only.
add_action( 'before_woocommerce_init', static function () {
	if ( class_exists( '\Automattic\WooCommerce\Utilities\FeaturesUtil' ) ) {
		\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'custom_order_tables', __FILE__, true );
		\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'product_block_editor', __FILE__, false );
	}
} );

add_action( 'plugins_loaded', static function () {

	if ( ! class_exists( 'WooCommerce' ) ) {
		add_action( 'admin_notices', static function () {
			if ( current_user_can( 'activate_plugins' ) ) {
				echo '<div class="notice notice-warning"><p>' . esc_html__( 'Woo Product 3D Viewer: активируйте WooCommerce для работы плагина.', 'woo-product-3d-viewer' ) . '</p></div>';
			}
		} );
		return;
	}
	load_plugin_textdomain( 'woo-product-3d-viewer', false, dirname( plugin_basename( __FILE__ ) ) . '/languages' );
	W3DPV_Plugin::instance();
	W3DPV_Settings::init();
} );

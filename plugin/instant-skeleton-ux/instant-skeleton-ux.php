<?php
/**
 * Plugin Name: Instant Skeleton UX
 * Plugin URI:  https://example.com/
 * Description: Точный skeleton по реальному DOM-макету страницы: сохраняет фон, фоновые изображения и декор, повторяет расположение текста, изображений, кнопок и форм без кеширования HTML.
 * Version:     2.1.0
 * Author:      Custom Development
 * Text Domain: instant-skeleton-ux
 * Domain Path: /languages
 * Requires at least: 6.2
 * Requires PHP: 7.4
 * License:     GPL-2.0-or-later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'ISUX_VERSION', '2.1.0' );
define( 'ISUX_FILE', __FILE__ );
define( 'ISUX_DIR', plugin_dir_path( __FILE__ ) );
define( 'ISUX_URL', plugin_dir_url( __FILE__ ) );

require_once ISUX_DIR . 'includes/class-isux-settings.php';
require_once ISUX_DIR . 'includes/class-isux-plugin.php';

register_activation_hook( __FILE__, array( 'ISUX_Plugin', 'activate' ) );

ISUX_Plugin::instance();

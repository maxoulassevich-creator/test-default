<?php
/**
 * Uninstall Instant Skeleton UX.
 */

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

// По умолчанию настройки сохраняются, чтобы случайное удаление плагина не
// уничтожало конфигурацию. Для полной очистки добавьте в wp-config.php:
// define( 'ISUX_REMOVE_DATA_ON_UNINSTALL', true );
if ( defined( 'ISUX_REMOVE_DATA_ON_UNINSTALL' ) && ISUX_REMOVE_DATA_ON_UNINSTALL ) {
	delete_option( 'isux_options' );
}

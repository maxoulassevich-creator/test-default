<?php
/**
 * Removes plugin options and disposable cache copies. Media files and product
 * model assignments are kept, so reinstalling restores the product settings.
 */
defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

function w3dpv_uninstall_site() {
	wp_clear_scheduled_hook( 'w3dpv_monthly_cache_cleanup' );
	delete_option( 'w3dpv_cache_generation' );
	delete_option( 'w3dpv_cache_last_cleanup' );
	foreach ( array( '_w3dpv_validated', '_w3dpv_fingerprint', '_w3dpv_invalid' ) as $key ) {
		delete_post_meta_by_key( $key );
	}
	$uploads = wp_upload_dir( null, false );
	if ( ! empty( $uploads['error'] ) ) {
		return;
	}
	$directory = trailingslashit( $uploads['basedir'] ) . 'w3dpv-model-cache';
	// Only a folder created by this plugin is cleaned; foreign files keep it from being removed.
	if ( is_link( $directory ) || ! is_dir( $directory ) || "w3dpv-cache-v1\n" !== @file_get_contents( $directory . '/.w3dpv-owned' ) ) {
		return;
	}
	foreach ( (array) scandir( $directory ) as $name ) {
		$path = $directory . '/' . $name;
		if ( preg_match( '/^(?:w3dpv-[a-f0-9]{64}\.(?:glb|fbx|obj)|w3dpv-tmp-[a-f0-9]{32}\.part|index\.html|\.htaccess|\.w3dpv-owned)$/D', $name ) && is_file( $path ) && ! is_link( $path ) ) {
			@unlink( $path );
		}
	}
	if ( is_dir( $directory . '/.write-lock' ) && ! is_link( $directory . '/.write-lock' ) ) {
		@rmdir( $directory . '/.write-lock' );
	}
	@rmdir( $directory );
}

if ( is_multisite() ) {
	foreach ( get_sites( array( 'fields' => 'ids', 'number' => 0 ) ) as $site_id ) {
		switch_to_blog( $site_id );
		w3dpv_uninstall_site();
		restore_current_blog();
	}
} else {
	w3dpv_uninstall_site();
}

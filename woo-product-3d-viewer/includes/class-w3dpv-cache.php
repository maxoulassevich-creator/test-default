<?php
defined( 'ABSPATH' ) || exit;

/** Disposable, bounded copies of validated media. Originals are never removed. */
final class W3DPV_Cache {
	const TTL = 2592000; // 30 days.
	const MAX_BYTES = 536870912; // 512 MiB per site.
	const HOOK = 'w3dpv_monthly_cache_cleanup';
	const MARKER = "w3dpv-cache-v1\n";
	private static $prepared = array();
	private static $copied_bytes = 0;

	public static function init() {
		add_filter( 'cron_schedules', array( __CLASS__, 'schedules' ) );
		add_action( self::HOOK, array( __CLASS__, 'clear' ) );
		add_action( 'init', array( __CLASS__, 'schedule' ) );
	}

	public static function schedules( $schedules ) {
		$schedules['w3dpv_monthly'] = array( 'interval' => self::TTL, 'display' => '3D-модели: каждые 30 дней' );
		return $schedules;
	}

	public static function schedule() {
		if ( ! wp_next_scheduled( self::HOOK ) ) {
			wp_schedule_event( time() + self::TTL, 'w3dpv_monthly', self::HOOK );
		}
	}

	public static function deactivate() {
		wp_clear_scheduled_hook( self::HOOK );
	}

	public static function generation() {
		$value = get_option( 'w3dpv_cache_generation' );
		if ( ! is_string( $value ) || ! preg_match( '/^[a-f0-9]{32}$/D', $value ) ) {
			$value = str_replace( '-', '', wp_generate_uuid4() );
			add_option( 'w3dpv_cache_generation', $value, '', false );
			$value = get_option( 'w3dpv_cache_generation', $value );
			if ( ! is_string( $value ) || ! preg_match( '/^[a-f0-9]{32}$/D', $value ) ) {
				$value = str_replace( '-', '', wp_generate_uuid4() );
				update_option( 'w3dpv_cache_generation', $value, false );
			}
		}
		return $value;
	}

	private static function directory( $create = false ) {
		$uploads = wp_upload_dir( null, false );
		if ( ! empty( $uploads['error'] ) ) return false;
		$path = trailingslashit( $uploads['basedir'] ) . 'w3dpv-model-cache';
		if ( is_link( $path ) ) return false;
		if ( ! is_dir( $path ) ) {
			if ( ! $create || ! wp_mkdir_p( $path ) ) return false;
		}
		$base = realpath( $uploads['basedir'] );
		$real = realpath( $path );
		if ( ! $base || ! $real || dirname( $real ) !== $base ) return false;
		if ( ! is_readable( $real ) || ( $create && ! is_writable( $real ) ) ) return false;
		$marker = $real . '/.w3dpv-owned';
		if ( ! is_file( $marker ) ) {
			// Never adopt or clean a pre-existing directory with someone else's files.
			$contents = @scandir( $real );
			if ( ! $create || ! is_array( $contents ) || array_diff( $contents, array( '.', '..' ) ) || false === @file_put_contents( $marker, self::MARKER ) ) return false;
			@file_put_contents( $real . '/index.html', '' );
			@file_put_contents( $real . '/.htaccess', "<IfModule mod_mime.c>\nAddType model/gltf-binary .glb\nAddType model/obj .obj\n</IfModule>\n<IfModule mod_headers.c>\n<FilesMatch \"\\.(glb|obj)$\">\nHeader set Cache-Control \"public, max-age=2592000, immutable\"\nHeader set X-Content-Type-Options \"nosniff\"\n</FilesMatch>\n</IfModule>\n" );
		}
		if ( is_link( $marker ) || @file_get_contents( $marker ) !== self::MARKER ) return false;
		return array( 'path' => $real, 'url' => trailingslashit( $uploads['baseurl'] ) . 'w3dpv-model-cache/' );
	}

	private static function lock( $directory ) {
		$path = $directory['path'] . '/.write-lock';
		if ( is_link( $path ) ) return false;
		// Atomic mkdir works on shared hosting and filesystems without flock().
		// Recover an empty lock left by a terminated PHP request after ten minutes.
		if ( is_dir( $path ) && filemtime( $path ) < time() - 600 ) @rmdir( $path );
		return @mkdir( $path, 0755 ) ? $path : false;
	}

	private static function files( $directory ) {
		$files = array();
		foreach ( scandir( $directory['path'] ) as $name ) {
			if ( ! preg_match( '/^w3dpv-[a-f0-9]{64}\.(?:glb|obj)$/D', $name ) ) continue;
			$path = $directory['path'] . '/' . $name;
			if ( is_file( $path ) && ! is_link( $path ) ) $files[$path] = array( 'bytes' => filesize( $path ), 'time' => filemtime( $path ) );
		}
		return $files;
	}

	private static function remove_parts( $directory ) {
		// The writer lock is held; these can only be orphaned temporary copies.
		foreach ( scandir( $directory['path'] ) as $name ) {
			if ( ! preg_match( '/^w3dpv-tmp-[a-f0-9]{32}\.part$/D', $name ) ) continue;
			$path = $directory['path'] . '/' . $name;
			if ( ! is_link( $path ) && is_file( $path ) ) @unlink( $path );
		}
	}

	public static function prepare( $model ) {
		$key = $model['id'] . ':' . $model['cacheVersion'];
		if ( isset( self::$prepared[$key] ) ) return self::$prepared[$key];
		$directory = self::directory( true );
		if ( ! $directory ) return $model;
		$name = 'w3dpv-' . hash( 'sha256', self::generation() . ':' . $key ) . '.' . $model['format'];
		$destination = $directory['path'] . '/' . $name;
		if ( is_link( $destination ) ) return $model;
		$exists = is_file( $destination ) && filesize( $destination ) === $model['bytes'];
		// Bound disk work on a product page with many variations.
		if ( ! $exists && self::$copied_bytes + $model['bytes'] <= W3DPV_Model::MAX_BYTES ) {
			$lock = self::lock( $directory );
			if ( $lock ) {
				try {
					self::remove_parts( $directory );
					$files = self::files( $directory );
					$total = array_sum( array_column( $files, 'bytes' ) );
					uasort( $files, static function ( $a, $b ) { return $a['time'] <=> $b['time']; } );
					foreach ( $files as $file => $info ) {
						if ( $total + $model['bytes'] <= self::MAX_BYTES ) break;
						if ( @unlink( $file ) ) $total -= $info['bytes'];
					}
					$source = realpath( get_attached_file( $model['id'] ) );
					$upload_base = realpath( wp_upload_dir( null, false )['basedir'] );
					$temp = $directory['path'] . '/w3dpv-tmp-' . str_replace( '-', '', wp_generate_uuid4() ) . '.part';
					if ( $source && $upload_base && 0 === strpos( wp_normalize_path( $source ), trailingslashit( wp_normalize_path( $upload_base ) ) ) && $total + $model['bytes'] <= self::MAX_BYTES ) {
						// copy() streams on the server; the whole file is not read into PHP memory.
						if ( @copy( $source, $temp ) && filesize( $temp ) === $model['bytes'] && hash_file( 'sha256', $temp ) === $model['cacheVersion'] ) {
							$exists = @rename( $temp, $destination );
							if ( $exists ) { @chmod( $destination, 0644 ); self::$copied_bytes += $model['bytes']; }
						}
						if ( is_file( $temp ) && ! is_link( $temp ) ) @unlink( $temp );
					}
				} finally { @rmdir( $lock ); }
			}
		}
		if ( $exists ) {
			$model['sourceUrl'] = $model['url'];
			$model['url'] = esc_url_raw( $directory['url'] . $name );
			$model['serverCached'] = true;
		}
		self::$prepared[$key] = $model;
		return $model;
	}

	public static function clear() {
		$directory = self::directory();
		$removed = 0;
		if ( $directory ) {
			$lock = self::lock( $directory );
			if ( ! $lock ) { wp_schedule_single_event( time() + 300, self::HOOK ); return false; }
			try {
				foreach ( self::files( $directory ) as $path => $info ) { if ( @unlink( $path ) ) $removed++; }
				self::remove_parts( $directory );
			} finally { @rmdir( $lock ); }
		}
		update_option( 'w3dpv_cache_generation', str_replace( '-', '', wp_generate_uuid4() ), false );
		update_option( 'w3dpv_cache_last_cleanup', time(), false );
		self::$prepared = array(); self::$copied_bytes = 0;
		return $removed;
	}

	public static function stats() {
		$directory = self::directory();
		$files = $directory ? self::files( $directory ) : array();
		return array( 'files' => count( $files ), 'bytes' => array_sum( array_column( $files, 'bytes' ) ), 'next' => wp_next_scheduled( self::HOOK ) );
	}
}

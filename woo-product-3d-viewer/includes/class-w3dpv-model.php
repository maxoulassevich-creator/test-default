<?php
defined( 'ABSPATH' ) || exit;

/** Local, bounded format validation. Does not execute or fetch model resources. */
final class W3DPV_Model {
	const MAX_BYTES = 83886080; // 80 MiB; PHP/WordPress may impose a smaller limit.
	const MAX_VERTICES = 1000000;
	const MAX_TRIANGLES = 1000000;
	private static $cache = array();

	public static function error( $message ) {
		return new WP_Error( 'w3dpv_invalid_model', $message );
	}

	public static function validate( $path, $extension ) {
		if ( ! is_file( $path ) || ! is_readable( $path ) ) {
			return self::error( 'Файл модели недоступен на сервере.' );
		}
		$size = filesize( $path );
		if ( ! $size ) {
			return self::error( 'Файл модели пуст. Выберите непустой GLB или OBJ.' );
		}
		if ( $size > self::MAX_BYTES ) {
			return self::error( 'Файл модели превышает лимит плагина: ' . ( self::MAX_BYTES / 1048576 ) . ' МиБ.' );
		}
		if ( 'glb' === $extension ) {
			return self::validate_glb( $path, $size );
		}
		if ( 'obj' === $extension ) {
			return self::validate_obj( $path );
		}
		return self::error( 'Допустимы только файлы GLB и OBJ.' );
	}

	private static function validate_glb( $path, $size ) {
		$handle = fopen( $path, 'rb' );
		$header = fread( $handle, 12 );
		if ( strlen( $header ) !== 12 ) {
			fclose( $handle );
			return self::error( 'Файл не является корректным GLB 2.0.' );
		}
		$head = unpack( 'Vmagic/Vversion/Vlength', $header );
		if ( 0x46546c67 !== $head['magic'] || 2 !== $head['version'] || $head['length'] !== $size ) {
			fclose( $handle );
			return self::error( 'Неверный заголовок GLB. Экспортируйте модель в формате GLB 2.0.' );
		}
		$json = null;
		$offset = 12;
		while ( $offset < $size ) {
			$bytes = fread( $handle, 8 );
			if ( strlen( $bytes ) !== 8 ) {
				break;
			}
			$chunk = unpack( 'Vlength/Vtype', $bytes );
			if ( $chunk['length'] % 4 || $offset + 8 + $chunk['length'] > $size ) {
				break;
			}
			if ( 12 === $offset && 0x4e4f534a !== $chunk['type'] ) {
				break;
			}
			if ( 0x4e4f534a === $chunk['type'] ) {
				if ( null !== $json || $chunk['length'] > 4194304 ) {
					break;
				}
				$json = json_decode( rtrim( fread( $handle, $chunk['length'] ), " \t\r\n" ), true, 64 );
				if ( ! is_array( $json ) ) {
					break;
				}
			} else {
				fseek( $handle, $chunk['length'], SEEK_CUR );
			}
			$offset += 8 + $chunk['length'];
		}
		fclose( $handle );
		if ( $offset !== $size || ! is_array( $json ) || ( $json['asset']['version'] ?? '' ) !== '2.0' ) {
			return self::error( 'Структура GLB повреждена или не соответствует glTF 2.0.' );
		}
		if ( ! self::embedded_uris_only( $json ) ) {
			return self::error( 'GLB ссылается на внешние файлы. Экспортируйте GLB со встроенными текстурами и геометрией.' );
		}
		foreach ( array( 'meshes', 'accessors', 'buffers', 'nodes', 'textures' ) as $key ) {
			if ( isset( $json[$key] ) && ! is_array( $json[$key] ) ) {
				return self::error( 'Некорректный раздел ' . $key . ' в GLB.' );
			}
		}
		if ( count( (array) ( $json['nodes'] ?? array() ) ) > 10000 || count( (array) ( $json['meshes'] ?? array() ) ) > 1000 || count( (array) ( $json['textures'] ?? array() ) ) > 128 ) {
			return self::error( 'GLB содержит слишком много узлов, сеток или текстур. Упростите модель для веб-просмотра.' );
		}
		foreach ( (array) ( $json['accessors'] ?? array() ) as $accessor ) {
			if ( ! is_array( $accessor ) ) {
				return self::error( 'Некорректное описание геометрии GLB.' );
			}
			$count = $accessor['count'] ?? null;
			if ( ! is_int( $count ) || $count < 0 || $count > self::MAX_VERTICES * 3 ) {
				return self::error( 'GLB превышает лимит сложности геометрии.' );
			}
		}
		$nodes = $json['nodes'] ?? array();
		$incoming = array_fill( 0, count( $nodes ), 0 );
		foreach ( $nodes as $node ) {
			if ( ! is_array( $node ) || isset( $node['children'] ) && ! is_array( $node['children'] ) ) {
				return self::error( 'Некорректный узел сцены GLB.' );
			}
			foreach ( ( $node['children'] ?? array() ) as $child ) {
				if ( ! is_int( $child ) || $child < 0 || ! isset( $nodes[$child] ) || ++$incoming[$child] > 1 ) {
					return self::error( 'Некорректная иерархия узлов GLB.' );
				}
			}
		}
		$queue = array_keys( $incoming, 0, true );
		for ( $i = 0; $i < count( $queue ); ++$i ) {
			foreach ( ( $nodes[$queue[$i]]['children'] ?? array() ) as $child ) {
				if ( 0 === --$incoming[$child] ) {
					$queue[] = $child;
				}
			}
		}
		if ( count( $queue ) !== count( $nodes ) ) {
			return self::error( 'В иерархии GLB обнаружена циклическая ссылка.' );
		}
		$vertices = 0;
		foreach ( (array) ( $json['meshes'] ?? array() ) as $mesh ) {
			if ( ! is_array( $mesh ) || ! isset( $mesh['primitives'] ) || ! is_array( $mesh['primitives'] ) ) {
				return self::error( 'Некорректная сетка GLB.' );
			}
			foreach ( (array) ( $mesh['primitives'] ?? array() ) as $primitive ) {
				if ( ! is_array( $primitive ) || ! isset( $primitive['attributes'] ) || ! is_array( $primitive['attributes'] ) ) {
					return self::error( 'Некорректные атрибуты геометрии GLB.' );
				}
				$index = $primitive['attributes']['POSITION'] ?? null;
				if ( ! is_int( $index ) || $index < 0 || ! isset( $json['accessors'][$index] ) ) {
					return self::error( 'Некорректная ссылка на координаты вершин GLB.' );
				}
				$count = null !== $index ? ( $json['accessors'][$index]['count'] ?? 0 ) : 0;
				if ( ! is_int( $count ) || $count < 1 ) {
					return self::error( 'В GLB обнаружена геометрия без корректных координат вершин.' );
				}
				$vertices += $count;
			}
		}
		$decoded_bytes = 0;
		foreach ( (array) ( $json['buffers'] ?? array() ) as $buffer ) {
			$length = $buffer['byteLength'] ?? 0;
			if ( ! is_int( $length ) || $length < 0 ) {
				return self::error( 'Некорректная длина буфера GLB.' );
			}
			$decoded_bytes += $length;
		}
		if ( ! $vertices || $vertices > self::MAX_VERTICES || $decoded_bytes > 134217728 ) {
			return self::error( 'GLB слишком сложный или не содержит геометрии. Лимит: 1 000 000 вершин и 128 МиБ буферов.' );
		}
		return true;
	}

	private static function embedded_uris_only( $node ) {
		foreach ( $node as $key => $value ) {
			if ( 'uri' === $key && ( ! is_string( $value ) || ! preg_match( '~^data:(?:application/(?:octet-stream|gltf-buffer)|image/(?:png|jpeg|webp|ktx2));base64,[A-Za-z0-9+/=\r\n]+$~D', $value ) ) ) {
				return false;
			}
			if ( is_array( $value ) && ! self::embedded_uris_only( $value ) ) {
				return false;
			}
		}
		return true;
	}

	private static function validate_obj( $path ) {
		$handle = fopen( $path, 'rb' );
		$vertices = 0;
		$triangles = 0;
		$number = '[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?';
		$error = null;
		while ( false !== ( $line = fgets( $handle, 1048577 ) ) ) {
			if ( strlen( $line ) >= 1048576 || false !== strpos( $line, "\0" ) || preg_match( '/<\?|<\/?(?:script|html|svg|iframe)\b/i', $line ) ) {
				$error = 'OBJ содержит неподдерживаемые данные или слишком длинную строку.';
				break;
			}
		$line = trim( preg_replace( '/\s+#.*$/', '', $line ) );
		$line = preg_replace( '/^\xEF\xBB\xBF/', '', $line );
			if ( '' === $line || '#' === $line[0] ) {
				continue;
			}
			if ( preg_match( '/^(v|vn|vt|vp)\s+(.+)$/', $line, $match ) ) {
				$parts = preg_split( '/\s+/', $match[2] );
				if ( count( $parts ) > 7 || count( $parts ) < ( in_array( $match[1], array( 'v', 'vn' ), true ) ? 3 : 1 ) ) {
					$error = 'Некорректные координаты в OBJ.';
					break;
				}
				foreach ( $parts as $value ) {
					if ( ! preg_match( '/^' . $number . '$/D', $value ) || ! is_finite( (float) $value ) || abs( (float) $value ) > 1e12 ) {
						$error = 'Некорректные или слишком большие координаты в OBJ.';
						break 2;
					}
				}
				if ( 'v' === $match[1] ) {
					++$vertices;
				}
			} elseif ( preg_match( '/^f\s+(.+)$/', $line, $match ) ) {
				$parts = preg_split( '/\s+/', $match[1] );
				if ( count( $parts ) < 3 || count( $parts ) > 4096 ) {
					$error = 'Некорректная грань OBJ.';
					break;
				}
				foreach ( $parts as $value ) {
					if ( ! preg_match( '~^(-?[1-9]\d*)(?:/(?:-?[1-9]\d*)?(?:/-?[1-9]\d*)?)?$~D', $value, $index ) || abs( (int) $index[1] ) > $vertices ) {
						$error = 'Грань OBJ ссылается на отсутствующую вершину.';
						break 2;
					}
				}
				$triangles += count( $parts ) - 2;
			} elseif ( ! preg_match( '/^(?:o|g|s|usemtl|mtllib|l|p)(?:\s|$)/', $line ) ) {
				$error = 'Поддерживается полигональный OBJ. Экспортируйте поверхности и кривые в виде сетки.';
				break;
			}
			if ( $vertices > self::MAX_VERTICES || $triangles > self::MAX_TRIANGLES ) {
				$error = 'OBJ слишком сложный. Лимит: 1 000 000 вершин и 1 000 000 треугольников.';
				break;
			}
		}
		fclose( $handle );
		if ( $error || ! $vertices || ! $triangles ) {
			return self::error( $error ?: 'OBJ должен содержать вершины и полигональные грани.' );
		}
		return true;
	}

	/** Attachments must be local files within the current uploads directory. */
	public static function attachment( $id ) {
		$id = absint( $id );
		if ( isset( self::$cache[$id] ) ) {
			return self::$cache[$id];
		}
		if ( ! $id || 'attachment' !== get_post_type( $id ) ) {
			return self::error( 'Выберите модель из медиатеки.' );
		}
		$path = get_attached_file( $id );
		$real = $path ? realpath( $path ) : false;
		$uploads = wp_upload_dir();
		$base = realpath( $uploads['basedir'] );
		if ( ! $real || ! $base || 0 !== strpos( wp_normalize_path( $real ), trailingslashit( wp_normalize_path( $base ) ) ) ) {
			return self::error( 'Модель должна находиться в локальной медиатеке WordPress.' );
		}
		$extension = strtolower( pathinfo( $real, PATHINFO_EXTENSION ) );
		$stamp = W3DPV_VERSION . ':' . filesize( $real ) . ':' . filemtime( $real );
		if ( get_post_meta( $id, '_w3dpv_validated', true ) !== $stamp ) {
			$result = self::validate( $real, $extension );
			if ( is_wp_error( $result ) ) {
				return $result;
			}
			update_post_meta( $id, '_w3dpv_validated', $stamp );
			update_post_meta( $id, '_w3dpv_fingerprint', hash_file( 'sha256', $real ) );
		}
		$fingerprint = get_post_meta( $id, '_w3dpv_fingerprint', true );
		if ( ! is_string( $fingerprint ) || ! preg_match( '/^[a-f0-9]{64}$/D', $fingerprint ) ) {
			$fingerprint = hash_file( 'sha256', $real );
			update_post_meta( $id, '_w3dpv_fingerprint', $fingerprint );
		}
		$url = wp_get_attachment_url( $id );
		if ( ! $url || ! in_array( strtolower( (string) wp_parse_url( $url, PHP_URL_SCHEME ) ), array( 'http', 'https' ), true ) ) {
			return self::error( 'URL модели недоступен.' );
		}
		self::$cache[$id] = array( 'id' => $id, 'url' => esc_url_raw( add_query_arg( 'w3dpv', substr( $fingerprint, 0, 16 ), $url ) ), 'format' => $extension, 'bytes' => filesize( $real ), 'name' => basename( $real ), 'cacheVersion' => $fingerprint );
		return self::$cache[$id];
	}
}

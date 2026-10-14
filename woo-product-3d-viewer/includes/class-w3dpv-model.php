<?php
defined( 'ABSPATH' ) || exit;

/** Local, bounded format validation. Does not execute or fetch model resources. */
final class W3DPV_Model {
	const MAX_BYTES = 83886080; // 80 MiB; PHP/WordPress may impose a smaller limit.
	const MAX_VERTICES = 1000000;
	const MAX_TRIANGLES = 1000000;
	/** Supported extensions and the MIME types registered for uploads. FBX has no registered MIME type. */
	const FORMATS = array( 'glb' => 'model/gltf-binary', 'fbx' => 'application/octet-stream', 'obj' => 'model/obj' );
	const FBX_BINARY_MAGIC = "Kaydara FBX Binary  \0";
	const FBX_MAX_NODES = 1000000;
	const FBX_MAX_ARRAY_BYTES = 268435456; // 256 MiB of declared decoded arrays.
	private static $cache = array();
	private static $validated = array();

	public static function error( $message, $code = 'w3dpv_invalid_model' ) {
		return new WP_Error( $code, $message );
	}

	public static function supported( $extension ) {
		return array_key_exists( $extension, self::FORMATS );
	}

	public static function validate( $path, $extension ) {
		if ( ! is_file( $path ) || ! is_readable( $path ) ) {
			return self::error( 'Файл модели недоступен на сервере.', 'w3dpv_unavailable' );
		}
		$size = filesize( $path );
		if ( ! $size ) {
			return self::error( 'Файл модели пуст. Выберите непустой GLB, FBX или OBJ.' );
		}
		if ( $size > self::MAX_BYTES ) {
			return self::error( 'Файл модели превышает лимит плагина: ' . ( self::MAX_BYTES / 1048576 ) . ' МиБ.' );
		}
		// WordPress checks one upload in several filters; parse each file only once per request.
		$key = $extension . '|' . $path . '|' . $size . '|' . filemtime( $path );
		if ( isset( self::$validated[$key] ) ) {
			return self::$validated[$key];
		}
		if ( 'glb' === $extension ) {
			$result = self::validate_glb( $path, $size );
		} elseif ( 'fbx' === $extension ) {
			$result = self::validate_fbx( $path, $size );
		} elseif ( 'obj' === $extension ) {
			$result = self::validate_obj( $path );
		} else {
			$result = self::error( 'Допустимы только файлы GLB, FBX и OBJ.' );
		}
		return self::$validated[$key] = $result;
	}

	private static function validate_glb( $path, $size ) {
		$handle = fopen( $path, 'rb' );
		if ( ! $handle ) {
			return self::error( 'Файл модели недоступен на сервере.', 'w3dpv_unavailable' );
		}
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

	/** FBX 7.x (2011+), binary or ASCII. Only record headers are read; compressed arrays are not inflated. */
	private static function validate_fbx( $path, $size ) {
		$handle = fopen( $path, 'rb' );
		if ( ! $handle ) {
			return self::error( 'Файл модели недоступен на сервере.', 'w3dpv_unavailable' );
		}
		$header = (string) fread( $handle, 27 );
		$stats = array( 'nodes' => 0, 'vertices' => 0, 'indices' => 0, 'array_bytes' => 0, 'objects' => false );
		if ( 0 === strncmp( $header, self::FBX_BINARY_MAGIC, 21 ) ) {
			$result = 27 === strlen( $header ) ? self::validate_fbx_binary( $handle, $size, unpack( 'V', substr( $header, 23, 4 ) )[1], $stats ) : self::error( 'Файл FBX повреждён: неполный заголовок.' );
		} else {
			rewind( $handle );
			$result = self::validate_fbx_ascii( $handle, $stats );
		}
		fclose( $handle );
		if ( is_wp_error( $result ) ) {
			return $result;
		}
		if ( ! $stats['objects'] || ! $stats['vertices'] || $stats['indices'] < 3 ) {
			return self::error( 'FBX не содержит полигональной геометрии. Экспортируйте объекты как сетки (Mesh).' );
		}
		if ( $stats['vertices'] > self::MAX_VERTICES || $stats['indices'] > self::MAX_TRIANGLES * 3 ) {
			return self::error( 'FBX слишком сложный. Лимит: 1 000 000 вершин и около 1 000 000 треугольников.' );
		}
		if ( $stats['array_bytes'] > self::FBX_MAX_ARRAY_BYTES ) {
			return self::error( 'FBX слишком сложный: после распаковки данные превышают 256 МиБ. Упростите модель или удалите анимацию.' );
		}
		return true;
	}

	private static function fbx_version_error( $version ) {
		return self::error( 'Версия FBX ' . (int) $version . ' не поддерживается. Экспортируйте FBX 2011 или новее (версия 7.x), двоичный или ASCII.' );
	}

	private static function validate_fbx_binary( $handle, $size, $version, &$stats ) {
		if ( $version < 7000 || $version >= 8000 ) {
			return self::fbx_version_error( $version );
		}
		$wide = $version >= 7500;
		$offset = 27;
		// Same footer detection as THREE.FBXLoader: top-level records end 176 bytes before the file end.
		while ( ( 0 === $size % 16 ? ( ( $offset + 176 ) & ~0xf ) : $offset + 176 ) < $size ) {
			$result = self::fbx_record( $handle, $size, $wide, $offset, '', 0, $stats );
			if ( is_wp_error( $result ) ) {
				return $result;
			}
			$offset = $result;
		}
		return true;
	}

	/** Validates one binary record and its children; returns the offset after it. */
	private static function fbx_record( $handle, $size, $wide, $offset, $parent, $depth, &$stats ) {
		$broken = self::error( 'Структура FBX повреждена. Экспортируйте файл заново.' );
		$head_size = $wide ? 25 : 13;
		if ( $offset + $head_size > $size || 0 !== fseek( $handle, $offset ) ) {
			return $broken;
		}
		$raw = fread( $handle, $head_size );
		if ( strlen( $raw ) !== $head_size ) {
			return $broken;
		}
		$head = unpack( $wide ? 'Pend/Pcount/Plength/Cname' : 'Vend/Vcount/Vlength/Cname', $raw );
		if ( 0 === $head['end'] ) {
			return $offset + $head_size; // Null record that terminates a list of children.
		}
		if ( ++$stats['nodes'] > self::FBX_MAX_NODES || $depth > 64 ) {
			return self::error( 'FBX содержит слишком много элементов сцены. Упростите модель для веб-просмотра.' );
		}
		$name = $head['name'] ? (string) fread( $handle, $head['name'] ) : '';
		$properties = $offset + $head_size + $head['name'];
		$children = $properties + $head['length'];
		if ( strlen( $name ) !== $head['name'] || $head['end'] < $children || $head['end'] > $size || $head['count'] < 0 || $head['length'] < 0 ) {
			return $broken;
		}
		if ( 0 === $depth && 'Objects' === $name ) {
			$stats['objects'] = true;
		}
		$position = $properties;
		$scalars = array( 'Y' => 2, 'C' => 1, 'I' => 4, 'F' => 4, 'D' => 8, 'L' => 8 );
		$arrays = array( 'b' => 1, 'c' => 1, 'i' => 4, 'f' => 4, 'd' => 8, 'l' => 8 );
		for ( $i = 0; $i < $head['count']; ++$i ) {
			if ( $position >= $children ) {
				return $broken;
			}
			$type = fread( $handle, 1 );
			++$position;
			if ( isset( $scalars[$type] ) ) {
				$position += $scalars[$type];
			} elseif ( 'S' === $type || 'R' === $type ) {
				$length = unpack( 'V', (string) fread( $handle, 4 ) . "\0\0\0\0" )[1];
				$position += 4 + $length;
			} elseif ( isset( $arrays[$type] ) ) {
				$array = unpack( 'Vcount/Vencoding/Vlength', (string) fread( $handle, 12 ) . str_repeat( "\0", 12 ) );
				$decoded = $array['count'] * $arrays[$type];
				// THREE.FBXLoader reads uncompressed arrays by count and inflates everything else with zlib.
				if ( $array['encoding'] > 1 || ( 0 === $array['encoding'] && $array['length'] !== $decoded ) ) {
					return $broken;
				}
				$position += 12 + $array['length'];
				$stats['array_bytes'] += $decoded;
				if ( 'Geometry' === $parent && 'Vertices' === $name ) {
					$stats['vertices'] += intdiv( $array['count'], 3 );
				} elseif ( 'Geometry' === $parent && 'PolygonVertexIndex' === $name ) {
					$stats['indices'] += $array['count'];
				}
			} else {
				return $broken;
			}
			if ( $position > $children || 0 !== fseek( $handle, $position ) ) {
				return $broken;
			}
		}
		if ( $position !== $children ) {
			return $broken;
		}
		while ( $position < $head['end'] ) {
			$position = self::fbx_record( $handle, $size, $wide, $position, $name, $depth + 1, $stats );
			if ( is_wp_error( $position ) ) {
				return $position;
			}
		}
		return $position === $head['end'] ? $position : $broken;
	}

	private static function validate_fbx_ascii( $handle, &$stats ) {
		$version = 0;
		$carry = '';
		$first = true;
		while ( ! feof( $handle ) ) {
			$chunk = (string) fread( $handle, 1048576 );
			if ( $first ) {
				$chunk = preg_replace( '/^\xEF\xBB\xBF/', '', $chunk );
				if ( ! preg_match( '/^\s*(?:;|FBXHeaderExtension:)/', $chunk ) ) {
					return self::error( 'Файл не похож на FBX. Экспортируйте модель в формате FBX (двоичный или ASCII).' );
				}
				$first = false;
			}
			if ( false !== strpos( $chunk, "\0" ) ) {
				return self::error( 'Файл FBX повреждён или содержит неподдерживаемые данные.' );
			}
			$buffer = $carry . $chunk;
			if ( preg_match( '/<\?|<\/?(?:script|html|svg|iframe)\b/i', $buffer ) ) {
				return self::error( 'FBX содержит неподдерживаемые данные.' );
			}
			// Matches are short: keep a tail so a key split between chunks is counted exactly once.
			$limit = feof( $handle ) ? strlen( $buffer ) : max( 0, strlen( $buffer ) - 256 );
			preg_match_all( '/(?:^|[\s{])(Vertices|PolygonVertexIndex):\s*\*(\d{1,10})/', $buffer, $matches, PREG_SET_ORDER | PREG_OFFSET_CAPTURE );
			foreach ( $matches as $match ) {
				if ( $match[0][1] >= $limit ) {
					break;
				}
				$count = (int) $match[2][0];
				if ( 'Vertices' === $match[1][0] ) {
					$stats['vertices'] += intdiv( $count, 3 );
					$stats['array_bytes'] += $count * 8;
				} else {
					$stats['indices'] += $count;
					$stats['array_bytes'] += $count * 4;
				}
			}
			if ( ! $stats['objects'] && preg_match( '/(?:^|\n)Objects:/', substr( $buffer, 0, $limit ) ) ) {
				$stats['objects'] = true;
			}
			// THREE.FBXLoader takes the first "FBXVersion: <number>" in the text.
			if ( ! $version && preg_match( '/FBXVersion: (\d+)/', substr( $buffer, 0, $limit ), $match ) ) {
				$version = (int) $match[1];
			}
			$carry = substr( $buffer, $limit );
		}
		if ( $version < 7000 || $version >= 8000 ) {
			return $version ? self::fbx_version_error( $version ) : self::error( 'В FBX не найден номер версии. Экспортируйте модель заново (FBX 7.x).' );
		}
		return true;
	}

	private static function validate_obj( $path ) {
		$handle = fopen( $path, 'rb' );
		if ( ! $handle ) {
			return self::error( 'Файл модели недоступен на сервере.', 'w3dpv_unavailable' );
		}
		$vertices = 0;
		$triangles = 0;
		$number = '[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?';
		$error = null;
		while ( false !== ( $line = fgets( $handle, 1048577 ) ) ) {
			if ( strlen( $line ) >= 1048576 || false !== strpos( $line, "\0" ) || preg_match( '/<\?|<\/?(?:script|html|svg|iframe)\b/i', $line ) ) {
				$error = 'OBJ содержит неподдерживаемые данные или слишком длинную строку.';
				break;
			}
			$line = trim( preg_replace( array( '/^\xEF\xBB\xBF/', '/\s+#.*$/' ), '', $line ) );
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
			// A rejected file is not parsed again on every product page view until it changes.
			$invalid = get_post_meta( $id, '_w3dpv_invalid', true );
			if ( is_array( $invalid ) && ( $invalid['stamp'] ?? '' ) === $stamp && is_string( $invalid['message'] ?? null ) ) {
				return self::error( $invalid['message'] );
			}
			$result = self::validate( $real, $extension );
			if ( is_wp_error( $result ) ) {
				if ( 'w3dpv_invalid_model' === $result->get_error_code() ) {
					update_post_meta( $id, '_w3dpv_invalid', array( 'stamp' => $stamp, 'message' => $result->get_error_message() ) );
				}
				return $result;
			}
			delete_post_meta( $id, '_w3dpv_invalid' );
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

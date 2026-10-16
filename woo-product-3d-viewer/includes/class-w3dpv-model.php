<?php
defined( 'ABSPATH' ) || exit;

/** Local, bounded format validation. Does not execute or fetch model resources. */
final class W3DPV_Model {
	const MAX_BYTES = 125829120; // 120 MiB; PHP/WordPress may impose a smaller limit.
	/** Vertices as stored in the file: points of the mesh, split again at UV seams, hard edges and material borders. */
	const MAX_VERTICES = 2000000;
	const MAX_TRIANGLES = 2000000;
	const MAX_MESHES = 2000;
	/** Geometry and embedded images of a GLB. */
	const GLB_MAX_BUFFER_BYTES = 268435456; // 256 MiB.
	/**
	 * FBXLoader builds FBX geometry in plain JavaScript arrays: 3M triangles need about 2 GB of memory
	 * while parsing, which only desktop browsers have; phones need a lighter model in the mobile field.
	 */
	const FBX_MAX_TRIANGLES = 3000000;
	/** Supported extensions and the MIME types registered for uploads. FBX has no registered MIME type. */
	const FORMATS = array( 'glb' => 'model/gltf-binary', 'fbx' => 'application/octet-stream', 'obj' => 'model/obj' );
	const FBX_BINARY_MAGIC = "Kaydara FBX Binary  \0";
	const FBX_MAX_NODES = 2000000;
	const FBX_MAX_ARRAY_BYTES = 536870912; // 512 MiB of declared decoded arrays.
	const REDUCE = ' Уменьшите число полигонов: в Cinema 4D — генератор Polygon Reduction или меньший уровень Subdivision Surface, в Blender — Decimate. Подробнее — в инструкции плагина, раздел «Модель из Cinema 4D».';
	const MERGE = ' Объедините детали: в Cinema 4D выделите объекты и выполните Connect Objects + Delete, в Blender — Join (Ctrl+J).';
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
			return self::error( 'Файл модели (' . self::mib( $size ) . ') превышает лимит плагина: ' . ( self::MAX_BYTES / 1048576 ) . ' МиБ. Уменьшите текстуры и число полигонов.' );
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
		if ( count( (array) ( $json['nodes'] ?? array() ) ) > 20000 || count( (array) ( $json['meshes'] ?? array() ) ) > self::MAX_MESHES || count( (array) ( $json['textures'] ?? array() ) ) > 256 ) {
			return self::error( 'GLB содержит слишком много объектов или текстур (лимит: 20 000 узлов, ' . self::number( self::MAX_MESHES ) . ' сеток, 256 текстур).' . self::MERGE );
		}
		foreach ( (array) ( $json['accessors'] ?? array() ) as $accessor ) {
			if ( ! is_array( $accessor ) ) {
				return self::error( 'Некорректное описание геометрии GLB.' );
			}
			$count = $accessor['count'] ?? null;
			if ( ! is_int( $count ) || $count < 0 || $count > self::MAX_VERTICES * 3 ) {
				return self::error( 'GLB слишком детализирован: в одном объекте больше ' . self::number( self::MAX_VERTICES * 3 ) . ' вершин.' . self::REDUCE );
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
		if ( ! $vertices ) {
			return self::error( 'GLB не содержит геометрии. Экспортируйте объекты модели как сетки.' );
		}
		if ( $vertices > self::MAX_VERTICES ) {
			return self::error( 'GLB слишком детализирован: ' . self::number( $vertices ) . ' вершин (точек сетки после экспорта), лимит — ' . self::number( self::MAX_VERTICES ) . '.' . self::REDUCE );
		}
		if ( $decoded_bytes > self::GLB_MAX_BUFFER_BYTES ) {
			return self::error( 'GLB слишком тяжёлый: геометрия и встроенные текстуры занимают ' . self::mib( $decoded_bytes ) . ', лимит — ' . self::number( self::GLB_MAX_BUFFER_BYTES / 1048576 ) . ' МиБ. Уменьшите текстуры до 2048–4096 пикселей (JPEG для цвета) и число полигонов.' );
		}
		return self::glb_scene( $json, $nodes );
	}

	/**
	 * Counts what GLTFLoader renders from the default scene: one mesh per triangle primitive of every node,
	 * vertices multiplied by EXT_mesh_gpu_instancing copies. A mesh used by many nodes counts every time.
	 */
	private static function glb_scene( $json, $nodes ) {
		$index = $json['scene'] ?? 0;
		$scene = is_int( $index ) ? ( $json['scenes'][$index] ?? null ) : null;
		if ( ! is_array( $scene ) || ( isset( $scene['nodes'] ) && ! is_array( $scene['nodes'] ) ) ) {
			return self::error( 'GLB не содержит сцены для показа. Экспортируйте модель заново.' );
		}
		$meshes = 0;
		$rendered = 0;
		$seen = array();
		$stack = array_values( $scene['nodes'] ?? array() );
		while ( $stack ) {
			$id = array_pop( $stack );
			if ( ! is_int( $id ) || ! isset( $nodes[$id] ) || isset( $seen[$id] ) ) {
				continue;
			}
			$seen[$id] = true;
			$node = $nodes[$id];
			foreach ( ( $node['children'] ?? array() ) as $child ) {
				$stack[] = $child;
			}
			if ( ! isset( $node['mesh'] ) ) {
				continue;
			}
			$mesh = is_int( $node['mesh'] ) ? ( $json['meshes'][ $node['mesh'] ] ?? null ) : null;
			if ( ! is_array( $mesh ) ) {
				return self::error( 'Некорректная ссылка на сетку GLB.' );
			}
			$triangle_modes = array( 4, 5, 6 );
			$all_triangles = true;
			foreach ( $mesh['primitives'] as $primitive ) {
				$all_triangles = $all_triangles && in_array( $primitive['mode'] ?? 4, $triangle_modes, true );
			}
			$copies = 1;
			$instancing = $node['extensions']['EXT_mesh_gpu_instancing']['attributes'] ?? null;
			if ( $all_triangles && is_array( $instancing ) && $instancing ) {
				$accessor = reset( $instancing );
				$copies = is_int( $accessor ) && is_int( $json['accessors'][$accessor]['count'] ?? null ) ? max( 1, $json['accessors'][$accessor]['count'] ) : 1;
			}
			foreach ( $mesh['primitives'] as $primitive ) {
				if ( in_array( $primitive['mode'] ?? 4, $triangle_modes, true ) ) {
					++$meshes;
					$rendered += $json['accessors'][ $primitive['attributes']['POSITION'] ]['count'] * $copies;
				}
			}
		}
		if ( ! $meshes ) {
			return self::error( 'GLB не содержит полигональных сеток в сцене (только точки, линии или пустые узлы).' );
		}
		if ( $meshes > self::MAX_MESHES ) {
			return self::error( 'GLB содержит ' . self::number( $meshes ) . ' отдельных сеток в сцене, лимит — ' . self::number( self::MAX_MESHES ) . '.' . self::MERGE );
		}
		if ( $rendered > self::MAX_VERTICES * 3 ) {
			return self::error( 'GLB слишком детализирован: сцена содержит ' . self::number( $rendered ) . ' вершин с учётом повторяющихся копий (Cloner, экземпляры), лимит — ' . self::number( self::MAX_VERTICES * 3 ) . '.' . self::REDUCE );
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

	/**
	 * FBX 7.x (2011+), binary or ASCII. Counts what THREE.FBXLoader will build: one mesh per Model of type "Mesh"
	 * and n - 2 triangles per n-gon of the connected geometry, so the viewer never rejects an accepted file.
	 */
	private static function validate_fbx( $path, $size ) {
		$handle = fopen( $path, 'rb' );
		if ( ! $handle ) {
			return self::error( 'Файл модели недоступен на сервере.', 'w3dpv_unavailable' );
		}
		$header = (string) fread( $handle, 27 );
		$stats = array( 'nodes' => 0, 'vertices' => 0, 'array_bytes' => 0, 'objects' => false, 'geometries' => array(), 'models' => array(), 'deformers' => array(), 'connections' => array() );
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
		$scene = self::fbx_scene( $stats );
		if ( $scene['broken'] ) {
			return self::error( 'В FBX есть объект без геометрии или без связей в сцене — такой файл не открывается в браузере. Экспортируйте модель заново.' );
		}
		if ( ! $stats['objects'] || ! $scene['meshes'] || ! $scene['triangles'] ) {
			return self::error( 'FBX не содержит полигональной геометрии. Экспортируйте объекты как сетки (Mesh).' );
		}
		if ( $scene['meshes'] > self::MAX_MESHES ) {
			return self::error( 'FBX содержит ' . self::number( $scene['meshes'] ) . ' отдельных объектов-сеток, лимит — ' . self::number( self::MAX_MESHES ) . '.' . self::MERGE );
		}
		if ( $scene['triangles'] > self::FBX_MAX_TRIANGLES || $stats['vertices'] > self::MAX_VERTICES ) {
			return self::error( 'FBX слишком детализирован: ' . self::number( $scene['triangles'] ) . ' треугольников и ' . self::number( $stats['vertices'] ) . ' вершин (точек сетки). Лимит: ' . self::number( self::FBX_MAX_TRIANGLES ) . ' треугольников и ' . self::number( self::MAX_VERTICES ) . ' вершин.' . self::REDUCE );
		}
		if ( $stats['array_bytes'] > self::FBX_MAX_ARRAY_BYTES ) {
			return self::error( 'FBX слишком сложный: после распаковки данные превышают ' . ( self::FBX_MAX_ARRAY_BYTES / 1048576 ) . ' МиБ. Упростите модель или экспортируйте без анимации.' );
		}
		return true;
	}

	/**
	 * Mirrors FBXLoader: every Model of type Mesh becomes a mesh with the last geometry connected to it,
	 * except models linked to a skin cluster, which become bones. FBXLoader throws on a model or mesh
	 * geometry without connections, on mesh geometry whose first parent is not a model and on a mesh
	 * without mesh geometry.
	 */
	private static function fbx_scene( $stats ) {
		$linked = array();
		$parents = array();
		$geometry_of = array();
		foreach ( $stats['connections'] as $connection ) {
			list( $child, $parent ) = $connection;
			$linked[$child] = true;
			$linked[$parent] = true;
			$parents[$child][] = $parent;
			if ( isset( $stats['geometries'][$child], $stats['models'][$parent] ) ) {
				$geometry_of[$parent] = $child;
			}
		}
		$bone_clusters = array();
		foreach ( $stats['deformers'] as $id => $type ) {
			foreach ( ( 'Cluster' === $type ? ( $parents[$id] ?? array() ) : array() ) as $parent ) {
				if ( 'Skin' === ( $stats['deformers'][$parent] ?? '' ) ) {
					$bone_clusters[$id] = true;
				}
			}
		}
		$broken = false;
		foreach ( $stats['geometries'] as $id => $geometry ) {
			if ( 'Mesh' === $geometry['type'] ) {
				$broken = $broken || ! isset( $linked[$id] ) || ( isset( $parents[$id] ) && ! isset( $stats['models'][ $parents[$id][0] ] ) );
			}
		}
		// Models that are each other's parents never reach the scene in FBXLoader.
		$state = array();
		foreach ( array_keys( $stats['models'] ) as $start ) {
			for ( $id = $start; isset( $stats['models'][$id] ) && ! isset( $state[$id] ); ) {
				$state[$id] = $start;
				$next = null;
				foreach ( $parents[$id] ?? array() as $parent ) {
					if ( isset( $stats['models'][$parent] ) ) {
						$next = $parent;
					}
				}
				if ( null === $next ) {
					break;
				}
				$broken = $broken || ( isset( $state[$next] ) && $state[$next] === $start );
				$id = $next;
			}
		}
		$meshes = 0;
		$triangles = 0;
		foreach ( $stats['models'] as $id => $type ) {
			$broken = $broken || ! isset( $linked[$id] );
			$bone = false;
			foreach ( $parents[$id] ?? array() as $parent ) {
				$bone = $bone || isset( $bone_clusters[$parent] );
			}
			if ( 'Mesh' !== $type || $bone ) {
				continue;
			}
			++$meshes;
			$geometry = isset( $geometry_of[$id] ) ? $stats['geometries'][ $geometry_of[$id] ] : null;
			if ( ! $geometry || 'Mesh' !== $geometry['type'] ) {
				$broken = true;
			} else {
				// Each polygon gives n - 2 triangles; one-vertex polygons (n - 2 = -1) are dropped by the viewer.
				$triangles += max( 0, $geometry['indices'] - 2 * $geometry['polygons'] + $geometry['singles'] );
			}
		}
		return array( 'meshes' => $meshes, 'triangles' => $triangles, 'broken' => $broken );
	}

	/** Object ids become JavaScript numbers in FBXLoader; ids above 2^53 are compared after the same rounding. */
	private static function fbx_key( $value ) {
		return sprintf( '%.0f', (float) $value );
	}

	private static function number( $value ) {
		return number_format( (float) $value, 0, ',', ' ' );
	}

	private static function mib( $bytes ) {
		return number_format( $bytes / 1048576, 1, ',', ' ' ) . ' МиБ';
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
			$result = self::fbx_record( $handle, $size, $wide, $offset, '', 0, $stats, null );
			if ( is_wp_error( $result ) ) {
				return $result;
			}
			$offset = $result;
		}
		return true;
	}

	/** Reads a little-endian scalar property the way FBXLoader's BinaryReader does. */
	private static function fbx_scalar( $type, $raw ) {
		switch ( $type ) {
			case 'Y':
				$value = unpack( 'v', $raw )[1];
				return $value >= 0x8000 ? $value - 0x10000 : $value;
			case 'I':
				$value = unpack( 'V', $raw )[1];
				return $value >= 0x80000000 ? $value - 0x100000000 : $value;
			case 'L':
				return unpack( 'P', $raw )[1];
			case 'F':
				return unpack( 'g', $raw )[1];
			case 'D':
				return unpack( 'e', $raw )[1];
		}
		return null;
	}

	/** Validates one binary record and its children; returns the offset after it. */
	private static function fbx_record( $handle, $size, $wide, $offset, $parent, $depth, &$stats, $geometry ) {
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
			return self::error( 'FBX содержит слишком много элементов сцены (больше ' . self::number( self::FBX_MAX_NODES ) . '). Экспортируйте только нужные объекты, без анимации.' );
		}
		$name = $head['name'] ? (string) fread( $handle, $head['name'] ) : '';
		$properties = $offset + $head_size + $head['name'];
		$children = $properties + $head['length'];
		if ( strlen( $name ) !== $head['name'] || $head['end'] < $children || $head['end'] > $size || $head['count'] < 0 || $head['length'] < 0 ) {
			return $broken;
		}
		if ( 0 === $depth && 'Objects' === $name ) {
			// FBXLoader keeps only the last top-level Objects and Connections records.
			$stats['objects'] = true;
			$stats['geometries'] = array();
			$stats['models'] = array();
			$stats['deformers'] = array();
		} elseif ( 0 === $depth && 'Connections' === $name ) {
			$stats['connections'] = array();
		}
		// Object ids, types and connections are needed to count meshes the way FBXLoader builds them.
		$keep = ( 'Objects' === $parent && in_array( $name, array( 'Geometry', 'Model', 'Deformer' ), true ) ) || ( 'Connections' === $parent && 'C' === $name );
		$values = array();
		$position = $properties;
		$scalars = array( 'Y' => 2, 'C' => 1, 'I' => 4, 'F' => 4, 'D' => 8, 'L' => 8 );
		$arrays = array( 'b' => 1, 'c' => 1, 'i' => 4, 'f' => 4, 'd' => 8, 'l' => 8 );
		for ( $i = 0; $i < $head['count']; ++$i ) {
			if ( $position >= $children ) {
				return $broken;
			}
			$type = fread( $handle, 1 );
			++$position;
			$value = null;
			if ( isset( $scalars[$type] ) ) {
				if ( $keep ) {
					$value = self::fbx_scalar( $type, (string) fread( $handle, $scalars[$type] ) . str_repeat( "\0", 8 ) );
				}
				$position += $scalars[$type];
			} elseif ( 'S' === $type || 'R' === $type ) {
				$length = unpack( 'V', (string) fread( $handle, 4 ) . "\0\0\0\0" )[1];
				if ( $keep && 'S' === $type ) {
					// FBXLoader cuts a string at its first NUL ("Name\0\1Class").
					$value = $length <= 1024 && $position + 4 + $length <= $children ? strstr( (string) fread( $handle, $length ) . "\0", "\0", true ) : '';
				}
				$position += 4 + $length;
			} elseif ( isset( $arrays[$type] ) ) {
				$array = unpack( 'Vcount/Vencoding/Vlength', (string) fread( $handle, 12 ) . str_repeat( "\0", 12 ) );
				$decoded = $array['count'] * $arrays[$type];
				// THREE.FBXLoader reads uncompressed arrays by count and inflates everything else with zlib.
				if ( $array['encoding'] > 1 || ( 0 === $array['encoding'] && $array['length'] !== $decoded ) || $position + 12 + $array['length'] > $children ) {
					return $broken;
				}
				$stats['array_bytes'] += $decoded;
				if ( $stats['array_bytes'] > self::FBX_MAX_ARRAY_BYTES ) {
					return self::error( 'FBX слишком сложный: после распаковки данные превышают ' . ( self::FBX_MAX_ARRAY_BYTES / 1048576 ) . ' МиБ. Упростите модель или экспортируйте без анимации.' );
				}
				$polygons = null !== $geometry && 'PolygonVertexIndex' === $name;
				if ( $polygons && 'i' !== $type ) {
					return $broken;
				}
				// FBXLoader inflates every compressed array: a damaged one anywhere stops the whole file.
				if ( $array['encoding'] || $polygons ) {
					$scan = self::fbx_array( $handle, $array['encoding'], $array['length'], $decoded, $polygons );
					if ( false === $scan ) {
						return $broken;
					}
					if ( $polygons ) {
						$stats['geometries'][$geometry]['indices'] += $array['count'];
						$stats['geometries'][$geometry]['polygons'] += $scan[0];
						$stats['geometries'][$geometry]['singles'] += $scan[1];
					}
				}
				if ( null !== $geometry && 'Vertices' === $name && 'Mesh' === $stats['geometries'][$geometry]['type'] ) {
					$stats['vertices'] += intdiv( $array['count'], 3 );
				}
				$position += 12 + $array['length'];
			} else {
				return $broken;
			}
			if ( $keep ) {
				$values[] = $value;
			}
			if ( $position > $children || 0 !== fseek( $handle, $position ) ) {
				return $broken;
			}
		}
		if ( $position !== $children ) {
			return $broken;
		}
		$child_geometry = null;
		if ( $keep && 'C' !== $name && is_numeric( $values[0] ?? null ) ) {
			$id = self::fbx_key( $values[0] );
			$type = is_string( $values[2] ?? null ) ? $values[2] : '';
			// For a repeated id the binary FBXLoader keeps the first object.
			if ( 'Geometry' === $name && ! isset( $stats['geometries'][$id] ) ) {
				$child_geometry = $id;
				$stats['geometries'][$id] = array( 'type' => $type, 'indices' => 0, 'polygons' => 0, 'singles' => 0 );
			} elseif ( 'Model' === $name && ! isset( $stats['models'][$id] ) ) {
				$stats['models'][$id] = $type;
			} elseif ( 'Deformer' === $name && ! isset( $stats['deformers'][$id] ) ) {
				$stats['deformers'][$id] = $type;
			}
		} elseif ( $keep && 'C' === $name && is_numeric( $values[1] ?? null ) && is_numeric( $values[2] ?? null ) ) {
			$stats['connections'][] = array( self::fbx_key( $values[1] ), self::fbx_key( $values[2] ) );
		}
		while ( $position < $head['end'] ) {
			$position = self::fbx_record( $handle, $size, $wide, $position, $name, $depth + 1, $stats, $child_geometry );
			if ( is_wp_error( $position ) ) {
				return $position;
			}
		}
		return $position === $head['end'] ? $position : $broken;
	}

	/**
	 * Checks that an array decodes to exactly its declared size. For PolygonVertexIndex it also counts
	 * polygon ends (negative indices) and one-vertex polygons (a negative index after another one)
	 * without unpacking the values into PHP arrays. Compressed data is inflated in small steps,
	 * so a forged stream cannot expand beyond its declared size.
	 */
	private static function fbx_array( $handle, $encoding, $length, $expected, $polygons ) {
		$inflate = $encoding ? inflate_init( ZLIB_ENCODING_DEFLATE ) : null;
		if ( $encoding && ! $inflate ) {
			return false;
		}
		$ends = 0;
		$singles = 0;
		$decoded = 0;
		$rest = '';
		$previous = "\0\0\0\x80"; // The array starts like after a polygon end.
		for ( $left = $length; $left > 0; ) {
			$piece = (string) fread( $handle, min( $inflate ? 16384 : 1048576, $left ) );
			if ( '' === $piece ) {
				return false;
			}
			$left -= strlen( $piece );
			if ( $inflate ) {
				$piece = @inflate_add( $inflate, $piece, $left ? ZLIB_SYNC_FLUSH : ZLIB_FINISH );
				if ( false === $piece ) {
					return false;
				}
			}
			$decoded += strlen( $piece );
			if ( $decoded > $expected ) {
				return false;
			}
			if ( ! $polygons ) {
				continue;
			}
			$piece = $rest . $piece;
			$usable = strlen( $piece ) - strlen( $piece ) % 4;
			// The sign bit of a little-endian int32 is the top bit of its fourth byte.
			$signs = substr( $piece, 0, $usable ) & str_repeat( "\0\0\0\x80", $usable / 4 );
			$ends += substr_count( $signs, "\x80" );
			if ( $usable ) {
				// Shifting the signs by one value marks values whose predecessor is negative too.
				$singles += substr_count( $signs & ( $previous . substr( $signs, 0, -4 ) ), "\x80" );
				$previous = substr( $signs, -4 );
			}
			$rest = (string) substr( $piece, $usable );
		}
		if ( $inflate && ZLIB_STREAM_END !== inflate_get_status( $inflate ) ) {
			return false;
		}
		return $decoded === $expected ? array( $ends, $singles ) : false;
	}

	/**
	 * ASCII FBX is read the way FBXLoader's text parser reads it: tab indentation, node attributes split
	 * at every comma, array values parsed one by one (the declared "*N" length is ignored).
	 */
	private static function validate_fbx_ascii( $handle, &$stats ) {
		$broken = self::error( 'Структура FBX повреждена. Экспортируйте файл заново.' );
		$version = 0;
		$carry = '';
		$first = true;
		$geometry = null;
		$open = null; // The Vertices or PolygonVertexIndex array being read: kind, geometry and counters.
		$negative = '-0*[1-9]';
		$pattern = '/(?:^|\n)(?:\t*(?:(Geometry|Model|Deformer):([^\n]*)\{|(Vertices|PolygonVertexIndex):[ \t]*\*\d+[ \t]*\{|C:[ \t]+([^\n]*))|(Objects|Connections):[ \t]*\{)/';
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
			// Keys are short: keep a tail so a key split between chunks is read exactly once.
			$limit = feof( $handle ) ? strlen( $buffer ) : max( 0, strlen( $buffer ) - 4096 );
			$position = 0;
			while ( true ) {
				if ( null !== $open ) {
					$close = strpos( $buffer, '}', $position );
					// Without the closing brace, stop after the last complete value; the rest is read with the next chunk.
					$comma = false === $close ? strrpos( $buffer, ',', $position ) : false;
					$end = false !== $close ? $close : ( false !== $comma ? $comma + 1 : $position );
					if ( false === $close && false === $comma && strlen( $buffer ) - $position > 65536 ) {
						return $broken;
					}
					$segment = (string) substr( $buffer, $position, $end - $position );
					if ( ! $open['started'] && '' !== trim( $segment ) ) {
						if ( ! preg_match( '/^\s*a:[ \t]*/', $segment, $prefix ) ) {
							return $broken;
						}
						$segment = (string) substr( $segment, strlen( $prefix[0] ) );
						$open['started'] = true;
					}
					// FBXLoader joins a long array only from unindented lines, and only after a trailing comma.
					if ( preg_match( '/\n[ \t]+[^\s}]/', $segment ) ) {
						return $broken;
					}
					$open['commas'] += substr_count( $segment, ',' );
					$open['digits'] = $open['digits'] || strcspn( $segment, '0123456789' ) < strlen( $segment );
					$trimmed = rtrim( $segment );
					if ( '' !== $trimmed ) {
						$open['last'] = substr( $trimmed, -1 );
					}
					if ( 'PolygonVertexIndex' === $open['kind'] && '' !== $segment ) {
						if ( preg_match( '/[^0-9,\s-]/', $segment ) ) {
							return $broken; // Indices are integers; FBXLoader would read anything else with parseFloat.
						}
						// Every negative value ends a polygon; one right after another negative one is a one-vertex polygon.
						$open['minus'] += preg_match_all( '/' . $negative . '/', $segment );
						$open['singles'] += preg_match_all( '/' . $negative . '\d*\s*,\s*(?=' . $negative . ')/', $segment );
						$open['singles'] += $open['negative'] && preg_match( '/^\s*' . $negative . '/', $segment ) ? 1 : 0;
						if ( preg_match( '/\d\s*,\s*$/', $segment ) ) {
							$open['negative'] = (bool) preg_match( '/' . $negative . '\d*\s*,\s*$/', $segment );
						}
					}
					$position = $end;
					if ( false === $close ) {
						break;
					}
					if ( ',' === $open['last'] ) {
						return $broken; // A trailing comma leaves the array unparsed in FBXLoader.
					}
					$values = $open['digits'] ? $open['commas'] + 1 : 0;
					if ( 'Vertices' === $open['kind'] ) {
						if ( 'Mesh' === $stats['geometries'][ $open['geometry'] ]['type'] ) {
							$stats['vertices'] += intdiv( $values, 3 );
						}
						$stats['array_bytes'] += $values * 8;
					} else {
						$stats['geometries'][ $open['geometry'] ]['indices'] += $values;
						$stats['geometries'][ $open['geometry'] ]['polygons'] += $open['minus'];
						$stats['geometries'][ $open['geometry'] ]['singles'] += $open['singles'];
						$stats['array_bytes'] += $values * 4;
					}
					$open = null;
					continue;
				}
				if ( ! preg_match( $pattern, $buffer, $match, PREG_OFFSET_CAPTURE, $position ) || $match[0][1] >= $limit ) {
					$position = max( $position, $limit );
					break;
				}
				$position = $match[0][1] + strlen( $match[0][0] );
				if ( '' !== ( $match[1][0] ?? '' ) ) {
					$attributes = array_map(
						static function ( $part ) {
							return preg_replace( array( '/^"/', '/"$/' ), '', trim( $part ) );
						},
						explode( ',', $match[2][0] )
					);
					$geometry = null;
					// FBXLoader: id = parseInt(first attribute), type = third attribute; the last repeated id wins.
					if ( preg_match( '/^[+-]?\d+/', $attributes[0], $digits ) ) {
						$id = self::fbx_key( $digits[0] );
						$type = $attributes[2] ?? '';
						if ( 'Geometry' === $match[1][0] ) {
							$geometry = $id;
							$stats['geometries'][$id] = array( 'type' => $type, 'indices' => 0, 'polygons' => 0, 'singles' => 0 );
						} elseif ( 'Model' === $match[1][0] ) {
							$stats['models'][$id] = $type;
						} else {
							$stats['deformers'][$id] = $type;
						}
					}
				} elseif ( '' !== ( $match[3][0] ?? '' ) && null !== $geometry ) {
					$open = array( 'kind' => $match[3][0], 'geometry' => $geometry, 'commas' => 0, 'minus' => 0, 'digits' => false, 'singles' => 0, 'negative' => true, 'started' => false, 'last' => '' );
				} elseif ( '' !== ( $match[4][0] ?? '' ) ) {
					$parts = explode( ',', $match[4][0] );
					if ( preg_match( '/^\s*([+-]?\d+)/', $parts[1] ?? '', $from ) && preg_match( '/^\s*([+-]?\d+)/', $parts[2] ?? '', $to ) ) {
						$stats['connections'][] = array( self::fbx_key( $from[1] ), self::fbx_key( $to[1] ) );
					}
				} elseif ( 'Objects' === ( $match[5][0] ?? '' ) ) {
					// FBXLoader keeps only the last top-level Objects and Connections records.
					$stats['objects'] = true;
					$stats['geometries'] = array();
					$stats['models'] = array();
					$stats['deformers'] = array();
					$geometry = null;
				} elseif ( 'Connections' === ( $match[5][0] ?? '' ) ) {
					$stats['connections'] = array();
				}
				if ( $stats['array_bytes'] > self::FBX_MAX_ARRAY_BYTES ) {
					return self::error( 'FBX слишком сложный: после распаковки данные превышают ' . ( self::FBX_MAX_ARRAY_BYTES / 1048576 ) . ' МиБ. Упростите модель или экспортируйте без анимации.' );
				}
			}
			// THREE.FBXLoader takes the first "FBXVersion: <number>" in the text.
			if ( ! $version && preg_match( '/FBXVersion: (\d+)/', substr( $buffer, 0, $limit ), $match ) ) {
				$version = (int) $match[1];
			}
			$carry = (string) substr( $buffer, $position );
		}
		if ( null !== $open ) {
			return $broken;
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
		// OBJLoader makes one mesh per o/g object with faces; an object with l/p lines becomes lines or points.
		$meshes = 0;
		$object = array( 'declared' => false, 'faces' => false, 'lines' => false );
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
				$object['faces'] = true;
			} elseif ( preg_match( '/^(?:o|g)(?:\s|$)/', $line ) ) {
				// The first o/g only names the object that already holds earlier faces.
				if ( $object['declared'] ) {
					$meshes += $object['faces'] && ! $object['lines'] ? 1 : 0;
					$object = array( 'declared' => true, 'faces' => false, 'lines' => false );
				}
				$object['declared'] = true;
			} elseif ( preg_match( '/^(?:l|p)(?:\s|$)/', $line ) ) {
				$object['lines'] = true;
			} elseif ( ! preg_match( '/^(?:s|usemtl|mtllib)(?:\s|$)/', $line ) ) {
				$error = 'Поддерживается полигональный OBJ. Экспортируйте поверхности и кривые в виде сетки.';
				break;
			}
			if ( $vertices > self::MAX_VERTICES || $triangles > self::MAX_TRIANGLES ) {
				$error = 'OBJ слишком детализирован. Лимит: ' . self::number( self::MAX_VERTICES ) . ' вершин и ' . self::number( self::MAX_TRIANGLES ) . ' треугольников.' . self::REDUCE;
				break;
			}
		}
		fclose( $handle );
		$meshes += $object['faces'] && ! $object['lines'] ? 1 : 0;
		if ( ! $error && $triangles && ! $meshes ) {
			$error = 'В OBJ грани находятся в объектах с линиями (l) или точками (p), такие объекты показываются как линии. Экспортируйте модель без линий.';
		}
		if ( $error || ! $vertices || ! $triangles ) {
			return self::error( $error ?: 'OBJ должен содержать вершины и полигональные грани.' );
		}
		if ( $meshes > self::MAX_MESHES ) {
			return self::error( 'OBJ содержит ' . self::number( $meshes ) . ' отдельных объектов (o/g), лимит — ' . self::number( self::MAX_MESHES ) . '.' . self::MERGE );
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

<?php
defined( 'ABSPATH' ) || exit;

final class W3DPV_Plugin {
	private $assets_added = false;

	public function __construct() {
		add_filter( 'upload_mimes', array( $this, 'upload_mimes' ) );
		add_filter( 'wp_handle_upload_prefilter', array( $this, 'upload_prefilter' ) );
		add_filter( 'wp_handle_sideload_prefilter', array( $this, 'upload_prefilter' ) );
		add_filter( 'wp_check_filetype_and_ext', array( $this, 'filetype' ), 10, 5 );
		add_filter( 'woocommerce_product_data_tabs', array( $this, 'product_tab' ) );
		add_action( 'woocommerce_product_data_panels', array( $this, 'product_panel' ) );
		add_action( 'woocommerce_admin_process_product_object', array( $this, 'save_product' ) );
		add_action( 'woocommerce_product_after_variable_attributes', array( $this, 'variation_fields' ), 10, 3 );
		add_action( 'woocommerce_save_product_variation', array( $this, 'save_variation' ), 10, 2 );
		add_filter( 'woocommerce_available_variation', array( $this, 'variation_payload' ), 10, 3 );
		add_action( 'admin_enqueue_scripts', array( $this, 'admin_assets' ) );
		add_action( 'admin_menu', array( $this, 'cache_menu' ) );
		add_action( 'admin_post_w3dpv_clear_cache', array( $this, 'clear_cache' ) );
		add_shortcode( 'product_3d_button', array( $this, 'shortcode' ) );
		add_action( 'woocommerce_single_product_summary', array( $this, 'automatic_button' ), 35 );
		add_filter( 'plugin_action_links_' . plugin_basename( W3DPV_FILE ), array( $this, 'action_links' ) );
	}

	private function uploader_allowed() {
		return current_user_can( 'upload_files' ) && current_user_can( 'edit_products' );
	}

	public function upload_mimes( $mimes ) {
		if ( $this->uploader_allowed() ) {
			foreach ( W3DPV_Model::FORMATS as $extension => $mime ) {
				$mimes[$extension] = $mime;
			}
		}
		return $mimes;
	}

	public function upload_prefilter( $file ) {
		$extension = strtolower( pathinfo( $file['name'], PATHINFO_EXTENSION ) );
		if ( ! W3DPV_Model::supported( $extension ) || ! empty( $file['error'] ) ) {
			return $file;
		}
		if ( ! $this->uploader_allowed() ) {
			$file['error'] = 'Загрузка 3D-моделей доступна только пользователям с правами редактирования товаров и загрузки файлов.';
			return $file;
		}
		$result = W3DPV_Model::validate( $file['tmp_name'], $extension );
		if ( is_wp_error( $result ) ) {
			$file['error'] = $result->get_error_message();
		}
		return $file;
	}

	public function filetype( $data, $file, $filename, $mimes, $real_mime = null ) {
		$extension = strtolower( pathinfo( $filename, PATHINFO_EXTENSION ) );
		if ( ! W3DPV_Model::supported( $extension ) || ! $this->uploader_allowed() ) {
			return $data;
		}
		$expected = W3DPV_Model::FORMATS[$extension];
		// Respect a stricter MIME policy passed by WordPress or another plugin.
		$allowed = wp_check_filetype( $filename, $mimes );
		if ( ( $allowed['type'] ?? '' ) !== $expected || is_wp_error( W3DPV_Model::validate( $file, $extension ) ) ) {
			return array( 'ext' => false, 'type' => false, 'proper_filename' => false );
		}
		return array( 'ext' => $extension, 'type' => $expected, 'proper_filename' => false );
	}

	public function product_tab( $tabs ) {
		$tabs['w3dpv'] = array( 'label' => __( '3D-модель', 'woo-product-3d-viewer' ), 'target' => 'w3dpv_product_data', 'priority' => 65, 'class' => array() );
		return $tabs;
	}

	private function file_field( $id, $name, $attachment_id, $variation = false, $mobile = false ) {
		$attachment = $attachment_id ? W3DPV_Model::attachment( $attachment_id ) : null;
		$valid = $attachment && ! is_wp_error( $attachment );
		?>
		<div class="w3dpv-file-field<?php echo $variation ? ' w3dpv-file-field--variation' : ''; ?>">
			<label for="<?php echo esc_attr( $id ); ?>"><?php echo esc_html( $mobile ? 'Облегчённая модель для телефонов (необязательно)' : 'Файл 3D-модели (GLB, FBX или OBJ)' ); ?></label>
			<input type="hidden" class="w3dpv-attachment-id" id="<?php echo esc_attr( $id ); ?>" name="<?php echo esc_attr( $name ); ?>" value="<?php echo esc_attr( $attachment_id ); ?>">
			<div class="w3dpv-file-info" aria-live="polite"><?php echo esc_html( $valid ? $attachment['name'] : ( is_wp_error( $attachment ) ? 'Файл не подходит: ' . $attachment->get_error_message() . ' Выберите модель заново.' : 'Модель не выбрана' ) ); ?></div>
			<div class="w3dpv-file-actions">
				<button type="button" class="button w3dpv-select-file"><?php esc_html_e( 'Выбрать / загрузить модель', 'woo-product-3d-viewer' ); ?></button>
				<button type="button" class="button w3dpv-remove-file"<?php disabled( ! $attachment_id ); ?>><?php esc_html_e( 'Убрать', 'woo-product-3d-viewer' ); ?></button>
				<button type="button" class="button w3dpv-admin-preview"<?php disabled( ! $valid ); ?> data-model="<?php echo esc_attr( wp_json_encode( $valid ? $attachment : null ) ); ?>"><?php esc_html_e( 'Предпросмотр', 'woo-product-3d-viewer' ); ?></button>
			</div>
		</div>
		<?php
	}

	public function product_panel() {
		global $product_object;
		if ( ! $product_object ) {
			return;
		}
		$meta = static function ( $key, $default ) use ( $product_object ) {
			$value = $product_object->get_meta( '_w3dpv_' . $key );
			return '' === $value ? $default : $value;
		};
		?>
		<div id="w3dpv_product_data" class="panel woocommerce_options_panel hidden">
			<div class="w3dpv-admin-intro"><strong>Покажите товар со всех сторон</strong><p>Загрузите GLB со встроенными материалами и текстурами, FBX (7.x, лучше со встроенными текстурами — Embed Media) или полигональный OBJ. Внешние файлы текстур для FBX и MTL для OBJ не загружаются: такие поверхности показываются цветом материала.</p></div>
			<?php
			wp_nonce_field( 'w3dpv_save_' . $product_object->get_id(), '_w3dpv_nonce' );
			$this->file_field( '_w3dpv_model_id', '_w3dpv_model_id', absint( $meta( 'model_id', 0 ) ) );
			$this->file_field( '_w3dpv_mobile_model_id', '_w3dpv_mobile_model_id', absint( $meta( 'mobile_model_id', 0 ) ), false, true );
			woocommerce_wp_checkbox( array( 'id' => '_w3dpv_auto', 'label' => 'Автовращение', 'description' => 'Медленное вращение при открытии. Покупатель может остановить его.', 'value' => $meta( 'auto', 'yes' ) ) );
			woocommerce_wp_text_input( array( 'id' => '_w3dpv_speed', 'label' => 'Скорость, °/сек', 'type' => 'number', 'value' => $meta( 'speed', 8 ), 'custom_attributes' => array( 'min' => 1, 'max' => 30, 'step' => 1 ) ) );
			woocommerce_wp_text_input( array( 'id' => '_w3dpv_yaw', 'label' => 'Поворот модели, °', 'type' => 'number', 'value' => $meta( 'yaw', 0 ), 'description' => 'Начальное направление модели: от −180 до 180°.', 'desc_tip' => true, 'custom_attributes' => array( 'min' => -180, 'max' => 180, 'step' => 1 ) ) );
			woocommerce_wp_text_input( array( 'id' => '_w3dpv_color', 'label' => 'Цвет без материалов', 'type' => 'color', 'value' => $meta( 'color', '#9aa7b7' ), 'description' => 'Цвет OBJ и сеток FBX, у которых нет материала.', 'desc_tip' => true ) );
			woocommerce_wp_text_input( array( 'id' => '_w3dpv_background', 'label' => 'Фон просмотра', 'type' => 'color', 'value' => $meta( 'background', '#f2f4f7' ) ) );
			woocommerce_wp_checkbox( array( 'id' => '_w3dpv_show_button', 'label' => 'Автоматическая кнопка', 'description' => 'Показывать кнопку после блока покупки в стандартном шаблоне товара. Для Elementor используйте шорткод.', 'value' => $meta( 'show_button', 'no' ) ) );
			?>
			<div class="w3dpv-admin-note"><strong>Шорткод кнопки:</strong> <code>[product_3d_button]</code><br>Для конкретного товара: <code>[product_3d_button id="123" label="Посмотреть в 3D"]</code><p>Для телефонов можно выбрать отдельный GLB/FBX до 5–10 МиБ с текстурами до 2048 px. Если облегчённой модели нет, используется основная. Кэш создаётся автоматически и очищается раз в 30 дней. <a href="<?php echo esc_url( admin_url( 'admin.php?page=w3dpv-cache' ) ); ?>">Управление кэшем 3D</a>.</p><p>Если у вариации нет своего файла, используется модель основного товара. Лимит модели: 80 МиБ (ограничение вашего сервера может быть меньше). Файлы должны храниться в локальной медиатеке; облачное хранение с удалением локального файла не поддерживается.</p></div>
		</div>
		<?php
	}

	private function valid_nonce( $id ) {
		return isset( $_POST['_w3dpv_nonce'] ) && is_string( $_POST['_w3dpv_nonce'] ) && wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST['_w3dpv_nonce'] ) ), 'w3dpv_save_' . $id );
	}

	private function scalar_post( $key, $default = '' ) {
		return isset( $_POST[$key] ) && is_scalar( $_POST[$key] ) ? sanitize_text_field( wp_unslash( $_POST[$key] ) ) : $default;
	}

	private function set_model( $product, $id, $key = 'model_id' ) {
		$id = absint( $id );
		if ( $id ) {
			$result = W3DPV_Model::attachment( $id );
			if ( is_wp_error( $result ) ) {
				if ( class_exists( 'WC_Admin_Meta_Boxes' ) ) {
					WC_Admin_Meta_Boxes::add_error( '3D-модель: ' . $result->get_error_message() . ' Ранее сохранённая модель не изменена.' );
				}
				return;
			}
		}
		$product->update_meta_data( '_w3dpv_' . $key, $id );
	}

	public function save_product( $product ) {
		if ( ! current_user_can( 'edit_post', $product->get_id() ) || ! $this->valid_nonce( $product->get_id() ) || defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) {
			return;
		}
		$this->set_model( $product, $this->scalar_post( '_w3dpv_model_id', 0 ) );
		// Preserve a previously saved mobile file for requests made by older editors.
		if ( isset( $_POST['_w3dpv_mobile_model_id'] ) ) $this->set_model( $product, $this->scalar_post( '_w3dpv_mobile_model_id', 0 ), 'mobile_model_id' );
		foreach ( array( 'auto', 'show_button' ) as $key ) {
			$product->update_meta_data( '_w3dpv_' . $key, 'yes' === $this->scalar_post( '_w3dpv_' . $key ) ? 'yes' : 'no' );
		}
		$product->update_meta_data( '_w3dpv_speed', max( 1, min( 30, (float) $this->scalar_post( '_w3dpv_speed', 8 ) ) ) );
		$product->update_meta_data( '_w3dpv_yaw', max( -180, min( 180, (float) $this->scalar_post( '_w3dpv_yaw', 0 ) ) ) );
		foreach ( array( 'color' => '#9aa7b7', 'background' => '#f2f4f7' ) as $key => $default ) {
			$product->update_meta_data( '_w3dpv_' . $key, sanitize_hex_color( $this->scalar_post( '_w3dpv_' . $key, $default ) ) ?: $default );
		}
	}

	public function variation_fields( $loop, $variation_data, $variation ) {
		$this->file_field( 'w3dpv_variation_' . $variation->ID, 'w3dpv_variation_model[' . $variation->ID . ']', absint( get_post_meta( $variation->ID, '_w3dpv_model_id', true ) ), true );
		$this->file_field( 'w3dpv_variation_mobile_' . $variation->ID, 'w3dpv_variation_mobile_model[' . $variation->ID . ']', absint( get_post_meta( $variation->ID, '_w3dpv_mobile_model_id', true ) ), true, true );
		// Variations can also be saved separately by the WooCommerce AJAX editor.
		wp_nonce_field( 'w3dpv_variation_' . $variation->ID, 'w3dpv_variation_nonce[' . $variation->ID . ']', false );
	}

	public function save_variation( $variation_id, $loop ) {
		if ( ! current_user_can( 'edit_post', $variation_id ) || ! isset( $_POST['w3dpv_variation_model'][$variation_id], $_POST['w3dpv_variation_nonce'][$variation_id] ) ) {
			return;
		}
		$nonce = $_POST['w3dpv_variation_nonce'][$variation_id];
		$id = $_POST['w3dpv_variation_model'][$variation_id];
		if ( ! is_scalar( $nonce ) || ! is_scalar( $id ) || ! wp_verify_nonce( sanitize_text_field( wp_unslash( $nonce ) ), 'w3dpv_variation_' . $variation_id ) ) {
			return;
		}
		$product = wc_get_product( $variation_id );
		if ( $product ) {
			$this->set_model( $product, $id );
			if ( isset( $_POST['w3dpv_variation_mobile_model'][$variation_id] ) && is_scalar( $_POST['w3dpv_variation_mobile_model'][$variation_id] ) ) $this->set_model( $product, $_POST['w3dpv_variation_mobile_model'][$variation_id], 'mobile_model_id' );
			$product->save_meta_data();
		}
	}

	private function accessible( $product ) {
		if ( ! $product ) {
			return false;
		}
		$id = $product->is_type( 'variation' ) ? $product->get_parent_id() : $product->get_id();
		return 'publish' === get_post_status( $id ) && ! post_password_required( $id ) && ( ! $product->is_type( 'variation' ) || 'publish' === get_post_status( $product->get_id() ) );
	}

	private function payload( $product, $settings_product = null ) {
		if ( ! $this->accessible( $product ) ) {
			return null;
		}
		$settings_product = $settings_product ?: $product;
		$id = absint( $product->get_meta( '_w3dpv_model_id' ) );
		$has_own_model = !! $id;
		if ( ! $id && $product->is_type( 'variation' ) ) {
			$id = absint( $settings_product->get_meta( '_w3dpv_model_id' ) );
		}
		$model = $id ? W3DPV_Model::attachment( $id ) : null;
		if ( ! $model || is_wp_error( $model ) ) {
			return null;
		}
		$model = W3DPV_Cache::prepare( $model );
		$mobile_id = absint( $product->get_meta( '_w3dpv_mobile_model_id' ) );
		// A variation's own full model must not inherit a different variant's mobile model.
		if ( ! $mobile_id && $product->is_type( 'variation' ) && ! $has_own_model ) $mobile_id = absint( $settings_product->get_meta( '_w3dpv_mobile_model_id' ) );
		$mobile = $mobile_id ? W3DPV_Model::attachment( $mobile_id ) : null;
		$mobile = $mobile && ! is_wp_error( $mobile ) ? W3DPV_Cache::prepare( $mobile ) : null;
		$get = static function ( $key, $default ) use ( $settings_product ) {
			$value = $settings_product->get_meta( '_w3dpv_' . $key );
			return '' === $value ? $default : $value;
		};
		return array( 'model' => $model, 'mobileModel' => $mobile, 'title' => wp_strip_all_tags( $product->get_name() ), 'auto' => 'yes' === $get( 'auto', 'yes' ), 'speed' => max( 1, min( 30, (float) $get( 'speed', 8 ) ) ), 'yaw' => max( -180, min( 180, (float) $get( 'yaw', 0 ) ) ), 'color' => sanitize_hex_color( $get( 'color', '#9aa7b7' ) ) ?: '#9aa7b7', 'background' => sanitize_hex_color( $get( 'background', '#f2f4f7' ) ) ?: '#f2f4f7' );
	}

	public function variation_payload( $data, $parent, $variation ) {
		$data['w3dpv'] = $this->payload( $variation, $parent );
		return $data;
	}

	public function assets() {
		if ( $this->assets_added ) {
			return;
		}
		$this->assets_added = true;
		wp_enqueue_style( 'w3dpv-front', W3DPV_URL . 'assets/css/viewer.css', array(), W3DPV_VERSION );
		wp_enqueue_script( 'w3dpv-model-cache', W3DPV_URL . 'assets/js/model-cache.js', array(), W3DPV_VERSION, true );
		wp_enqueue_script( 'w3dpv-front', W3DPV_URL . 'assets/js/bootstrap.js', array( 'w3dpv-model-cache' ), W3DPV_VERSION, true );
		wp_localize_script( 'w3dpv-model-cache', 'W3DPVConfig', array( 'version' => W3DPV_VERSION, 'viewerUrl' => W3DPV_URL . 'assets/js/viewer.js?ver=' . W3DPV_VERSION, 'decoderUrl' => W3DPV_URL . 'assets/decoders/', 'maxBytes' => W3DPV_Model::MAX_BYTES, 'maxVertices' => W3DPV_Model::MAX_VERTICES, 'maxMeshes' => W3DPV_Model::MAX_MESHES, 'fbxMaxTriangles' => W3DPV_Model::FBX_MAX_TRIANGLES, 'cacheTTL' => W3DPV_Cache::TTL, 'cacheNamespace' => substr( hash( 'sha256', home_url( '/' ) ), 0, 12 ), 'cacheGeneration' => W3DPV_Cache::generation(), 'canDiagnose' => current_user_can( 'edit_products' ) ) );
		// A shortcode can execute after wp_head (Elementor, widgets, block templates).
		// Core prints late enqueued styles in the footer; there are no manual duplicate tags.
	}

	public function admin_assets() {
		$screen = get_current_screen();
		// Only the product editor needs the media frame and viewer, not the product list.
		if ( ! $screen || 'product' !== $screen->post_type || 'post' !== $screen->base ) {
			return;
		}
		wp_enqueue_media();
		$this->assets();
		wp_enqueue_style( 'w3dpv-admin', W3DPV_URL . 'assets/css/admin.css', array(), W3DPV_VERSION );
		wp_enqueue_script( 'w3dpv-admin', W3DPV_URL . 'assets/js/admin.js', array( 'jquery', 'media-views', 'w3dpv-front' ), W3DPV_VERSION, true );
	}

	public function shortcode( $atts = array() ) {
		$atts = shortcode_atts( array( 'id' => 0, 'label' => 'Посмотреть в 3D', 'class' => '' ), $atts, 'product_3d_button' );
		global $product;
		$current = absint( $atts['id'] ) ? wc_get_product( absint( $atts['id'] ) ) : ( $product instanceof WC_Product ? $product : wc_get_product( get_the_ID() ) );
		if ( ! $this->accessible( $current ) ) {
			return '';
		}
		$settings = $current->is_type( 'variation' ) ? wc_get_product( $current->get_parent_id() ) : $current;
		$payload = $this->payload( $current, $settings );
		$has_variation = false;
		if ( ! $payload && $current->is_type( 'variable' ) ) {
			foreach ( $current->get_children() as $child_id ) {
				$child = wc_get_product( $child_id );
				if ( $child && $this->payload( $child, $current ) ) {
					$has_variation = true;
					break;
				}
			}
		}
		if ( ! $payload && ! $has_variation ) {
			return '';
		}
		$this->assets();
		$classes = array_filter( array_map( 'sanitize_html_class', preg_split( '/\s+/', (string) $atts['class'] ) ) );
		$label = sanitize_text_field( $atts['label'] ) ?: 'Посмотреть в 3D';
		return '<span class="w3dpv-button-wrap"><button type="button" class="w3dpv-trigger ' . esc_attr( implode( ' ', $classes ) ) . '" data-product-id="' . esc_attr( $settings->get_id() ) . '" data-fixed="' . ( $current->is_type( 'variation' ) ? '1' : '0' ) . '" data-w3dpv="' . esc_attr( wp_json_encode( $payload ) ) . '" data-label="' . esc_attr( $label ) . '" aria-haspopup="dialog"' . ( $payload ? '' : ' disabled' ) . '><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/></svg><span>' . esc_html( $payload ? $label : 'Выберите вариант для 3D' ) . '</span></button></span>';
	}

	public function automatic_button() {
		global $product;
		if ( $product instanceof WC_Product && 'yes' === $product->get_meta( '_w3dpv_show_button' ) ) {
			echo $this->shortcode( array( 'id' => $product->get_id() ) ); // Escaped by shortcode().
		}
	}

	public function action_links( $links ) {
		array_unshift( $links, '<a href="' . esc_url( W3DPV_URL . 'README-RU.html' ) . '" target="_blank" rel="noopener noreferrer">Инструкция</a>' );
		return $links;
	}

	public function cache_menu() {
		add_submenu_page( 'woocommerce', 'Кэш 3D-моделей', '3D-модели', 'manage_woocommerce', 'w3dpv-cache', array( $this, 'cache_page' ) );
	}

	public function cache_page() {
		if ( ! current_user_can( 'manage_woocommerce' ) ) return;
		$stats = W3DPV_Cache::stats();
		?>
		<div class="wrap"><h1>Кэш 3D-моделей</h1>
		<?php if ( isset( $_GET['w3dpv_cleared'] ) ) : ?><div class="notice notice-success"><p>Очистка кэша завершена. Копии создадутся при следующем открытии страницы товара.</p></div><?php endif; ?>
		<p>Копии на сайте: <strong><?php echo esc_html( $stats['files'] ); ?></strong>; размер: <strong><?php echo esc_html( size_format( $stats['bytes'], 1 ) ); ?></strong>. Максимум 512 МиБ, затем удаляются самые старые копии.</p>
		<p>Автоматическая очистка — каждые 30 дней через WP-Cron. Следующая задача: <?php echo esc_html( $stats['next'] ? wp_date( 'd.m.Y H:i', $stats['next'] ) : 'не запланирована' ); ?>. При отключённом WP-Cron нужен системный cron; без посещений задача выполняется позже.</p>
		<p>Проверенные файлы повторно используются браузером до 30 дней при наличии доступного хранилища и HTTPS. Нехватка места или приватный режим не блокируют просмотр. Первый просмотр большой модели всё равно зависит от скорости сети; кэш не уменьшает файл.</p>
		<p>Очистка удаляет только копии плагина. Файлы медиатеки и привязки к товарам сохраняются. После ручной очистки обновите кэш страниц сайта, чтобы посетители получили новые адреса.</p>
		<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>"><input type="hidden" name="action" value="w3dpv_clear_cache"><?php wp_nonce_field( 'w3dpv_clear_cache' ); submit_button( 'Очистить кэш 3D-моделей' ); ?></form></div>
		<?php
	}

	public function clear_cache() {
		if ( ! current_user_can( 'manage_woocommerce' ) ) wp_die( 'Недостаточно прав.', '', array( 'response' => 403 ) );
		check_admin_referer( 'w3dpv_clear_cache' );
		if ( false === W3DPV_Cache::clear() ) wp_die( 'Кэш сейчас используется. Повторите очистку через несколько секунд.' );
		wp_safe_redirect( admin_url( 'admin.php?page=w3dpv-cache&w3dpv_cleared=1' ) );
		exit;
	}
}

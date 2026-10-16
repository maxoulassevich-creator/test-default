<?php
defined( 'ABSPATH' ) || exit;

final class W3DPV_Plugin {
	/** Models per product; each has an optional phone version and a label for the switcher. */
	const SLOTS = 3;
	private static $instance = null;
	private $assets_added = false;

	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	/** Meta key of a model slot: slot 1 keeps the keys of earlier versions. */
	public static function slot_key( $slot, $field ) {
		$suffix = 1 === $slot ? '' : '_' . $slot;
		return array( 'model' => '_w3dpv_model' . $suffix . '_id', 'mobile' => '_w3dpv_mobile_model' . $suffix . '_id', 'label' => '_w3dpv_model' . $suffix . '_label' )[$field];
	}

	private function __construct() {
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
			for ( $slot = 1; $slot <= self::SLOTS; ++$slot ) :
				$model_key = self::slot_key( $slot, 'model' );
				$mobile_key = self::slot_key( $slot, 'mobile' );
				$label_key = self::slot_key( $slot, 'label' );
				?>
				<fieldset class="w3dpv-slot">
					<legend><?php echo esc_html( 1 === $slot ? 'Модель 1 (открывается первой)' : 'Модель ' . $slot . ' (необязательно)' ); ?></legend>
					<?php
					$this->file_field( $model_key, $model_key, absint( $product_object->get_meta( $model_key ) ) );
					$this->file_field( $mobile_key, $mobile_key, absint( $product_object->get_meta( $mobile_key ) ), false, true );
					woocommerce_wp_text_input( array( 'id' => $label_key, 'label' => 'Название на переключателе', 'value' => $product_object->get_meta( $label_key ), 'placeholder' => 'Модель ' . $slot, 'description' => 'Например: «В сборе», «Красный», «Упаковка». Переключатель появляется, когда моделей больше одной.', 'desc_tip' => true, 'custom_attributes' => array( 'maxlength' => 40 ) ) );
					?>
				</fieldset>
				<?php
			endfor;
			woocommerce_wp_checkbox( array( 'id' => '_w3dpv_auto', 'label' => 'Автовращение', 'description' => 'Медленное вращение при открытии. Покупатель может остановить его.', 'value' => $meta( 'auto', 'yes' ) ) );
			woocommerce_wp_text_input( array( 'id' => '_w3dpv_speed', 'label' => 'Скорость, °/сек', 'type' => 'number', 'value' => $meta( 'speed', 8 ), 'custom_attributes' => array( 'min' => 1, 'max' => 30, 'step' => 1 ) ) );
			woocommerce_wp_text_input( array( 'id' => '_w3dpv_yaw', 'label' => 'Поворот модели, °', 'type' => 'number', 'value' => $meta( 'yaw', 0 ), 'description' => 'Начальное направление модели: от −180 до 180°.', 'desc_tip' => true, 'custom_attributes' => array( 'min' => -180, 'max' => 180, 'step' => 1 ) ) );
			woocommerce_wp_text_input( array( 'id' => '_w3dpv_color', 'label' => 'Цвет без материалов', 'type' => 'color', 'value' => $meta( 'color', '#9aa7b7' ), 'description' => 'Цвет OBJ и сеток FBX, у которых нет материала.', 'desc_tip' => true ) );
			woocommerce_wp_text_input( array( 'id' => '_w3dpv_background', 'label' => 'Фон просмотра', 'type' => 'color', 'value' => $meta( 'background', '#f2f4f7' ) ) );
			woocommerce_wp_checkbox( array( 'id' => '_w3dpv_show_button', 'label' => 'Автоматическая кнопка', 'description' => 'Показывать кнопку после блока покупки в стандартном шаблоне товара. Для Elementor используйте шорткод.', 'value' => $meta( 'show_button', 'no' ) ) );
			?>
			<div class="w3dpv-admin-note"><strong>Шорткод кнопки:</strong> <code>[product_3d_button]</code><br>Для конкретного товара: <code>[product_3d_button id="123" label="Посмотреть в 3D"]</code><p>Для телефонов можно выбрать отдельный GLB/FBX до 5–10 МиБ с текстурами до 2048 px. Если облегчённой модели нет, используется основная. Кэш создаётся автоматически и очищается раз в 30 дней. <a href="<?php echo esc_url( W3DPV_Settings::url( 'cache' ) ); ?>">Управление кэшем 3D</a>, <a href="<?php echo esc_url( W3DPV_Settings::url() ); ?>">вид кнопки и окна</a>.</p><p>Если у вариации нет своего файла, показываются все модели основного товара; если есть — только модель вариации. Лимит файла: <?php echo esc_html( W3DPV_Model::MAX_BYTES / 1048576 ); ?> МиБ (лимит загрузки вашего сервера может быть меньше: <?php echo esc_html( size_format( wp_max_upload_size() ) ); ?>). Как подготовить модель в Blender — в <a href="<?php echo esc_url( W3DPV_URL . 'README-RU.html#blender' ); ?>" target="_blank" rel="noopener noreferrer">инструкции</a>. Файлы должны храниться в локальной медиатеке; облачное хранение с удалением локального файла не поддерживается.</p></div>
		</div>
		<?php
	}

	private function valid_nonce( $id ) {
		return isset( $_POST['_w3dpv_nonce'] ) && is_string( $_POST['_w3dpv_nonce'] ) && wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST['_w3dpv_nonce'] ) ), 'w3dpv_save_' . $id );
	}

	private function scalar_post( $key, $default = '' ) {
		return isset( $_POST[$key] ) && is_scalar( $_POST[$key] ) ? sanitize_text_field( wp_unslash( $_POST[$key] ) ) : $default;
	}

	private function set_model( $product, $id, $key = '_w3dpv_model_id' ) {
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
		if ( ! $id && '_w3dpv_model_id' !== $key ) {
			// Empty optional slots leave no rows behind.
			$product->delete_meta_data( $key );
			return;
		}
		$product->update_meta_data( $key, $id );
	}

	public function save_product( $product ) {
		if ( ! current_user_can( 'edit_post', $product->get_id() ) || ! $this->valid_nonce( $product->get_id() ) || defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) {
			return;
		}
		for ( $slot = 1; $slot <= self::SLOTS; ++$slot ) {
			$model_key = self::slot_key( $slot, 'model' );
			// Preserve fields that a request from an older editor does not carry.
			if ( 1 === $slot || isset( $_POST[$model_key] ) ) {
				$this->set_model( $product, $this->scalar_post( $model_key, 0 ), $model_key );
			}
			if ( isset( $_POST[ self::slot_key( $slot, 'mobile' ) ] ) ) {
				$this->set_model( $product, $this->scalar_post( self::slot_key( $slot, 'mobile' ), 0 ), self::slot_key( $slot, 'mobile' ) );
			}
			if ( isset( $_POST[ self::slot_key( $slot, 'label' ) ] ) ) {
				$label = mb_substr( $this->scalar_post( self::slot_key( $slot, 'label' ) ), 0, 40 );
				'' === $label ? $product->delete_meta_data( self::slot_key( $slot, 'label' ) ) : $product->update_meta_data( self::slot_key( $slot, 'label' ), $label );
			}
		}
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
			if ( isset( $_POST['w3dpv_variation_mobile_model'][$variation_id] ) && is_scalar( $_POST['w3dpv_variation_mobile_model'][$variation_id] ) ) $this->set_model( $product, $_POST['w3dpv_variation_mobile_model'][$variation_id], '_w3dpv_mobile_model_id' );
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

	/** Valid models of a product in slot order. Variations have one slot. */
	private function models( $product ) {
		$models = array();
		$slots = $product->is_type( 'variation' ) ? 1 : self::SLOTS;
		for ( $slot = 1; $slot <= $slots; ++$slot ) {
			$id = absint( $product->get_meta( self::slot_key( $slot, 'model' ) ) );
			$model = $id ? W3DPV_Model::attachment( $id ) : null;
			if ( ! $model || is_wp_error( $model ) ) {
				continue;
			}
			// A phone version belongs to its own slot only, never to another model or variant.
			$mobile_id = absint( $product->get_meta( self::slot_key( $slot, 'mobile' ) ) );
			$mobile = $mobile_id ? W3DPV_Model::attachment( $mobile_id ) : null;
			$models[] = array( 'model' => W3DPV_Cache::prepare( $model ), 'mobileModel' => $mobile && ! is_wp_error( $mobile ) ? W3DPV_Cache::prepare( $mobile ) : null, 'label' => wp_strip_all_tags( (string) $product->get_meta( self::slot_key( $slot, 'label' ) ) ) );
		}
		return $models;
	}

	private function payload( $product, $settings_product = null ) {
		if ( ! $this->accessible( $product ) ) {
			return null;
		}
		$settings_product = $settings_product ?: $product;
		$models = $this->models( $product );
		// A variation without its own file shows every model of the product; one with an unusable file shows none.
		if ( ! $models && $product->is_type( 'variation' ) && ! absint( $product->get_meta( '_w3dpv_model_id' ) ) ) {
			$models = $this->models( $settings_product );
		}
		if ( ! $models ) {
			return null;
		}
		$get = static function ( $key, $default ) use ( $settings_product ) {
			$value = $settings_product->get_meta( '_w3dpv_' . $key );
			return '' === $value ? $default : $value;
		};
		// "model" and "mobileModel" keep the 1.1 format for code that reads the first model.
		return array( 'models' => $models, 'model' => $models[0]['model'], 'mobileModel' => $models[0]['mobileModel'], 'title' => wp_strip_all_tags( $product->get_name() ), 'auto' => 'yes' === $get( 'auto', 'yes' ), 'speed' => max( 1, min( 30, (float) $get( 'speed', 8 ) ) ), 'yaw' => max( -180, min( 180, (float) $get( 'yaw', 0 ) ) ), 'color' => sanitize_hex_color( $get( 'color', '#9aa7b7' ) ) ?: '#9aa7b7', 'background' => sanitize_hex_color( $get( 'background', '#f2f4f7' ) ) ?: '#f2f4f7' );
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
		wp_localize_script( 'w3dpv-model-cache', 'W3DPVConfig', array( 'version' => W3DPV_VERSION, 'viewerUrl' => W3DPV_URL . 'assets/js/viewer.js?ver=' . W3DPV_VERSION, 'decoderUrl' => W3DPV_URL . 'assets/decoders/', 'maxBytes' => W3DPV_Model::MAX_BYTES, 'maxVertices' => W3DPV_Model::MAX_VERTICES, 'maxMeshes' => W3DPV_Model::MAX_MESHES, 'fbxMaxTriangles' => W3DPV_Model::FBX_MAX_TRIANGLES, 'cacheTTL' => W3DPV_Cache::TTL, 'cacheNamespace' => substr( hash( 'sha256', home_url( '/' ) ), 0, 12 ), 'cacheGeneration' => W3DPV_Cache::generation(), 'canDiagnose' => current_user_can( 'edit_products' ), 'ui' => W3DPV_Settings::ui() ) );
		wp_add_inline_style( 'w3dpv-front', W3DPV_Settings::css() );
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
		$atts = shortcode_atts( array( 'id' => 0, 'label' => '', 'class' => '' ), $atts, 'product_3d_button' );
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
		$label = sanitize_text_field( $atts['label'] ) ?: W3DPV_Settings::get( 'btn_label' );
		return $this->button_markup( $label, wp_json_encode( $payload ), $settings->get_id(), $current->is_type( 'variation' ), (bool) $payload, $classes );
	}

	/** The product button; also rendered as the live preview on the settings page. */
	public function button_markup( $label, $payload_json, $product_id, $fixed, $enabled, $classes = array() ) {
		$style = W3DPV_Settings::get();
		$wrap = 'w3dpv-button-wrap w3dpv-width-' . $style['btn_width'] . ' w3dpv-align-' . $style['btn_align'];
		$icon = 'yes' === $style['btn_icon'] ? '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/></svg>' : '';
		return '<span class="' . esc_attr( $wrap ) . '"><button type="button" class="' . esc_attr( trim( 'w3dpv-trigger ' . implode( ' ', $classes ) ) ) . '" data-product-id="' . esc_attr( $product_id ) . '" data-fixed="' . ( $fixed ? '1' : '0' ) . '" data-w3dpv="' . esc_attr( $payload_json ) . '" data-label="' . esc_attr( $label ) . '" data-label-disabled="' . esc_attr( $style['btn_label_disabled'] ) . '" aria-haspopup="dialog"' . ( $enabled ? '' : ' disabled' ) . '>' . $icon . '<span>' . esc_html( $enabled ? $label : $style['btn_label_disabled'] ) . '</span></button></span>';
	}

	public function automatic_button() {
		global $product;
		if ( $product instanceof WC_Product && 'yes' === $product->get_meta( '_w3dpv_show_button' ) ) {
			echo $this->shortcode( array( 'id' => $product->get_id() ) ); // Escaped by shortcode().
		}
	}

	public function action_links( $links ) {
		array_unshift( $links, '<a href="' . esc_url( W3DPV_Settings::url() ) . '">Настройки</a>', '<a href="' . esc_url( W3DPV_URL . 'README-RU.html' ) . '" target="_blank" rel="noopener noreferrer">Инструкция</a>' );
		return $links;
	}
}

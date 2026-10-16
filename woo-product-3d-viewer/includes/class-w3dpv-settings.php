<?php
defined( 'ABSPATH' ) || exit;

/** Styles of the product button and the viewer window: WooCommerce > 3D-просмотр. */
final class W3DPV_Settings {
	const OPTION = 'w3dpv_style';
	const GROUP = 'w3dpv_settings';
	const PAGE = 'w3dpv-settings';
	private static $values = null;

	public static function init() {
		add_action( 'admin_menu', array( __CLASS__, 'menu' ) );
		add_action( 'admin_init', array( __CLASS__, 'register' ) );
		add_action( 'admin_enqueue_scripts', array( __CLASS__, 'admin_assets' ) );
		add_action( 'admin_post_w3dpv_clear_cache', array( __CLASS__, 'clear_cache' ) );
		// Shop managers edit these settings; options.php asks for manage_options by default.
		add_filter( 'option_page_capability_' . self::GROUP, static function () {
			return 'manage_woocommerce';
		} );
		// Bookmarks of the 1.0–1.1 cache page.
		add_action( 'admin_page_access_denied', static function () {
			if ( isset( $_GET['page'] ) && 'w3dpv-cache' === $_GET['page'] && current_user_can( 'manage_woocommerce' ) ) {
				wp_safe_redirect( self::url( 'cache' ) );
				exit;
			}
		} );
	}

	/**
	 * Every setting: type, default, label and, for styles, the CSS custom property it sets.
	 * The defaults reproduce the plugin's original look.
	 */
	public static function fields() {
		$weights = array( '400' => 'Обычный', '500' => 'Средний', '600' => 'Полужирный', '700' => 'Жирный' );
		$fonts = array( 'system' => 'Системный (как в плагине)', 'inherit' => 'Как на сайте' );
		return array(
			'button' => array(
				'title' => 'Кнопка на странице товара',
				'fields' => array(
					'btn_label' => array( 'text', 'Посмотреть в 3D', 'Текст кнопки', 'Шорткод с параметром label использует свой текст.' ),
					'btn_label_disabled' => array( 'text', 'Выберите вариант для 3D', 'Текст, пока вариант не выбран' ),
					'btn_icon' => array( 'bool', 'yes', 'Значок 3D на кнопке' ),
					'btn_width' => array( 'select', 'mobile', 'Ширина', '', array( 'auto' => 'По тексту', 'mobile' => 'Во всю ширину на телефонах', 'full' => 'Всегда во всю ширину' ) ),
					'btn_align' => array( 'select', 'theme', 'Выравнивание', '', array( 'theme' => 'Как в теме', 'left' => 'Слева', 'center' => 'По центру', 'right' => 'Справа' ) ),
					'btn_font' => array( 'select', 'system', 'Шрифт', '', $fonts ),
					'btn_fill' => array( 'bool', 'yes', 'Заливка фона', 'Без заливки получится контурная кнопка.' ),
					'btn_bg' => array( 'color', '#273f62', 'Цвет фона', '', null, '--w3dpv-btn-bg' ),
					'btn_color' => array( 'color', '#ffffff', 'Цвет текста', '', null, '--w3dpv-btn-color' ),
					'btn_border' => array( 'color', '#273f62', 'Цвет рамки', '', null, '--w3dpv-btn-border' ),
					'btn_border_width' => array( 'int', 1, 'Толщина рамки, px', '', array( 0, 6 ), '--w3dpv-btn-border-width' ),
					'btn_hover_bg' => array( 'color', '#1b2e4a', 'Фон при наведении', '', null, '--w3dpv-btn-hover-bg' ),
					'btn_hover_color' => array( 'color', '#ffffff', 'Текст при наведении', '', null, '--w3dpv-btn-hover-color' ),
					'btn_radius' => array( 'int', 10, 'Скругление углов, px', '', array( 0, 40 ), '--w3dpv-btn-radius' ),
					'btn_font_size' => array( 'int', 15, 'Размер текста, px', '', array( 12, 24 ), '--w3dpv-btn-font-size' ),
					'btn_font_weight' => array( 'select', '600', 'Насыщенность текста', '', $weights, '--w3dpv-btn-font-weight' ),
					'btn_height' => array( 'int', 48, 'Высота, px', 'На сенсорных экранах не меньше 44 px.', array( 32, 72 ), '--w3dpv-btn-height' ),
					'btn_padding' => array( 'int', 20, 'Отступ слева и справа, px', '', array( 8, 48 ), '--w3dpv-btn-padding' ),
					'btn_shadow' => array( 'bool', 'yes', 'Тень при наведении' ),
				),
			),
			'window' => array(
				'title' => 'Окно просмотра',
				'fields' => array(
					'dlg_eyebrow' => array( 'text', 'ПРОСМОТР В 3D', 'Надпись над названием', 'Оставьте пустым, чтобы скрыть. У товара с несколькими моделями останется счётчик «1/3».' ),
					'dlg_font' => array( 'select', 'system', 'Шрифт окна', '', $fonts ),
					'dlg_width' => array( 'int', 960, 'Максимальная ширина, px', 'На телефоне окно занимает весь экран.', array( 600, 1600 ), '--w3dpv-dlg-width' ),
					'dlg_height' => array( 'int', 760, 'Максимальная высота, px', '', array( 400, 1200 ), '--w3dpv-dlg-height' ),
					'dlg_radius' => array( 'int', 20, 'Скругление углов окна, px', '', array( 0, 40 ), '--w3dpv-dlg-radius' ),
					'dlg_bg' => array( 'color', '#ffffff', 'Фон окна (шапка и панель кнопок)', '', null, '--w3dpv-dlg-bg' ),
					'dlg_text' => array( 'color', '#1b2534', 'Цвет названия товара', '', null, '--w3dpv-dlg-text' ),
					'dlg_title_size' => array( 'int', 21, 'Размер названия, px', '', array( 14, 32 ), '--w3dpv-dlg-title-size' ),
					'dlg_muted' => array( 'color', '#62738b', 'Цвет второстепенного текста', 'Надпись над названием, подсказка, пояснения при загрузке.', null, '--w3dpv-dlg-muted' ),
					'dlg_divider' => array( 'color', '#e7ebf0', 'Цвет разделителей', '', null, '--w3dpv-dlg-divider' ),
					'backdrop_color' => array( 'color', '#0c1626', 'Затемнение страницы: цвет' ),
					'backdrop_opacity' => array( 'int', 70, 'Затемнение страницы: плотность, %', '', array( 0, 100 ) ),
					'backdrop_blur' => array( 'int', 5, 'Размытие страницы, px', '', array( 0, 12 ) ),
					'status_bg' => array( 'color', '#f2f4f7', 'Фон экрана загрузки' ),
					'status_color' => array( 'color', '#273f62', 'Цвет заголовка загрузки и индикатора', '', null, '--w3dpv-status-color' ),
				),
			),
			'controls' => array(
				'title' => 'Кнопки управления в окне',
				'fields' => array(
					'ctl_bg' => array( 'color', '#ffffff', 'Фон кнопок', '', null, '--w3dpv-ctl-bg' ),
					'ctl_color' => array( 'color', '#273f62', 'Цвет текста и значков', '', null, '--w3dpv-ctl-color' ),
					'ctl_border' => array( 'color', '#dfe5ec', 'Цвет рамки', '', null, '--w3dpv-ctl-border' ),
					'ctl_hover_bg' => array( 'color', '#edf2f8', 'Фон при наведении', '', null, '--w3dpv-ctl-hover-bg' ),
					'ctl_hover_color' => array( 'color', '#1b2e4a', 'Текст при наведении', '', null, '--w3dpv-ctl-hover-color' ),
					'ctl_active_bg' => array( 'color', '#eaf0f9', 'Фон включённой кнопки', 'Вращение, открытая палитра, выбранная вкладка.', null, '--w3dpv-ctl-active-bg' ),
					'ctl_active_border' => array( 'color', '#cbd8ec', 'Рамка включённой кнопки', '', null, '--w3dpv-ctl-active-border' ),
					'close_bg' => array( 'color', '#f3f5f8', 'Фон кнопки закрытия', '', null, '--w3dpv-close-bg' ),
					'focus_color' => array( 'color', '#437ad9', 'Цвет рамки фокуса с клавиатуры', '', null, '--w3dpv-focus' ),
					'ctl_radius' => array( 'int', 9, 'Скругление кнопок, px', '', array( 0, 24 ), '--w3dpv-ctl-radius' ),
					'ctl_size' => array( 'int', 44, 'Высота кнопок, px', 'На сенсорных экранах не меньше 44 px.', array( 36, 60 ), '--w3dpv-ctl-size' ),
					'ctl_font_size' => array( 'int', 13, 'Размер текста, px', '', array( 11, 18 ), '--w3dpv-ctl-font-size' ),
					'show_palette' => array( 'bool', 'yes', 'Показывать палитру цветов' ),
					'show_fullscreen' => array( 'bool', 'yes', 'Показывать кнопку полного экрана' ),
					'show_help' => array( 'bool', 'yes', 'Показывать подсказку под кнопками' ),
				),
			),
			'switcher' => array(
				'title' => 'Переключатель моделей',
				'fields' => array(
					'sw_position' => array( 'select', 'bottom', 'Расположение', 'Внизу удобнее нажимать большим пальцем на телефоне.', array( 'bottom' => 'Внизу области модели', 'top' => 'Вверху области модели' ) ),
					'sw_bg' => array( 'color', '#ffffff', 'Фон панели' ),
					'sw_color' => array( 'color', '#273f62', 'Цвет текста', '', null, '--w3dpv-sw-color' ),
					'sw_active_bg' => array( 'color', '#273f62', 'Фон выбранной модели', '', null, '--w3dpv-sw-active-bg' ),
					'sw_active_color' => array( 'color', '#ffffff', 'Текст выбранной модели', '', null, '--w3dpv-sw-active-color' ),
					'sw_radius' => array( 'int', 12, 'Скругление панели, px', '', array( 0, 24 ), '--w3dpv-sw-radius' ),
				),
			),
			'extras' => array(
				'title' => 'Палитра и значок 360°',
				'fields' => array(
					'pal_bg' => array( 'color', '#ffffff', 'Фон палитры', '', null, '--w3dpv-pal-bg' ),
					'pal_color' => array( 'color', '#273f62', 'Текст палитры', '', null, '--w3dpv-pal-color' ),
					'show_badge' => array( 'bool', 'yes', 'Показывать значок' ),
					'badge_text' => array( 'text', '360°', 'Текст значка' ),
					'badge_bg' => array( 'color', '#ffffff', 'Фон значка' ),
					'badge_color' => array( 'color', '#536784', 'Цвет текста значка', '', null, '--w3dpv-badge-color' ),
				),
			),
		);
	}

	/** Flat list: key => array( type, default, label, description, options|range, css variable ). */
	public static function definitions() {
		$all = array();
		foreach ( self::fields() as $group ) {
			foreach ( $group['fields'] as $key => $field ) {
				$all[$key] = $field + array( '', '', '', '', null, null );
			}
		}
		return $all;
	}

	public static function defaults() {
		return array_map( static function ( $field ) {
			return $field[1];
		}, self::definitions() );
	}

	public static function get( $key = null ) {
		if ( null === self::$values ) {
			$stored = get_option( self::OPTION, array() );
			self::$values = self::sanitize( is_array( $stored ) ? $stored : array() );
		}
		return null === $key ? self::$values : ( self::$values[$key] ?? null );
	}

	public static function sanitize( $input ) {
		$input = is_array( $input ) ? $input : array();
		$clean = array();
		foreach ( self::definitions() as $key => $field ) {
			list( $type, $default ) = $field;
			$value = isset( $input[$key] ) && is_scalar( $input[$key] ) ? (string) $input[$key] : null;
			if ( 'bool' === $type ) {
				// An unchecked box is missing from the form; a stored array always carries every key.
				$clean[$key] = null === $value ? ( isset( $input['_submitted'] ) ? 'no' : $default ) : ( 'yes' === $value ? 'yes' : 'no' );
			} elseif ( 'color' === $type ) {
				$color = strtolower( (string) sanitize_hex_color( (string) $value ) );
				// #abc is valid CSS, but rgba() and <input type="color"> need all six digits.
				$clean[$key] = 4 === strlen( $color ) ? '#' . $color[1] . $color[1] . $color[2] . $color[2] . $color[3] . $color[3] : ( $color ?: $default );
			} elseif ( 'int' === $type ) {
				$clean[$key] = null === $value || ! is_numeric( $value ) ? $default : max( $field[4][0], min( $field[4][1], (int) round( (float) $value ) ) );
			} elseif ( 'select' === $type ) {
				$clean[$key] = null !== $value && isset( $field[4][$value] ) ? $value : $default;
			} else {
				$clean[$key] = null === $value ? $default : mb_substr( sanitize_text_field( $value ), 0, 60 );
			}
		}
		return $clean;
	}

	private static function rgba( $hex, $alpha ) {
		$hex = ltrim( $hex, '#' );
		return sprintf( 'rgba(%d,%d,%d,%s)', hexdec( substr( $hex, 0, 2 ) ), hexdec( substr( $hex, 2, 2 ) ), hexdec( substr( $hex, 4, 2 ) ), rtrim( rtrim( number_format( $alpha, 2, '.', '' ), '0' ), '.' ) );
	}

	/** Custom properties and the few rules that cannot be expressed as variables. Values are sanitized. */
	public static function css( $values = null ) {
		$values = $values ?: self::get();
		$vars = array();
		foreach ( self::definitions() as $key => $field ) {
			if ( $field[5] ) {
				$vars[] = $field[5] . ':' . $values[$key] . ( 'int' === $field[0] ? 'px' : '' );
			}
		}
		if ( 'yes' !== $values['btn_fill'] ) {
			$vars[] = '--w3dpv-btn-bg:transparent';
		}
		$vars[] = '--w3dpv-btn-shadow:' . ( 'yes' === $values['btn_shadow'] ? '0 4px 12px rgba(39,63,98,.12)' : 'none' );
		$vars[] = '--w3dpv-status-bg:' . self::rgba( $values['status_bg'], 0.96 );
		$vars[] = '--w3dpv-sw-bg:' . self::rgba( $values['sw_bg'], 0.94 );
		$vars[] = '--w3dpv-badge-bg:' . self::rgba( $values['badge_bg'], 0.88 );
		$backdrop = self::rgba( $values['backdrop_color'], $values['backdrop_opacity'] / 100 );
		$css = ':root{' . implode( ';', $vars ) . '}';
		// ::backdrop does not inherit custom properties in older browsers.
		$css .= '.w3dpv-dialog::backdrop{background:' . $backdrop . ';-webkit-backdrop-filter:blur(' . $values['backdrop_blur'] . 'px);backdrop-filter:blur(' . $values['backdrop_blur'] . 'px)}.w3dpv-fallback-backdrop{background:' . $backdrop . '}';
		if ( 'inherit' === $values['btn_font'] ) {
			$css .= '.w3dpv-button-wrap .w3dpv-trigger{font-family:inherit!important}';
		}
		if ( 'inherit' === $values['dlg_font'] ) {
			$css .= '.w3dpv-dialog.w3dpv-dialog,.w3dpv-dialog.w3dpv-dialog *{font-family:inherit!important}';
		}
		return $css;
	}

	/** Texts and visibility of window parts, read by bootstrap.js when it builds the window. */
	public static function ui( $values = null ) {
		$values = $values ?: self::get();
		return array(
			'eyebrow' => $values['dlg_eyebrow'],
			'badge' => 'yes' === $values['show_badge'] ? $values['badge_text'] : '',
			'palette' => 'yes' === $values['show_palette'],
			'fullscreen' => 'yes' === $values['show_fullscreen'],
			'help' => 'yes' === $values['show_help'],
			'switcher' => $values['sw_position'],
		);
	}

	public static function menu() {
		add_submenu_page( 'woocommerce', '3D-просмотр', '3D-просмотр', 'manage_woocommerce', self::PAGE, array( __CLASS__, 'page' ) );
	}

	public static function register() {
		register_setting( self::GROUP, self::OPTION, array( 'type' => 'array', 'sanitize_callback' => array( __CLASS__, 'sanitize' ), 'default' => self::defaults() ) );
	}

	public static function url( $tab = 'style', $args = array() ) {
		return add_query_arg( array_merge( array( 'page' => self::PAGE, 'tab' => $tab ), $args ), admin_url( 'admin.php' ) );
	}

	public static function admin_assets( $hook ) {
		if ( 'woocommerce_page_' . self::PAGE !== $hook ) {
			return;
		}
		W3DPV_Plugin::instance()->assets();
		wp_enqueue_style( 'w3dpv-admin', W3DPV_URL . 'assets/css/admin.css', array(), W3DPV_VERSION );
		wp_enqueue_script( 'w3dpv-settings', W3DPV_URL . 'assets/js/settings.js', array( 'w3dpv-front' ), W3DPV_VERSION, true );
		$demo = array();
		foreach ( array( 'glb' => 'GLB', 'fbx' => 'FBX', 'obj' => 'OBJ' ) as $format => $label ) {
			$path = W3DPV_PATH . 'examples/demo-chair.' . $format;
			if ( is_file( $path ) ) {
				$demo[] = array( 'model' => array( 'id' => 0, 'url' => W3DPV_URL . 'examples/demo-chair.' . $format . '?ver=' . W3DPV_VERSION, 'format' => $format, 'bytes' => filesize( $path ), 'name' => 'demo-chair.' . $format ), 'mobileModel' => null, 'label' => 'Кресло ' . $label );
			}
		}
		$spec = array();
		foreach ( self::definitions() as $key => $field ) {
			$spec[$key] = array( 'type' => $field[0], 'var' => $field[5] );
		}
		wp_add_inline_script( 'w3dpv-settings', 'window.W3DPVSettings = ' . wp_json_encode( array( 'spec' => $spec, 'demo' => $demo, 'defaults' => self::defaults() ) ) . ';', 'before' );
	}

	public static function page() {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			return;
		}
		$tab = isset( $_GET['tab'] ) && 'cache' === $_GET['tab'] ? 'cache' : 'style';
		?>
		<div class="wrap w3dpv-settings-page">
			<h1>3D-просмотр товаров</h1>
			<nav class="nav-tab-wrapper">
				<a href="<?php echo esc_url( self::url( 'style' ) ); ?>" class="nav-tab<?php echo 'style' === $tab ? ' nav-tab-active' : ''; ?>">Внешний вид</a>
				<a href="<?php echo esc_url( self::url( 'cache' ) ); ?>" class="nav-tab<?php echo 'cache' === $tab ? ' nav-tab-active' : ''; ?>">Кэш моделей</a>
			</nav>
			<?php 'cache' === $tab ? self::cache_tab() : self::style_tab(); ?>
		</div>
		<?php
	}

	private static function style_tab() {
		$values = self::get();
		settings_errors();
		?>
		<p class="w3dpv-settings-lead">Настройки применяются ко всем товарам. Цвет фона области модели задаётся в каждом товаре (вкладка «3D-модель»).</p>
		<form method="post" action="options.php" class="w3dpv-settings-form">
			<?php settings_fields( self::GROUP ); ?>
			<input type="hidden" name="<?php echo esc_attr( self::OPTION ); ?>[_submitted]" value="1">
			<div class="w3dpv-settings-preview" aria-label="Предпросмотр">
				<div class="w3dpv-settings-preview-button"><?php echo W3DPV_Plugin::instance()->button_markup( $values['btn_label'], 'null', 0, false, true ); // Escaped in button_markup(). ?></div>
				<button type="button" class="button button-secondary w3dpv-open-demo">Открыть окно просмотра с демо-моделями</button>
				<p class="description">Кнопка меняется сразу. Окно открывается с текущими, ещё не сохранёнными настройками и тремя демонстрационными моделями.</p>
			</div>
			<?php foreach ( self::fields() as $group_key => $group ) : ?>
				<details class="w3dpv-settings-group"<?php echo 'button' === $group_key ? ' open' : ''; ?>>
					<summary><?php echo esc_html( $group['title'] ); ?></summary>
					<table class="form-table" role="presentation"><tbody>
						<?php foreach ( $group['fields'] as $key => $field ) : self::field_row( $key, $field + array( '', '', '', '', null, null ), $values[$key] ); endforeach; ?>
					</tbody></table>
				</details>
			<?php endforeach; ?>
			<p class="submit">
				<?php submit_button( 'Сохранить настройки', 'primary', 'submit', false ); ?>
				<button type="button" class="button w3dpv-reset-defaults">Вернуть исходный вид</button>
			</p>
		</form>
		<?php
	}

	private static function field_row( $key, $field, $value ) {
		list( $type, $default, $label, $description, $options ) = $field;
		$name = self::OPTION . '[' . $key . ']';
		$id = 'w3dpv-' . str_replace( '_', '-', $key );
		?>
		<tr>
			<th scope="row"><label for="<?php echo esc_attr( $id ); ?>"><?php echo esc_html( $label ); ?></label></th>
			<td>
				<?php if ( 'bool' === $type ) : ?>
					<input type="checkbox" id="<?php echo esc_attr( $id ); ?>" name="<?php echo esc_attr( $name ); ?>" value="yes" data-setting="<?php echo esc_attr( $key ); ?>"<?php checked( 'yes', $value ); ?>>
				<?php elseif ( 'color' === $type ) : ?>
					<input type="color" id="<?php echo esc_attr( $id ); ?>" name="<?php echo esc_attr( $name ); ?>" value="<?php echo esc_attr( $value ); ?>" data-setting="<?php echo esc_attr( $key ); ?>">
					<code class="w3dpv-color-code"><?php echo esc_html( $value ); ?></code>
				<?php elseif ( 'int' === $type ) : ?>
					<input type="number" class="small-text" id="<?php echo esc_attr( $id ); ?>" name="<?php echo esc_attr( $name ); ?>" value="<?php echo esc_attr( $value ); ?>" min="<?php echo esc_attr( $options[0] ); ?>" max="<?php echo esc_attr( $options[1] ); ?>" step="1" data-setting="<?php echo esc_attr( $key ); ?>">
					<span class="description"><?php echo esc_html( $options[0] . '–' . $options[1] ); ?></span>
				<?php elseif ( 'select' === $type ) : ?>
					<select id="<?php echo esc_attr( $id ); ?>" name="<?php echo esc_attr( $name ); ?>" data-setting="<?php echo esc_attr( $key ); ?>">
						<?php foreach ( $options as $option => $text ) : ?>
							<option value="<?php echo esc_attr( $option ); ?>"<?php selected( (string) $option, (string) $value ); ?>><?php echo esc_html( $text ); ?></option>
						<?php endforeach; ?>
					</select>
				<?php else : ?>
					<input type="text" class="regular-text" id="<?php echo esc_attr( $id ); ?>" name="<?php echo esc_attr( $name ); ?>" value="<?php echo esc_attr( $value ); ?>" maxlength="60" data-setting="<?php echo esc_attr( $key ); ?>">
				<?php endif; ?>
				<?php if ( $description ) : ?><p class="description"><?php echo esc_html( $description ); ?></p><?php endif; ?>
			</td>
		</tr>
		<?php
	}

	private static function cache_tab() {
		$stats = W3DPV_Cache::stats();
		?>
		<?php if ( isset( $_GET['w3dpv_cleared'] ) ) : ?><div class="notice notice-success"><p>Очистка кэша завершена. Копии создадутся при следующем открытии страницы товара.</p></div><?php endif; ?>
		<p>Копии на сайте: <strong><?php echo esc_html( $stats['files'] ); ?></strong>; размер: <strong><?php echo esc_html( size_format( $stats['bytes'], 1 ) ); ?></strong>. Максимум 512 МиБ, затем удаляются самые старые копии.</p>
		<p>Автоматическая очистка — каждые 30 дней через WP-Cron. Следующая задача: <?php echo esc_html( $stats['next'] ? wp_date( 'd.m.Y H:i', $stats['next'] ) : 'не запланирована' ); ?>. При отключённом WP-Cron нужен системный cron; без посещений задача выполняется позже.</p>
		<p>Проверенные файлы повторно используются браузером до 30 дней при наличии доступного хранилища и HTTPS. Нехватка места или приватный режим не блокируют просмотр. Первый просмотр большой модели всё равно зависит от скорости сети; кэш не уменьшает файл.</p>
		<p>Очистка удаляет только копии плагина. Файлы медиатеки и привязки к товарам сохраняются. После ручной очистки обновите кэш страниц сайта, чтобы посетители получили новые адреса.</p>
		<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>"><input type="hidden" name="action" value="w3dpv_clear_cache"><?php wp_nonce_field( 'w3dpv_clear_cache' ); submit_button( 'Очистить кэш 3D-моделей' ); ?></form>
		<?php
	}

	public static function clear_cache() {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			wp_die( 'Недостаточно прав.', '', array( 'response' => 403 ) );
		}
		check_admin_referer( 'w3dpv_clear_cache' );
		if ( false === W3DPV_Cache::clear() ) {
			wp_die( 'Кэш сейчас используется. Повторите очистку через несколько секунд.' );
		}
		wp_safe_redirect( self::url( 'cache', array( 'w3dpv_cleared' => 1 ) ) );
		exit;
	}
}

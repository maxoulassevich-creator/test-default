<?php
/**
 * Settings and admin UI.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class ISUX_Settings {
	const OPTION = 'isux_options';

	/** @var ISUX_Settings|null */
	private static $instance = null;

	/** @var array<string,mixed>|null */
	private $options = null;

	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	private function __construct() {
		add_action( 'admin_init', array( $this, 'register' ) );
		add_action( 'admin_menu', array( $this, 'menu' ) );
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue_admin_assets' ) );
		add_filter( 'plugin_action_links_' . plugin_basename( ISUX_FILE ), array( $this, 'action_links' ) );
	}

	public static function defaults() {
		return array(
			'enabled'                    => 1,
			'initial_loader'             => 1,
			'transition_loader'          => 1,
			'logged_in'                  => 1,
			'min_duration'               => 0,
			'max_duration'               => 15000,
			'reveal_event'               => 'load',
			'lock_scroll'                => 1,
			'scope_selector'             => 'body',
			'scan_buffer'                => 120,
			'max_shapes'                 => 400,
			'respect_radius'             => 1,
			'wait_fonts'                 => 1,
			'theme_mode'                 => 'auto',
			'animation'                  => 'shimmer',
			'shimmer_speed'              => 1450,
			'radius'                     => 8,
			'backdrop'                   => '',
			'progress_bar'               => 1,
			'progress_height'            => 3,
			'progress_color'             => '#6c5ce7',
			'forced_selectors'           => '[data-isux-skeleton]',
			'preserve_selectors'         => '[data-isux-preserve], .isux-preserve, .elementor-background-overlay, .elementor-shape, .elementor-shape-top, .elementor-shape-bottom, .wp-block-cover__background, .wp-block-cover__image-background',
			'exclude_skeleton_selectors' => 'script, style, noscript, template, link, meta, [hidden], .screen-reader-text, .sr-only, .skip-link, #wpadminbar, #isux-overlay',
			'navigation_mode'            => 'native',
			'content_selector'           => 'main, #primary, .site-main, #content',
			'ajax_timeout'               => 12000,
			'load_new_assets'            => 1,
			'update_head'                => 1,
			'run_inline_scripts'         => 0,
			'focus_content'              => 1,
			'scroll_mode'                => 'top',
			'network_aware'              => 1,
			'pause_hidden'               => 1,
			'woocommerce_adapter'        => 1,
			'elementor_adapter'          => 1,
			'exclude_urls'               => "/wp-admin/\n/wp-login.php\n/wp-json/\n/cart/\n/checkout/\n/my-account/\n/order-pay/\n/order-received/\n?add-to-cart=",
			'exclude_link_selectors'     => '.no-skeleton, [data-isux-no-nav], .add_to_cart_button, .ajax_add_to_cart, a[target="_blank"], a[download]',
			'custom_css'                 => '',
			'debug'                      => 0,
		);
	}

	public function get_all() {
		if ( null === $this->options ) {
			$stored        = get_option( self::OPTION, array() );
			$stored        = is_array( $stored ) ? $stored : array();
			$this->options = wp_parse_args( $stored, self::defaults() );
		}
		return $this->options;
	}

	public function get( $key, $fallback = null ) {
		$options = $this->get_all();
		return array_key_exists( $key, $options ) ? $options[ $key ] : $fallback;
	}

	public function register() {
		register_setting(
			'isux_settings_group',
			self::OPTION,
			array(
				'type'              => 'array',
				'sanitize_callback' => array( $this, 'sanitize' ),
				'default'           => self::defaults(),
			)
		);
	}

	public function sanitize( $input ) {
		$defaults = self::defaults();
		$input    = is_array( $input ) ? $input : array();
		$out      = $defaults;

		$booleans = array(
			'enabled', 'initial_loader', 'transition_loader', 'logged_in', 'lock_scroll',
			'respect_radius', 'wait_fonts', 'progress_bar',
			'load_new_assets', 'update_head', 'run_inline_scripts', 'focus_content',
			'network_aware', 'pause_hidden', 'woocommerce_adapter', 'elementor_adapter', 'debug',
		);
		foreach ( $booleans as $key ) {
			$out[ $key ] = ! empty( $input[ $key ] ) ? 1 : 0;
		}

		$out['min_duration']    = $this->clamp_int( $input, 'min_duration', 0, 60000, $defaults['min_duration'] );
		$out['max_duration']    = $this->clamp_int( $input, 'max_duration', 1000, 120000, $defaults['max_duration'] );
		$out['scan_buffer']     = $this->clamp_int( $input, 'scan_buffer', 0, 2000, $defaults['scan_buffer'] );
		$out['max_shapes']      = $this->clamp_int( $input, 'max_shapes', 50, 1500, $defaults['max_shapes'] );
		$out['shimmer_speed']   = $this->clamp_int( $input, 'shimmer_speed', 500, 5000, $defaults['shimmer_speed'] );
		$out['radius']          = $this->clamp_int( $input, 'radius', 0, 60, $defaults['radius'] );
		$out['progress_height'] = $this->clamp_int( $input, 'progress_height', 1, 8, $defaults['progress_height'] );
		$out['ajax_timeout']    = $this->clamp_int( $input, 'ajax_timeout', 3000, 30000, $defaults['ajax_timeout'] );

		$out['reveal_event']    = $this->enum( $input, 'reveal_event', array( 'dom', 'load' ), $defaults['reveal_event'] );
		$out['theme_mode']      = $this->enum( $input, 'theme_mode', array( 'auto', 'light', 'dark' ), $defaults['theme_mode'] );
		$out['animation']       = $this->enum( $input, 'animation', array( 'shimmer', 'pulse', 'none' ), $defaults['animation'] );
		$out['navigation_mode'] = $this->enum( $input, 'navigation_mode', array( 'native', 'ajax' ), $defaults['navigation_mode'] );
		$out['scroll_mode']     = $this->enum( $input, 'scroll_mode', array( 'top', 'preserve', 'smooth' ), $defaults['scroll_mode'] );

		$color                   = isset( $input['progress_color'] ) ? sanitize_hex_color( $input['progress_color'] ) : '';
		$out['progress_color']   = $color ? $color : $defaults['progress_color'];

		// Empty means "sample the page's own background", which is the default.
		$backdrop        = isset( $input['backdrop'] ) ? sanitize_hex_color( $input['backdrop'] ) : '';
		$out['backdrop'] = $backdrop ? $backdrop : '';

		$text_fields = array( 'scope_selector', 'content_selector' );
		foreach ( $text_fields as $key ) {
			$out[ $key ] = isset( $input[ $key ] ) ? sanitize_text_field( $input[ $key ] ) : $defaults[ $key ];
		}

		$textareas = array(
			'forced_selectors', 'preserve_selectors', 'exclude_skeleton_selectors',
			'exclude_urls', 'exclude_link_selectors',
		);
		foreach ( $textareas as $key ) {
			$out[ $key ] = isset( $input[ $key ] ) ? sanitize_textarea_field( $input[ $key ] ) : $defaults[ $key ];
		}

		$out['custom_css'] = isset( $input['custom_css'] ) ? wp_strip_all_tags( $input['custom_css'], false ) : '';

		if ( $out['max_duration'] < $out['min_duration'] + 500 ) {
			$out['max_duration'] = min( 120000, $out['min_duration'] + 500 );
		}

		$this->options = $out;
		return $out;
	}

	private function clamp_int( $input, $key, $min, $max, $default ) {
		$value = isset( $input[ $key ] ) ? absint( $input[ $key ] ) : $default;
		return max( $min, min( $max, $value ) );
	}

	private function enum( $input, $key, $allowed, $default ) {
		$value = isset( $input[ $key ] ) ? sanitize_key( $input[ $key ] ) : $default;
		return in_array( $value, $allowed, true ) ? $value : $default;
	}

	public function menu() {
		add_options_page(
			__( 'Instant Skeleton UX', 'instant-skeleton-ux' ),
			__( 'Skeleton UX', 'instant-skeleton-ux' ),
			'manage_options',
			'instant-skeleton-ux',
			array( $this, 'render_page' )
		);
	}

	public function enqueue_admin_assets( $hook ) {
		if ( 'settings_page_instant-skeleton-ux' !== $hook ) {
			return;
		}
		wp_enqueue_style( 'isux-admin', ISUX_URL . 'assets/css/admin.css', array(), ISUX_VERSION );
		wp_enqueue_script( 'isux-admin', ISUX_URL . 'assets/js/admin.js', array(), ISUX_VERSION, true );
	}

	public function action_links( $links ) {
		$url = admin_url( 'options-general.php?page=instant-skeleton-ux' );
		array_unshift( $links, '<a href="' . esc_url( $url ) . '">' . esc_html__( 'Настройки', 'instant-skeleton-ux' ) . '</a>' );
		return $links;
	}

	public function render_page() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		$o = $this->get_all();
		?>
		<div class="wrap isux-admin-wrap">
			<div class="isux-admin-hero">
				<div>
					<h1>Instant Skeleton UX</h1>
					<p>Skeleton строится по реальному DOM и вычисленной геометрии страницы. Фоны секций, фоновые изображения, декоративные слои и псевдоэлементы остаются настоящими.</p>
				</div>
				<span class="isux-version">v<?php echo esc_html( ISUX_VERSION ); ?></span>
			</div>

			<?php settings_errors(); ?>

			<div class="isux-layout">
				<form method="post" action="options.php" class="isux-settings-form">
					<?php settings_fields( 'isux_settings_group' ); ?>
					<nav class="isux-tabs" aria-label="Разделы настроек">
						<button type="button" class="is-active" data-tab="general">Основное</button>
						<button type="button" data-tab="mirror">Точный макет</button>
						<button type="button" data-tab="visual">Цвет и анимация</button>
						<button type="button" data-tab="navigation">Навигация</button>
						<button type="button" data-tab="compat">Совместимость</button>
						<button type="button" data-tab="advanced">Расширенное</button>
					</nav>

					<section class="isux-panel is-active" data-panel="general">
						<h2>Основное поведение</h2>
						<?php $this->checkbox( 'enabled', 'Включить плагин', 'Главный переключатель на фронтенде.', $o ); ?>
						<?php $this->checkbox( 'initial_loader', 'Skeleton при первом открытии', 'После построения DOM плагин накладывает точные заглушки поверх реальных элементов.', $o ); ?>
						<?php $this->checkbox( 'transition_loader', 'Skeleton при переходах', 'При обычной навигации показывает снимок текущей страницы; на новой странице строится уже её точный макет.', $o ); ?>
						<?php $this->checkbox( 'logged_in', 'Работать для авторизованных пользователей', 'Полезно для проверки из-под администратора.', $o ); ?>
						<div class="isux-grid-2">
							<?php $this->number( 'min_duration', 'Минимальное время показа, мс', 0, 60000, 100, $o, 'Skeleton не исчезнет раньше этого времени, даже если страница уже полностью загрузилась.' ); ?>
							<?php $this->number( 'max_duration', 'Аварийный предел, мс', 1000, 120000, 500, $o, 'После этого срока плагин обязательно откроет страницу, даже если сторонний скрипт завис.' ); ?>
						</div>
						<?php $this->select( 'reveal_event', 'Когда считать страницу готовой', array( 'dom' => 'DOM построен', 'load' => 'Загружены изображения, стили и остальные ресурсы' ), $o, 'Минимальное время всё равно соблюдается.' ); ?>
						<?php $this->checkbox( 'wait_fonts', 'Дождаться веб-шрифтов', 'Перед открытием учитывается окончательная ширина и переносы текста.', $o ); ?>
						<?php $this->checkbox( 'lock_scroll', 'Блокировать прокрутку во время показа', 'Не даёт пользователю уйти за пределы уже измеренной области.', $o ); ?>
					</section>

					<section class="isux-panel" data-panel="mirror">
						<h2>Точное повторение страницы</h2>
						<?php $this->text( 'scope_selector', 'Область сканирования', $o, 'Обычно body. Можно ограничить до main или #page.' ); ?>
						<div class="isux-grid-2">
							<?php $this->number( 'scan_buffer', 'Запас за границами экрана, px', 0, 2000, 20, $o, 'Сканируются элементы чуть выше и ниже видимой области.' ); ?>
							<?php $this->number( 'max_shapes', 'Максимум заглушек', 50, 1500, 50, $o, 'Защита от перегрузки на очень сложных страницах.' ); ?>
						</div>
						<?php $this->checkbox( 'respect_radius', 'Повторять реальные скругления', 'Для изображений, кнопок, полей и карточек используется вычисленный border-radius.', $o ); ?>
						<?php $this->textarea( 'forced_selectors', 'Принудительно делать skeleton', $o, 'CSS-селекторы. Для отдельного элемента можно использовать data-isux-skeleton="box", "text" или "circle".' ); ?>
						<?php $this->textarea( 'preserve_selectors', 'Всегда оставлять настоящими', $o, 'Фоны, декор, логотипы или другие элементы, которые нельзя заменять. Поддерживается data-isux-preserve.' ); ?>
						<?php $this->textarea( 'exclude_skeleton_selectors', 'Полностью игнорировать', $o, 'Технические и невидимые элементы, которые не участвуют в построении skeleton.' ); ?>
						<div class="isux-notice"><strong>Как строится skeleton в 2.1.</strong> Слой непрозрачный и залит собственным фоном страницы, поэтому реальный контент не проступает между заглушками. Обход идёт сверху вниз и останавливается, как только ветка описана: медиа и элементы управления — прямоугольником, текст — полосами по строкам, карточка — своей рамкой. Элементы с opacity:0 больше не пропускаются: так работают анимации появления, и раньше они опустошали skeleton.</div>
					</section>

					<section class="isux-panel" data-panel="visual">
						<h2>Цвет и анимация</h2>
						<?php $this->select( 'theme_mode', 'Режим цвета', array( 'auto' => 'Автоматически по фону страницы', 'light' => 'Принудительно светлые заглушки', 'dark' => 'Принудительно тёмные заглушки' ), $o, 'Палитра считается один раз на страницу и выводится из её фона. В 2.0 цвет брался с самого элемента, из-за чего кнопка с бирюзовой заливкой давала бирюзовую заглушку.' ); ?>
						<?php $this->select( 'animation', 'Анимация', array( 'shimmer' => 'Волна градиента', 'pulse' => 'Мягкая пульсация', 'none' => 'Без движения' ), $o, 'prefers-reduced-motion и экономия трафика отключают движение автоматически.' ); ?>
						<div class="isux-grid-2">
							<?php $this->number( 'shimmer_speed', 'Скорость, мс', 500, 5000, 50, $o, '' ); ?>
							<?php $this->number( 'radius', 'Запасное скругление, px', 0, 60, 1, $o, 'Используется, когда реальное скругление определить нельзя.' ); ?>
						</div>
						<?php $this->text( 'backdrop', 'Фон слоя (HEX)', $o, 'Пусто — брать собственный фон страницы. Задавайте цвет, только если фон body прозрачный или задан картинкой.' ); ?>
						<?php $this->checkbox( 'progress_bar', 'Индикатор прогресса сверху', 'Не влияет на геометрию страницы.', $o ); ?>
						<div class="isux-grid-2"><?php $this->color( 'progress_color', 'Цвет индикатора', $o ); ?><?php $this->number( 'progress_height', 'Толщина, px', 1, 8, 1, $o, '' ); ?></div>
					</section>

					<section class="isux-panel" data-panel="navigation">
						<h2>Переходы между страницами</h2>
						<?php $this->select( 'navigation_mode', 'Режим переходов', array( 'native' => 'Надёжный: обычный переход', 'ajax' => 'Частичная AJAX-навигация' ), $o, 'Для Elementor, WooCommerce и кастомных скриптов сначала проверьте AJAX на тестовой копии.' ); ?>
						<?php $this->text( 'content_selector', 'Основной контейнер для AJAX', $o, 'Берётся первый найденный селектор.' ); ?>
						<div class="isux-grid-2"><?php $this->number( 'ajax_timeout', 'Тайм-аут, мс', 3000, 30000, 100, $o, '' ); ?><?php $this->select( 'scroll_mode', 'Прокрутка', array( 'top' => 'Наверх', 'smooth' => 'Плавно наверх', 'preserve' => 'Сохранять позицию' ), $o, '' ); ?></div>
						<?php $this->checkbox( 'load_new_assets', 'Подключать новые CSS/JS', 'Добавляет ресурсы, которых не было на предыдущей странице.', $o ); ?>
						<?php $this->checkbox( 'update_head', 'Обновлять title и мета-теги', 'Актуализирует canonical, description, robots, Open Graph и Twitter.', $o ); ?>
						<?php $this->checkbox( 'run_inline_scripts', 'Повторно запускать inline-скрипты', 'Рискованный режим. Включайте только при необходимости.', $o ); ?>
						<?php $this->checkbox( 'focus_content', 'Переносить клавиатурный фокус', 'Полезно для доступности.', $o ); ?>
					</section>

					<section class="isux-panel" data-panel="compat">
						<h2>Совместимость и исключения</h2>
						<?php $this->checkbox( 'woocommerce_adapter', 'Адаптер WooCommerce', 'Повторно инициализирует вариации, галерею и фрагменты корзины после AJAX-перехода.', $o ); ?>
						<?php $this->checkbox( 'elementor_adapter', 'Адаптер Elementor', 'Запускает обработчики виджетов в новом контейнере.', $o ); ?>
						<?php $this->textarea( 'exclude_urls', 'Не запускать на URL', $o, 'Один фрагмент адреса на строку.' ); ?>
						<?php $this->textarea( 'exclude_link_selectors', 'Не перехватывать ссылки', $o, 'CSS-селекторы через запятую. Для отдельной ссылки: data-isux-no-nav.' ); ?>
					</section>

					<section class="isux-panel" data-panel="advanced">
						<h2>Расширенное</h2>
						<?php $this->checkbox( 'network_aware', 'Учитывать Save-Data и слабое соединение', 'На 2G отключается shimmer, но точные заглушки остаются.', $o ); ?>
						<?php $this->checkbox( 'pause_hidden', 'Ставить анимацию на паузу в фоновой вкладке', 'Снижает нагрузку.', $o ); ?>
						<?php $this->checkbox( 'debug', 'Отладка и счётчик элементов', 'В консоли появляются сообщения [ISUX], а в предпросмотре — количество построенных заглушек.', $o ); ?>
						<?php $this->textarea( 'custom_css', 'Дополнительный CSS', $o, 'Используйте .isux-shape и .isux-overlay.' ); ?>
						<div class="isux-code-help">
							<code>data-isux-preserve</code>
							<code>data-isux-skeleton="box|text|circle"</code>
							<code>window.InstantSkeletonUX.rebuild()</code>
							<code>window.InstantSkeletonUX.show('manual')</code>
							<code>window.InstantSkeletonUX.hide('manual')</code>
						</div>
					</section>

					<div class="isux-savebar">
						<?php submit_button( 'Сохранить настройки', 'primary', 'submit', false ); ?>
						<a class="button" href="<?php echo esc_url( add_query_arg( 'isux_preview', '1', home_url( '/' ) ) ); ?>" target="_blank" rel="noopener">Открыть точный предпросмотр</a>
					</div>
				</form>

				<aside class="isux-preview-card">
					<div class="isux-preview-head"><strong>Как теперь работает skeleton</strong></div>
					<div class="isux-feature-list">
						<div><b>1</b><span>Браузер строит реальный макет страницы, но не показывает контент до первого точного снимка.</span></div>
						<div><b>2</b><span>Плагин измеряет строки текста, изображения, кнопки, поля и иконки через getClientRects().</span></div>
						<div><b>3</b><span>Поверх каждого элемента создаётся отдельная заглушка с теми же координатами и скруглением.</span></div>
						<div><b>4</b><span>Фон секции, background-image, градиенты, overlay и декоративные псевдоэлементы не заменяются.</span></div>
						<div><b>5</b><span>После заданного минимального времени слой удаляется; исходный DOM не перестраивается.</span></div>
					</div>
					<p class="description">Для проверки используйте кнопку «Открыть точный предпросмотр». Предпросмотр строится именно на вашем сайте, а не по условному шаблону.</p>
				</aside>
			</div>
		</div>
		<?php
	}

	private function field_name( $key ) {
		return self::OPTION . '[' . $key . ']';
	}

	private function checkbox( $key, $label, $description, $o ) {
		?>
		<label class="isux-toggle-row"><span class="isux-toggle"><input type="checkbox" name="<?php echo esc_attr( $this->field_name( $key ) ); ?>" value="1" <?php checked( ! empty( $o[ $key ] ) ); ?>><span></span></span><span><strong><?php echo esc_html( $label ); ?></strong><?php if ( $description ) : ?><small><?php echo esc_html( $description ); ?></small><?php endif; ?></span></label>
		<?php
	}

	private function number( $key, $label, $min, $max, $step, $o, $description ) {
		?>
		<label class="isux-field"><span><?php echo esc_html( $label ); ?></span><input type="number" name="<?php echo esc_attr( $this->field_name( $key ) ); ?>" value="<?php echo esc_attr( $o[ $key ] ); ?>" min="<?php echo esc_attr( $min ); ?>" max="<?php echo esc_attr( $max ); ?>" step="<?php echo esc_attr( $step ); ?>"><?php if ( $description ) : ?><small><?php echo esc_html( $description ); ?></small><?php endif; ?></label>
		<?php
	}

	private function select( $key, $label, $choices, $o, $description ) {
		?>
		<label class="isux-field"><span><?php echo esc_html( $label ); ?></span><select name="<?php echo esc_attr( $this->field_name( $key ) ); ?>"><?php foreach ( $choices as $value => $text ) : ?><option value="<?php echo esc_attr( $value ); ?>" <?php selected( $o[ $key ], $value ); ?>><?php echo esc_html( $text ); ?></option><?php endforeach; ?></select><?php if ( $description ) : ?><small><?php echo esc_html( $description ); ?></small><?php endif; ?></label>
		<?php
	}

	private function color( $key, $label, $o ) {
		?>
		<label class="isux-field isux-color-field"><span><?php echo esc_html( $label ); ?></span><input type="color" name="<?php echo esc_attr( $this->field_name( $key ) ); ?>" value="<?php echo esc_attr( $o[ $key ] ); ?>"></label>
		<?php
	}

	private function text( $key, $label, $o, $description ) {
		?>
		<label class="isux-field"><span><?php echo esc_html( $label ); ?></span><input type="text" class="regular-text" name="<?php echo esc_attr( $this->field_name( $key ) ); ?>" value="<?php echo esc_attr( $o[ $key ] ); ?>"><?php if ( $description ) : ?><small><?php echo esc_html( $description ); ?></small><?php endif; ?></label>
		<?php
	}

	private function textarea( $key, $label, $o, $description ) {
		?>
		<label class="isux-field"><span><?php echo esc_html( $label ); ?></span><textarea name="<?php echo esc_attr( $this->field_name( $key ) ); ?>" rows="6" class="large-text code"><?php echo esc_textarea( $o[ $key ] ); ?></textarea><?php if ( $description ) : ?><small><?php echo esc_html( $description ); ?></small><?php endif; ?></label>
		<?php
	}
}

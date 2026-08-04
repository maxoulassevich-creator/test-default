<?php
/**
 * Front-end runtime.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class ISUX_Plugin {
	/** @var ISUX_Plugin|null */
	private static $instance = null;

	/** @var ISUX_Settings */
	private $settings;

	/** @var bool|null */
	private $should_run = null;

	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	public static function activate() {
		$stored = get_option( ISUX_Settings::OPTION, null );
		if ( ! is_array( $stored ) ) {
			add_option( ISUX_Settings::OPTION, ISUX_Settings::defaults(), '', false );
		} else {
			update_option( ISUX_Settings::OPTION, wp_parse_args( $stored, ISUX_Settings::defaults() ), false );
		}
	}

	private function __construct() {
		$this->settings = ISUX_Settings::instance();
		add_action( 'wp_enqueue_scripts', array( $this, 'enqueue' ), 20 );
		add_action( 'wp_head', array( $this, 'print_head_bootstrap' ), 1 );
		add_action( 'wp_body_open', array( $this, 'print_overlay' ), 0 );
		add_filter( 'body_class', array( $this, 'body_classes' ) );
		add_action( 'admin_bar_menu', array( $this, 'admin_bar' ), 100 );
	}

	public function body_classes( $classes ) {
		if ( $this->should_run() ) {
			$classes[] = 'isux-runtime-enabled';
		}
		return $classes;
	}

	public function admin_bar( $bar ) {
		if ( ! is_admin_bar_showing() || ! current_user_can( 'manage_options' ) || is_admin() ) {
			return;
		}
		$bar->add_node(
			array(
				'id'    => 'isux-settings',
				'title' => 'Skeleton UX',
				'href'  => admin_url( 'options-general.php?page=instant-skeleton-ux' ),
				'meta'  => array( 'title' => 'Настройки Instant Skeleton UX' ),
			)
		);
	}

	private function should_run() {
		if ( null !== $this->should_run ) {
			return $this->should_run;
		}

		$force_preview = isset( $_GET['isux_preview'] ) && current_user_can( 'manage_options' ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$force_off     = isset( $_GET['isux_off'] ) && current_user_can( 'manage_options' ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended

		if ( $force_off || ( ! $force_preview && ! $this->settings->get( 'enabled' ) ) ) {
			$this->should_run = false;
			return false;
		}

		if ( is_admin() || wp_doing_ajax() || ( function_exists( 'wp_is_json_request' ) && wp_is_json_request() ) ) {
			$this->should_run = false;
			return false;
		}

		if ( is_feed() || is_trackback() || is_robots() || is_favicon() ) {
			$this->should_run = false;
			return false;
		}

		if ( function_exists( 'is_amp_endpoint' ) && is_amp_endpoint() ) {
			$this->should_run = false;
			return false;
		}

		if ( is_user_logged_in() && ! $force_preview && ! $this->settings->get( 'logged_in' ) ) {
			$this->should_run = false;
			return false;
		}

		$request = isset( $_SERVER['REQUEST_URI'] ) ? wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
		if ( ! $force_preview && $this->matches_excluded_url( $request ) ) {
			$this->should_run = false;
			return false;
		}

		$this->should_run = true;
		return true;
	}

	private function matches_excluded_url( $url ) {
		foreach ( $this->lines( (string) $this->settings->get( 'exclude_urls', '' ) ) as $pattern ) {
			if ( false !== strpos( $url, $pattern ) ) {
				return true;
			}
		}
		return false;
	}

	public function enqueue() {
		if ( ! $this->should_run() ) {
			return;
		}

		wp_enqueue_script(
			'isux-frontend',
			ISUX_URL . 'assets/js/frontend.js',
			array(),
			ISUX_VERSION,
			false
		);

		if ( version_compare( get_bloginfo( 'version' ), '6.3', '>=' ) ) {
			wp_script_add_data( 'isux-frontend', 'strategy', 'defer' );
		}
	}

	public function print_head_bootstrap() {
		if ( ! $this->should_run() ) {
			return;
		}

		$options = $this->settings->get_all();
		$preview = isset( $_GET['isux_preview'] ) && current_user_can( 'manage_options' ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended

		$config = array(
			'version'                  => ISUX_VERSION,
			'initialLoader'            => (bool) $options['initial_loader'],
			'transitionLoader'         => (bool) $options['transition_loader'],
			'minDuration'              => $preview ? max( 2200, (int) $options['min_duration'] ) : (int) $options['min_duration'],
			'maxDuration'              => (int) $options['max_duration'],
			'revealEvent'              => $options['reveal_event'],
			'lockScroll'               => (bool) $options['lock_scroll'],
			'scopeSelector'            => $options['scope_selector'],
			'scanBuffer'               => (int) $options['scan_buffer'],
			'maxShapes'                => (int) $options['max_shapes'],
			'respectRadius'            => (bool) $options['respect_radius'],
			'backdrop'                 => $options['backdrop'],
			'waitFonts'                => (bool) $options['wait_fonts'],
			'themeMode'                => $options['theme_mode'],
			'animation'                => $options['animation'],
			'progressBar'              => (bool) $options['progress_bar'],
			'forcedSelectors'          => $options['forced_selectors'],
			'preserveSelectors'        => $options['preserve_selectors'],
			'excludeSkeletonSelectors' => $options['exclude_skeleton_selectors'],
			'navigationMode'           => $options['navigation_mode'],
			'prerenderEagerness'       => $options['prerender_eagerness'],
			'prerenderSkipQuery'       => (bool) $options['prerender_skip_query'],
			'transitionDelay'          => (int) $options['transition_delay'],
			'contentSelector'          => $options['content_selector'],
			'ajaxTimeout'              => (int) $options['ajax_timeout'],
			'loadNewAssets'            => (bool) $options['load_new_assets'],
			'updateHead'               => (bool) $options['update_head'],
			'runInlineScripts'         => (bool) $options['run_inline_scripts'],
			'focusContent'             => (bool) $options['focus_content'],
			'scrollMode'               => $options['scroll_mode'],
			'networkAware'             => (bool) $options['network_aware'],
			'pauseHidden'              => (bool) $options['pause_hidden'],
			'woocommerceAdapter'       => (bool) $options['woocommerce_adapter'],
			'elementorAdapter'         => (bool) $options['elementor_adapter'],
			'excludeUrls'              => $this->lines( $options['exclude_urls'] ),
			'excludeLinkSelectors'     => $options['exclude_link_selectors'],
			'debug'                    => (bool) $options['debug'],
			'preview'                  => $preview,
			'messages'                 => array(
				'loading' => 'Загрузка страницы',
				'loaded'  => 'Страница загружена',
				'error'   => 'Не удалось загрузить страницу. Выполняется обычный переход.',
			),
		);

		$css_file = ISUX_DIR . 'assets/css/frontend.css';
		$css      = is_readable( $css_file ) ? file_get_contents( $css_file ) : ''; // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
		?>
		<style id="isux-critical-css"><?php echo $this->css_variables( $options ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?><?php echo $css; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?><?php echo $this->transition_css( $options ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?><?php echo $options['custom_css']; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></style>
		<script id="isux-bootstrap">
		(function(w,d,c){
			'use strict';
			w.ISUX_CONFIG=c;
			w.ISUX_BOOT_STARTED=(w.performance&&performance.now)?performance.now():Date.now();
			if(!c.initialLoader){return;}
			d.documentElement.classList.add('isux-loading','isux-animation-'+c.animation);
		})(window,document,<?php echo wp_json_encode( $config, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>);
		</script>
		<?php
	}

	/**
	 * Print the overlay as part of the document.
	 *
	 * 2.0 hid <body> with CSS and relied on JavaScript to bring it back, so a
	 * script that never ran left the visitor on a blank page — and the default
	 * white boot background flashed on every dark site. The overlay now ships
	 * in the markup, carries the deadline as a CSS animation, and a <noscript>
	 * rule removes it outright when scripting is off.
	 */
	public function print_overlay() {
		if ( ! $this->should_run() ) {
			return;
		}

		$initial = (bool) $this->settings->get( 'initial_loader' );
		?>
		<div id="isux-overlay" class="isux-overlay" role="status" aria-live="polite"
			aria-label="Загрузка страницы" aria-hidden="<?php echo $initial ? 'false' : 'true'; ?>"
			<?php echo $initial ? ' data-isux-failsafe' : ' hidden'; ?>>
			<div class="isux-shape-layer" aria-hidden="true"></div>
			<div class="isux-progress" aria-hidden="true"><span></span></div>
			<div class="isux-debug-badge" aria-hidden="true"></div>
			<span class="isux-sr-message">Загрузка страницы</span>
		</div>
		<noscript><style>#isux-overlay{display:none!important}</style></noscript>
		<?php
	}

	/**
	 * Cross-document view transitions.
	 *
	 * Pure CSS: both documents have to opt in, which they do because the rule
	 * ships on every page the plugin runs on. No JavaScript is involved, so it
	 * also works in the prerender mode where the click is not intercepted.
	 */
	private function transition_css( $o ) {
		if ( empty( $o['view_transitions'] ) ) {
			return '';
		}
		return '@view-transition{navigation:auto;}' .
			'@media (prefers-reduced-motion: reduce){' .
			'::view-transition-group(*),::view-transition-old(*),::view-transition-new(*){animation:none!important;}}';
	}

	private function lines( $text ) {
		$lines = preg_split( '/\R/u', (string) $text );
		if ( ! is_array( $lines ) ) {
			return array();
		}
		$lines = array_map( 'trim', $lines );
		return array_values( array_filter( $lines, 'strlen' ) );
	}

	private function css_variables( $o ) {
		// --isux-max drives the CSS-only failsafe: if the script never runs, the
		// overlay removes itself on the same deadline the script would have used.
		return sprintf(
			':root{--isux-radius:%1$dpx;--isux-speed:%2$dms;--isux-progress:%3$s;--isux-progress-height:%4$dpx;--isux-max:%5$dms;}',
			(int) $o['radius'],
			(int) $o['shimmer_speed'],
			esc_attr( $o['progress_color'] ),
			(int) $o['progress_height'],
			(int) $o['max_duration']
		);
	}

}

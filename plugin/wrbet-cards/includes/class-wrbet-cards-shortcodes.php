<?php
/**
 * Shortcode rendering for both cards.
 *
 * @package Wrbet_Cards
 */

defined( 'ABSPATH' ) || exit;

/**
 * Registers [wrbet_odds] and [wrbet_crash] and prints their markup.
 */
class Wrbet_Cards_Shortcodes {

	/**
	 * Settings that map onto a CSS custom property on the wrapper.
	 *
	 * @var array<string, string>
	 */
	private static $css_vars = array(
		'accent'      => '--wrbet-accent',
		'ink'         => '--wrbet-ink',
		'text'        => '--wrbet-text',
		'muted'       => '--wrbet-muted',
		'faint'       => '--wrbet-faint',
		'card_bg'     => '--wrbet-card-bg',
		'card_bg2'    => '--wrbet-card-bg-2',
		'border'      => '--wrbet-border',
		'gray'        => '--wrbet-gray',
		'danger'      => '--wrbet-danger',
		'danger_text' => '--wrbet-danger-text',
	);

	/**
	 * Hook everything up.
	 */
	public static function init() {
		add_shortcode( 'wrbet_odds', array( __CLASS__, 'render_odds' ) );
		add_shortcode( 'wrbet_crash', array( __CLASS__, 'render_crash' ) );
		add_action( 'wp_enqueue_scripts', array( __CLASS__, 'register_assets' ) );
	}

	/**
	 * Register (and, when a shortcode is already visible in the content, enqueue)
	 * the front-end assets.
	 */
	public static function register_assets() {
		wp_register_style(
			'wrbet-cards',
			WRBET_CARDS_URL . 'assets/css/wrbet-cards.css',
			array(),
			WRBET_CARDS_VERSION
		);

		wp_register_script(
			'wrbet-cards',
			WRBET_CARDS_URL . 'assets/js/wrbet-cards.js',
			array(),
			WRBET_CARDS_VERSION,
			true
		);

		if ( self::content_has_shortcode() ) {
			self::enqueue();
		}
	}

	/**
	 * Does the post currently being rendered contain one of our shortcodes?
	 *
	 * Only a hint — the shortcode callbacks enqueue on their own as well, which
	 * covers widgets, blocks and template calls.
	 *
	 * @return bool
	 */
	private static function content_has_shortcode() {
		$post = get_post();

		if ( ! $post instanceof WP_Post ) {
			return false;
		}

		return has_shortcode( $post->post_content, 'wrbet_odds' )
			|| has_shortcode( $post->post_content, 'wrbet_crash' );
	}

	/**
	 * Enqueue the stylesheet, the script, and the settings-derived variables.
	 */
	private static function enqueue() {
		static $done = false;

		wp_enqueue_style( 'wrbet-cards' );
		wp_enqueue_script( 'wrbet-cards' );

		if ( $done ) {
			return;
		}
		$done = true;

		$css = self::root_css();
		if ( $css ) {
			wp_add_inline_style( 'wrbet-cards', $css );
		}
	}

	/**
	 * Global CSS: the custom properties from the settings screen, plus the
	 * bundled @font-face rules when the bundled font source is selected.
	 *
	 * @return string
	 */
	private static function root_css() {
		$o     = wrbet_cards_options();
		$rules = array();

		foreach ( self::$css_vars as $key => $var ) {
			$rules[] = $var . ':' . $o[ $key ];
		}

		$rules[] = '--wrbet-radius:' . (float) $o['radius'] . 'px';
		$rules[] = '--wrbet-padding:' . (float) $o['padding'] . 'px';
		$rules[] = '--wrbet-max:' . (float) $o['max_width'] . 'px';
		$rules[] = '--wrbet-scale:' . ( (float) $o['font_scale'] / 100 );

		// 'bundled' pins the two families that actually ship with the plugin;
		// 'theme' hands typography back to the site; only 'custom' reads the fields.
		if ( 'theme' === $o['font_source'] ) {
			$head = 'inherit';
			$body = 'inherit';
		} elseif ( 'bundled' === $o['font_source'] ) {
			$head = self::font_stack( 'Sora' );
			$body = self::font_stack( 'Public Sans' );
		} else {
			$head = self::font_stack( $o['font_head'] );
			$body = self::font_stack( $o['font_body'] );
		}

		$rules[] = '--wrbet-font-head:' . $head;
		$rules[] = '--wrbet-font-body:' . $body;

		$css = '.wrbet{' . implode( ';', $rules ) . '}';

		if ( 'bundled' === $o['font_source'] ) {
			$css .= self::font_face_css();
		}

		return $css;
	}

	/**
	 * Build a font stack, quoting the family only when it needs it.
	 *
	 * @param string $family Family name from the settings.
	 * @return string
	 */
	private static function font_stack( $family ) {
		$family = trim( (string) $family );

		if ( '' === $family || 'inherit' === strtolower( $family ) ) {
			return 'inherit';
		}

		// A family the author already wrote as a stack is passed through as-is.
		if ( false !== strpos( $family, ',' ) ) {
			return $family;
		}

		if ( preg_match( '/[^a-zA-Z0-9-]/', $family ) ) {
			$family = "'" . str_replace( "'", '', $family ) . "'";
		}

		return $family . ',system-ui,-apple-system,"Segoe UI",sans-serif';
	}

	/**
	 * @font-face rules for the two bundled variable fonts.
	 *
	 * @return string
	 */
	private static function font_face_css() {
		$base = WRBET_CARDS_URL . 'assets/fonts/';

		$latin     = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
		$latin_ext = 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';

		$faces = array(
			array( 'Public Sans', '100 900', 'public-sans-latin.woff2', $latin ),
			array( 'Public Sans', '100 900', 'public-sans-latin-ext.woff2', $latin_ext ),
			array( 'Sora', '400 800', 'sora-latin.woff2', $latin ),
			array( 'Sora', '400 800', 'sora-latin-ext.woff2', $latin_ext ),
		);

		$css = '';
		foreach ( $faces as $face ) {
			$css .= sprintf(
				'@font-face{font-family:"%1$s";font-style:normal;font-weight:%2$s;font-display:swap;src:url(%3$s) format("woff2");unicode-range:%4$s}',
				$face[0],
				$face[1],
				esc_url( $base . $face[2] ),
				$face[3]
			);
		}

		return $css;
	}

	/**
	 * Turn per-instance shortcode attributes into an inline style attribute.
	 *
	 * Only attributes the author actually passed end up here, so a shortcode
	 * without colour attributes inherits the global settings untouched.
	 *
	 * @param array $atts Raw shortcode attributes (unmerged).
	 * @return string
	 */
	private static function inline_vars( $atts ) {
		$rules = array();

		foreach ( self::$css_vars as $key => $var ) {
			if ( isset( $atts[ $key ] ) ) {
				$rules[] = $var . ':' . wrbet_cards_sanitize_color( $atts[ $key ], 'transparent' );
			}
		}

		$numeric = array(
			'radius'    => array( '--wrbet-radius', 0, 80, 'px' ),
			'padding'   => array( '--wrbet-padding', 0, 80, 'px' ),
			'max_width' => array( '--wrbet-max', 160, 1200, 'px' ),
		);

		foreach ( $numeric as $key => $spec ) {
			if ( isset( $atts[ $key ] ) ) {
				$rules[] = $spec[0] . ':' . wrbet_cards_sanitize_number( $atts[ $key ], $spec[1], $spec[2], 0 ) . $spec[3];
			}
		}

		if ( isset( $atts['font_scale'] ) ) {
			$rules[] = '--wrbet-scale:' . ( (float) wrbet_cards_sanitize_number( $atts['font_scale'], 50, 200, 100 ) / 100 );
		}

		foreach ( array( 'font_head' => '--wrbet-font-head', 'font_body' => '--wrbet-font-body' ) as $key => $var ) {
			if ( isset( $atts[ $key ] ) ) {
				$rules[] = $var . ':' . self::font_stack( sanitize_text_field( $atts[ $key ] ) );
			}
		}

		return $rules ? ' style="' . esc_attr( implode( ';', $rules ) ) . '"' : '';
	}

	/**
	 * Wrapper classes shared by both cards.
	 *
	 * @param array  $a    Merged attributes.
	 * @param string $name Card name, used for the modifier class.
	 * @return string
	 */
	private static function wrapper_class( $a, $name ) {
		$classes = array( 'wrbet', 'wrbet--' . $name );

		if ( ! self::flag( $a['surface'] ) ) {
			$classes[] = 'wrbet--bare';
		}
		if ( ! self::flag( $a['shadow'] ) ) {
			$classes[] = 'wrbet--flat';
		}
		if ( self::flag( $a['reveal'] ) ) {
			$classes[] = 'wrbet--reveal';
		}
		if ( ! empty( $a['class'] ) ) {
			$classes[] = sanitize_html_class( $a['class'] );
		}

		return implode( ' ', array_map( 'sanitize_html_class', $classes ) );
	}

	/**
	 * Read a checkbox-ish value.
	 *
	 * @param mixed $value Raw value.
	 * @return bool
	 */
	private static function flag( $value ) {
		return in_array( strtolower( (string) $value ), array( '1', 'true', 'yes', 'on' ), true );
	}

	/**
	 * `HB|Harambee Bay|1, NU|Nairobi United|0` → list of teams.
	 *
	 * @param string $raw Raw setting.
	 * @return array<int, array<string, string>>
	 */
	private static function parse_teams( $raw ) {
		$teams = array();

		foreach ( array_filter( array_map( 'trim', explode( ',', (string) $raw ) ) ) as $i => $row ) {
			$parts = array_map( 'trim', explode( '|', $row ) );

			$teams[] = array(
				'badge' => isset( $parts[0] ) ? $parts[0] : '',
				'name'  => isset( $parts[1] ) ? $parts[1] : '',
				'score' => isset( $parts[2] ) ? $parts[2] : '',
				'alt'   => (bool) ( $i % 2 ),
			);
		}

		return $teams;
	}

	/**
	 * `1|1.85, X|3.40*, 2|4.20` → list of outcomes; `*` marks the selected one.
	 *
	 * @param string $raw Raw setting.
	 * @return array<int, array<string, mixed>>
	 */
	private static function parse_odds( $raw ) {
		$odds = array();

		foreach ( array_filter( array_map( 'trim', explode( ',', (string) $raw ) ) ) as $row ) {
			$active = false;

			if ( '*' === substr( $row, -1 ) ) {
				$active = true;
				$row    = rtrim( substr( $row, 0, -1 ) );
			}

			$parts = array_map( 'trim', explode( '|', $row ) );

			$odds[] = array(
				'label'  => isset( $parts[0] ) ? $parts[0] : '',
				'value'  => isset( $parts[1] ) ? $parts[1] : '',
				'active' => $active,
			);
		}

		return $odds;
	}

	/**
	 * `2.14, 1.02!, 18.42^` → history chips. `!` = bust (red), `^` = highlight.
	 *
	 * @param string $raw Raw setting.
	 * @return array<int, array<string, string>>
	 */
	private static function parse_history( $raw ) {
		$chips = array();

		foreach ( array_filter( array_map( 'trim', explode( ',', (string) $raw ) ) ) as $row ) {
			$state = '';

			if ( '!' === substr( $row, -1 ) ) {
				$state = 'bust';
				$row   = rtrim( substr( $row, 0, -1 ) );
			} elseif ( '^' === substr( $row, -1 ) ) {
				$state = 'hot';
				$row   = rtrim( substr( $row, 0, -1 ) );
			}

			$chips[] = array(
				'value' => $row,
				'state' => $state,
			);
		}

		return $chips;
	}

	/**
	 * Merge shortcode attributes over the saved settings.
	 *
	 * @param array $atts Raw attributes.
	 * @return array
	 */
	private static function merge( $atts ) {
		$atts = is_array( $atts ) ? $atts : array();

		return array_merge( wrbet_cards_options(), $atts );
	}

	/* ------------------------------------------------------------------ *
	 *  [wrbet_odds]
	 * ------------------------------------------------------------------ */

	/**
	 * Render the live odds card.
	 *
	 * @param array $atts Shortcode attributes.
	 * @return string
	 */
	public static function render_odds( $atts ) {
		self::enqueue();

		$raw = is_array( $atts ) ? $atts : array();
		$a   = self::merge( $raw );

		$teams = self::parse_teams( $a['teams'] );
		$odds  = self::parse_odds( $a['odds'] );

		$animate = self::flag( $a['animate'] );

		ob_start();
		?>
		<div class="<?php echo esc_attr( self::wrapper_class( $a, 'odds' ) ); ?>"<?php echo self::inline_vars( $raw ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in inline_vars(). ?>
			data-wrbet-odds
			data-animate="<?php echo $animate ? '1' : '0'; ?>"
			data-live-odds="<?php echo ( $animate && self::flag( $a['live_odds'] ) ) ? '1' : '0'; ?>">
			<div class="wrbet-card">

				<?php if ( '' !== $a['live_label'] || '' !== $a['meta'] ) : ?>
					<div class="wrbet-card__head">
						<?php if ( '' !== $a['live_label'] ) : ?>
							<span class="wrbet-live">
								<span class="wrbet-live__dot<?php echo ( $animate && self::flag( $a['pulse'] ) ) ? ' is-pulsing' : ''; ?>" aria-hidden="true"></span>
								<?php echo esc_html( $a['live_label'] ); ?>
							</span>
						<?php endif; ?>
						<?php if ( '' !== $a['meta'] ) : ?>
							<span class="wrbet-card__meta"><?php echo esc_html( $a['meta'] ); ?></span>
						<?php endif; ?>
					</div>
				<?php endif; ?>

				<?php if ( $teams ) : ?>
					<div class="wrbet-teams">
						<?php foreach ( $teams as $team ) : ?>
							<div class="wrbet-team">
								<?php if ( '' !== $team['badge'] ) : ?>
									<span class="wrbet-team__badge<?php echo $team['alt'] ? ' wrbet-team__badge--alt' : ''; ?>" aria-hidden="true"><?php echo esc_html( $team['badge'] ); ?></span>
								<?php endif; ?>
								<span class="wrbet-team__name"><?php echo esc_html( $team['name'] ); ?></span>
								<?php if ( '' !== $team['score'] ) : ?>
									<b class="wrbet-team__score"><?php echo esc_html( $team['score'] ); ?></b>
								<?php endif; ?>
							</div>
						<?php endforeach; ?>
					</div>
				<?php endif; ?>

				<?php if ( $odds ) : ?>
					<div class="wrbet-odds" style="--wrbet-cols:<?php echo (int) count( $odds ); ?>">
						<?php foreach ( $odds as $odd ) : ?>
							<div class="wrbet-odd<?php echo $odd['active'] ? ' is-active' : ''; ?>">
								<span class="wrbet-odd__label"><?php echo esc_html( $odd['label'] ); ?></span>
								<b class="wrbet-odd__value" data-wrbet-odd><?php echo esc_html( $odd['value'] ); ?></b>
							</div>
						<?php endforeach; ?>
					</div>
				<?php endif; ?>

				<?php if ( '' !== $a['odds_note'] ) : ?>
					<p class="wrbet-note"><?php echo esc_html( $a['odds_note'] ); ?></p>
				<?php endif; ?>

			</div>
		</div>
		<?php
		return trim( ob_get_clean() );
	}

	/* ------------------------------------------------------------------ *
	 *  [wrbet_crash]
	 * ------------------------------------------------------------------ */

	/**
	 * Render the crash-round card.
	 *
	 * @param array $atts Shortcode attributes.
	 * @return string
	 */
	public static function render_crash( $atts ) {
		self::enqueue();

		$raw = is_array( $atts ) ? $atts : array();
		$a   = self::merge( $raw );

		$full    = 'full' === strtolower( (string) $a['variant'] );
		$animate = self::flag( $a['animate'] );
		$chips   = self::parse_history( $a['history'] );
		$uid     = 'wrbet-' . wp_unique_id();

		$view_w = 320;
		$view_h = $full ? 180 : 100;

		// A cubic curve that leaves the baseline slowly and steepens — the shape a
		// crash multiplier traces. Drawn once, revealed progressively by the script.
		$curve = $full
			? 'M4,176 C90,172 150,140 200,96 C240,60 280,30 316,12'
			: 'M2,96 C70,93 130,74 176,46 C210,25 250,12 318,4';

		ob_start();
		?>
		<div class="<?php echo esc_attr( self::wrapper_class( $a, 'crash' ) ); ?><?php echo $full ? ' wrbet--full' : ' wrbet--compact'; ?>"<?php echo self::inline_vars( $raw ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in inline_vars(). ?>
			data-wrbet-crash
			data-animate="<?php echo $animate ? '1' : '0'; ?>"
			data-speed="<?php echo esc_attr( wrbet_cards_sanitize_number( $a['speed'], 0.2, 5, 1 ) ); ?>"
			data-min="<?php echo esc_attr( wrbet_cards_sanitize_number( $a['crash_min'], 1.01, 100, 1.2 ) ); ?>"
			data-max="<?php echo esc_attr( wrbet_cards_sanitize_number( $a['crash_max'], 1.02, 1000, 8 ) ); ?>">
			<div class="wrbet-card">

				<div class="wrbet-crash__head">
					<?php if ( '' !== $a['crash_label'] ) : ?>
						<span class="wrbet-crash__label"><?php echo esc_html( $a['crash_label'] ); ?></span>
					<?php endif; ?>
					<span class="wrbet-crash__mult" data-wrbet-mult><?php echo esc_html( $a['static_mult'] ); ?>x</span>
				</div>

				<svg class="wrbet-crash__chart" viewBox="0 0 <?php echo (int) $view_w; ?> <?php echo (int) $view_h; ?>" role="img"
					aria-label="<?php esc_attr_e( 'Illustration of a rising crash multiplier', 'wrbet-cards' ); ?>">
					<defs>
						<linearGradient id="<?php echo esc_attr( $uid ); ?>-fill" x1="0" y1="0" x2="0" y2="1">
							<stop offset="0%" stop-color="var(--wrbet-accent)" stop-opacity=".3"/>
							<stop offset="100%" stop-color="var(--wrbet-accent)" stop-opacity="0"/>
						</linearGradient>
						<clipPath id="<?php echo esc_attr( $uid ); ?>-clip">
							<rect x="0" y="0" height="<?php echo (int) $view_h; ?>" width="<?php echo (int) $view_w; ?>" data-wrbet-clip/>
						</clipPath>
					</defs>

					<?php if ( $full && self::flag( $a['grid'] ) ) : ?>
						<g class="wrbet-crash__grid">
							<path d="M0 45h320M0 90h320M0 135h320"/>
							<path d="M80 0v180M160 0v180M240 0v180"/>
						</g>
					<?php endif; ?>

					<g clip-path="url(#<?php echo esc_attr( $uid ); ?>-clip)">
						<path class="wrbet-crash__area"
							d="<?php echo esc_attr( $curve . ' L' . $view_w . ',' . $view_h . ' L0,' . $view_h . ' Z' ); ?>"
							fill="url(#<?php echo esc_attr( $uid ); ?>-fill)"/>
					</g>

					<path class="wrbet-crash__line" data-wrbet-line d="<?php echo esc_attr( $curve ); ?>"/>

					<?php if ( $full ) : ?>
						<circle class="wrbet-crash__dot<?php echo ( $animate && self::flag( $a['pulse'] ) ) ? ' is-pulsing' : ''; ?>" data-wrbet-dot r="5" cx="316" cy="12"/>
					<?php endif; ?>
				</svg>

				<?php if ( $chips ) : ?>
					<div class="wrbet-history" data-wrbet-history>
						<?php foreach ( $chips as $chip ) : ?>
							<span class="wrbet-chip<?php echo $chip['state'] ? ' is-' . esc_attr( $chip['state'] ) : ''; ?>"><?php echo esc_html( $chip['value'] ); ?>x</span>
						<?php endforeach; ?>
					</div>
				<?php endif; ?>

				<?php if ( '' !== $a['crash_note'] ) : ?>
					<p class="wrbet-note"><?php echo esc_html( $a['crash_note'] ); ?></p>
				<?php endif; ?>

			</div>
		</div>
		<?php
		return trim( ob_get_clean() );
	}
}

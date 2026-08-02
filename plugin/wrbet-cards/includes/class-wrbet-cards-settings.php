<?php
/**
 * Admin settings screen.
 *
 * @package Wrbet_Cards
 */

defined( 'ABSPATH' ) || exit;

/**
 * Builds the settings page from a single declarative field list.
 */
class Wrbet_Cards_Settings {

	/**
	 * Menu slug / page identifier.
	 */
	const PAGE = 'wrbet-cards';

	/**
	 * Hook everything up.
	 */
	public static function init() {
		add_action( 'admin_menu', array( __CLASS__, 'add_page' ) );
		add_action( 'admin_init', array( __CLASS__, 'register' ) );
		add_action( 'admin_enqueue_scripts', array( __CLASS__, 'assets' ) );
	}

	/**
	 * Every field on the screen, grouped by section.
	 *
	 * @return array
	 */
	private static function schema() {
		return array(
			'colors'    => array(
				'title'  => __( 'Colours', 'wrbet-cards' ),
				'desc'   => __( 'Applied to both cards. Hex, rgb() and rgba() are all accepted — the translucent defaults are what keeps the cards readable on any background.', 'wrbet-cards' ),
				'fields' => array(
					'accent'      => array( 'color', __( 'Accent', 'wrbet-cards' ), __( 'Odds values, multiplier, live label, chart line.', 'wrbet-cards' ) ),
					'text'        => array( 'color', __( 'Text', 'wrbet-cards' ), __( 'Team names and scores.', 'wrbet-cards' ) ),
					'muted'       => array( 'color', __( 'Muted text', 'wrbet-cards' ), '' ),
					'faint'       => array( 'color', __( 'Meta text', 'wrbet-cards' ), __( 'Labels, match meta, note line.', 'wrbet-cards' ) ),
					'card_bg'     => array( 'color', __( 'Card background', 'wrbet-cards' ), __( 'Top of the card gradient.', 'wrbet-cards' ) ),
					'card_bg2'    => array( 'color', __( 'Card background (bottom)', 'wrbet-cards' ), __( 'Set both to the same value for a flat fill.', 'wrbet-cards' ) ),
					'border'      => array( 'color', __( 'Card border', 'wrbet-cards' ), '' ),
					'gray'        => array( 'color', __( 'Badge fill', 'wrbet-cards' ), '' ),
					'danger'      => array( 'color', __( 'Bust background', 'wrbet-cards' ), __( 'Chips for rounds that crashed early.', 'wrbet-cards' ) ),
					'danger_text' => array( 'color', __( 'Bust text', 'wrbet-cards' ), '' ),
				),
			),
			'shape'     => array(
				'title'  => __( 'Shape &amp; typography', 'wrbet-cards' ),
				'desc'   => '',
				'fields' => array(
					'radius'      => array( 'number', __( 'Corner radius (px)', 'wrbet-cards' ), '', array( 'min' => 0, 'max' => 80 ) ),
					'padding'     => array( 'number', __( 'Card padding (px)', 'wrbet-cards' ), '', array( 'min' => 0, 'max' => 80 ) ),
					'max_width'   => array( 'number', __( 'Max width (px)', 'wrbet-cards' ), __( 'The card is fluid below this width.', 'wrbet-cards' ), array( 'min' => 160, 'max' => 1200 ) ),
					'surface'     => array( 'toggle', __( 'Draw the card surface', 'wrbet-cards' ), __( 'Off renders the contents with no card behind them at all.', 'wrbet-cards' ) ),
					'shadow'      => array( 'toggle', __( 'Drop shadow', 'wrbet-cards' ), '' ),
					'font_source' => array(
						'select',
						__( 'Fonts', 'wrbet-cards' ),
						__( 'Bundled ships Sora and Public Sans with the plugin — no external requests.', 'wrbet-cards' ),
						array(
							'options' => array(
								'bundled' => __( 'Bundled (Sora + Public Sans)', 'wrbet-cards' ),
								'theme'   => __( 'Inherit from the theme', 'wrbet-cards' ),
								'custom'  => __( 'Custom families below', 'wrbet-cards' ),
							),
						),
					),
					'font_head'   => array( 'text', __( 'Heading family', 'wrbet-cards' ), __( 'Multiplier, scores, odds. Use <code>inherit</code> to take the theme’s.', 'wrbet-cards' ) ),
					'font_body'   => array( 'text', __( 'Body family', 'wrbet-cards' ), '' ),
					'font_scale'  => array( 'number', __( 'Type scale (%)', 'wrbet-cards' ), __( 'Scales every size inside the cards at once.', 'wrbet-cards' ), array( 'min' => 50, 'max' => 200 ) ),
				),
			),
			'animation' => array(
				'title'  => __( 'Animation', 'wrbet-cards' ),
				'desc'   => __( 'All motion stops automatically for visitors who ask for reduced motion, and pauses while the card is off-screen or the tab is hidden.', 'wrbet-cards' ),
				'fields' => array(
					'animate'   => array( 'toggle', __( 'Animate', 'wrbet-cards' ), __( 'Off renders a finished round as a static image.', 'wrbet-cards' ) ),
					'pulse'     => array( 'toggle', __( 'Pulse the live dot', 'wrbet-cards' ), '' ),
					'reveal'    => array( 'toggle', __( 'Fade in on scroll', 'wrbet-cards' ), '' ),
					'live_odds' => array( 'toggle', __( 'Drift the odds', 'wrbet-cards' ), __( 'Nudges an unselected price every few seconds, the way a live market moves.', 'wrbet-cards' ) ),
					'speed'     => array( 'number', __( 'Round speed', 'wrbet-cards' ), __( '1 is the default pace; 2 is twice as fast.', 'wrbet-cards' ), array( 'min' => 0.2, 'max' => 5, 'step' => 0.1 ) ),
					'crash_min' => array( 'number', __( 'Lowest multiplier', 'wrbet-cards' ), '', array( 'min' => 1.01, 'max' => 100, 'step' => 0.01 ) ),
					'crash_max' => array( 'number', __( 'Highest multiplier', 'wrbet-cards' ), '', array( 'min' => 1.02, 'max' => 1000, 'step' => 0.01 ) ),
				),
			),
			'odds'      => array(
				'title'  => __( 'Odds card content', 'wrbet-cards' ),
				'desc'   => __( 'Shortcode: <code>[wrbet_odds]</code>', 'wrbet-cards' ),
				'fields' => array(
					'live_label' => array( 'text', __( 'Live label', 'wrbet-cards' ), __( 'Leave empty to hide the whole top row.', 'wrbet-cards' ) ),
					'meta'       => array( 'text', __( 'Match meta', 'wrbet-cards' ), '' ),
					'teams'      => array( 'text', __( 'Teams', 'wrbet-cards' ), __( 'One per comma: <code>badge|name|score</code>. Example: <code>HB|Harambee Bay|1, NU|Nairobi United|0</code>', 'wrbet-cards' ) ),
					'odds'       => array( 'text', __( 'Odds', 'wrbet-cards' ), __( 'One per comma: <code>label|value</code>, with <code>*</code> on the selected one. Example: <code>1|1.85, X|3.40*, 2|4.20</code>', 'wrbet-cards' ) ),
					'odds_note'  => array( 'textarea', __( 'Note', 'wrbet-cards' ), __( 'Small print under the odds. Leave empty to hide.', 'wrbet-cards' ) ),
				),
			),
			'crash'     => array(
				'title'  => __( 'Crash card content', 'wrbet-cards' ),
				'desc'   => __( 'Shortcode: <code>[wrbet_crash]</code>', 'wrbet-cards' ),
				'fields' => array(
					'variant'     => array(
						'select',
						__( 'Variant', 'wrbet-cards' ),
						__( 'Full adds the chart grid, the marker dot and a larger multiplier.', 'wrbet-cards' ),
						array(
							'options' => array(
								'compact' => __( 'Compact', 'wrbet-cards' ),
								'full'    => __( 'Full', 'wrbet-cards' ),
							),
						),
					),
					'crash_label' => array( 'text', __( 'Label', 'wrbet-cards' ), '' ),
					'static_mult' => array( 'text', __( 'Static multiplier', 'wrbet-cards' ), __( 'Shown before the animation starts, when animation is off, and to visitors who asked for reduced motion — so it should read as a finished round.', 'wrbet-cards' ) ),
					'grid'        => array( 'toggle', __( 'Chart grid', 'wrbet-cards' ), __( 'Full variant only.', 'wrbet-cards' ) ),
					'history'     => array( 'text', __( 'History chips', 'wrbet-cards' ), __( 'Comma separated. Add <code>!</code> for a busted round, <code>^</code> to highlight. Example: <code>2.14, 1.02!, 18.42^</code>', 'wrbet-cards' ) ),
					'crash_note'  => array( 'textarea', __( 'Note', 'wrbet-cards' ), '' ),
				),
			),
			'aviator'   => array(
				'title'  => __( 'Aviator card content', 'wrbet-cards' ),
				'desc'   => __( 'Shortcode: <code>[wrbet_aviator]</code> — the same widget locked to the full layout, with its own content so both crash cards can sit on one page. Animation settings above apply to both.', 'wrbet-cards' ),
				'fields' => array(
					'av_label'     => array( 'text', __( 'Label', 'wrbet-cards' ), '' ),
					'av_static'    => array( 'text', __( 'Static multiplier', 'wrbet-cards' ), __( 'Shown when the card is not animating, so it should read as a finished round.', 'wrbet-cards' ) ),
					'av_max_width' => array( 'number', __( 'Max width (px)', 'wrbet-cards' ), __( 'This card is wider than the compact one by default.', 'wrbet-cards' ), array( 'min' => 160, 'max' => 1200 ) ),
					'av_grid'      => array( 'toggle', __( 'Chart grid', 'wrbet-cards' ), '' ),
					'av_history'   => array( 'text', __( 'History chips', 'wrbet-cards' ), __( 'Same syntax as above: <code>!</code> for a bust, <code>^</code> to highlight.', 'wrbet-cards' ) ),
					'av_note'      => array( 'textarea', __( 'Note', 'wrbet-cards' ), '' ),
				),
			),
		);
	}

	/**
	 * Add the options page.
	 */
	public static function add_page() {
		add_options_page(
			__( 'Wrbet Cards', 'wrbet-cards' ),
			__( 'Wrbet Cards', 'wrbet-cards' ),
			'manage_options',
			self::PAGE,
			array( __CLASS__, 'render_page' )
		);
	}

	/**
	 * Register the option, its sections and its fields.
	 */
	public static function register() {
		register_setting(
			self::PAGE,
			WRBET_CARDS_OPTION,
			array(
				'type'              => 'array',
				'sanitize_callback' => array( __CLASS__, 'sanitize' ),
				'default'           => wrbet_cards_defaults(),
			)
		);

		foreach ( self::schema() as $section_id => $section ) {
			add_settings_section(
				'wrbet_' . $section_id,
				$section['title'],
				static function () use ( $section ) {
					if ( $section['desc'] ) {
						echo '<p class="description">' . wp_kses_post( $section['desc'] ) . '</p>';
					}
				},
				self::PAGE
			);

			foreach ( $section['fields'] as $key => $field ) {
				add_settings_field(
					'wrbet_field_' . $key,
					$field[1],
					array( __CLASS__, 'render_field' ),
					self::PAGE,
					'wrbet_' . $section_id,
					array(
						'key'   => $key,
						'type'  => $field[0],
						'desc'  => isset( $field[2] ) ? $field[2] : '',
						'extra' => isset( $field[3] ) ? $field[3] : array(),
					)
				);
			}
		}
	}

	/**
	 * Validate everything coming out of the form.
	 *
	 * @param mixed $input Raw submitted values.
	 * @return array
	 */
	public static function sanitize( $input ) {
		$defaults = wrbet_cards_defaults();
		$input    = is_array( $input ) ? $input : array();
		$out      = array();

		$colors  = array( 'accent', 'ink', 'text', 'muted', 'faint', 'card_bg', 'card_bg2', 'border', 'gray', 'danger', 'danger_text' );
		$toggles = array( 'surface', 'shadow', 'animate', 'pulse', 'reveal', 'live_odds', 'grid', 'av_grid' );
		$numbers = array(
			'radius'     => array( 0, 80 ),
			'padding'    => array( 0, 80 ),
			'max_width'  => array( 160, 1200 ),
			'font_scale' => array( 50, 200 ),
			'speed'      => array( 0.2, 5 ),
			'crash_min'  => array( 1.01, 100 ),
			'crash_max'  => array( 1.02, 1000 ),
			'av_max_width' => array( 160, 1200 ),
		);

		foreach ( $defaults as $key => $default ) {
			if ( in_array( $key, $colors, true ) ) {
				$out[ $key ] = wrbet_cards_sanitize_color( isset( $input[ $key ] ) ? $input[ $key ] : '', $default );
			} elseif ( in_array( $key, $toggles, true ) ) {
				// Unchecked boxes are simply absent from the POST body.
				$out[ $key ] = empty( $input[ $key ] ) ? '0' : '1';
			} elseif ( isset( $numbers[ $key ] ) ) {
				$out[ $key ] = wrbet_cards_sanitize_number(
					isset( $input[ $key ] ) ? $input[ $key ] : '',
					$numbers[ $key ][0],
					$numbers[ $key ][1],
					$default
				);
			} elseif ( 'font_source' === $key ) {
				$allowed     = array( 'bundled', 'theme', 'custom' );
				$out[ $key ] = ( isset( $input[ $key ] ) && in_array( $input[ $key ], $allowed, true ) ) ? $input[ $key ] : $default;
			} elseif ( 'variant' === $key ) {
				$out[ $key ] = ( isset( $input[ $key ] ) && 'full' === $input[ $key ] ) ? 'full' : 'compact';
			} else {
				$out[ $key ] = isset( $input[ $key ] ) ? sanitize_text_field( $input[ $key ] ) : $default;
			}
		}

		if ( (float) $out['crash_max'] <= (float) $out['crash_min'] ) {
			$out['crash_max'] = (string) ( (float) $out['crash_min'] + 1 );
		}

		return $out;
	}

	/**
	 * Print one field.
	 *
	 * @param array $args Field arguments from add_settings_field().
	 */
	public static function render_field( $args ) {
		$o     = wrbet_cards_options();
		$key   = $args['key'];
		$value = isset( $o[ $key ] ) ? $o[ $key ] : '';
		$name  = WRBET_CARDS_OPTION . '[' . $key . ']';
		$id    = 'wrbet_' . $key;
		$extra = $args['extra'];

		switch ( $args['type'] ) {
			case 'color':
				printf(
					'<input type="text" class="wrbet-color" id="%1$s" name="%2$s" value="%3$s" data-default-color="%4$s" />',
					esc_attr( $id ),
					esc_attr( $name ),
					esc_attr( $value ),
					esc_attr( wrbet_cards_defaults()[ $key ] )
				);
				break;

			case 'number':
				printf(
					'<input type="number" id="%1$s" name="%2$s" value="%3$s" min="%4$s" max="%5$s" step="%6$s" class="small-text" />',
					esc_attr( $id ),
					esc_attr( $name ),
					esc_attr( $value ),
					esc_attr( isset( $extra['min'] ) ? $extra['min'] : 0 ),
					esc_attr( isset( $extra['max'] ) ? $extra['max'] : 100 ),
					esc_attr( isset( $extra['step'] ) ? $extra['step'] : 1 )
				);
				break;

			case 'toggle':
				printf(
					'<label><input type="checkbox" id="%1$s" name="%2$s" value="1" %3$s /> %4$s</label>',
					esc_attr( $id ),
					esc_attr( $name ),
					checked( '1', (string) $value, false ),
					esc_html__( 'Enabled', 'wrbet-cards' )
				);
				break;

			case 'select':
				printf( '<select id="%1$s" name="%2$s">', esc_attr( $id ), esc_attr( $name ) );
				foreach ( $extra['options'] as $option_value => $label ) {
					printf(
						'<option value="%1$s" %2$s>%3$s</option>',
						esc_attr( $option_value ),
						selected( $option_value, $value, false ),
						esc_html( $label )
					);
				}
				echo '</select>';
				break;

			case 'textarea':
				printf(
					'<textarea id="%1$s" name="%2$s" rows="2" class="large-text">%3$s</textarea>',
					esc_attr( $id ),
					esc_attr( $name ),
					esc_textarea( $value )
				);
				break;

			default:
				printf(
					'<input type="text" id="%1$s" name="%2$s" value="%3$s" class="regular-text" />',
					esc_attr( $id ),
					esc_attr( $name ),
					esc_attr( $value )
				);
		}

		if ( $args['desc'] ) {
			echo '<p class="description">' . wp_kses_post( $args['desc'] ) . '</p>';
		}
	}

	/**
	 * Colour picker plus the small stylesheet for the live preview.
	 *
	 * @param string $hook Current admin page.
	 */
	public static function assets( $hook ) {
		if ( 'settings_page_' . self::PAGE !== $hook ) {
			return;
		}

		wp_enqueue_style( 'wp-color-picker' );
		wp_enqueue_style( 'wrbet-cards', WRBET_CARDS_URL . 'assets/css/wrbet-cards.css', array(), WRBET_CARDS_VERSION );
		wp_enqueue_style( 'wrbet-cards-admin', WRBET_CARDS_URL . 'assets/admin/admin.css', array( 'wp-color-picker' ), WRBET_CARDS_VERSION );

		wp_enqueue_script( 'wrbet-cards', WRBET_CARDS_URL . 'assets/js/wrbet-cards.js', array(), WRBET_CARDS_VERSION, true );
		wp_enqueue_script( 'wrbet-cards-admin', WRBET_CARDS_URL . 'assets/admin/admin.js', array( 'jquery', 'wp-color-picker' ), WRBET_CARDS_VERSION, true );
	}

	/**
	 * The settings screen itself, with a live preview of both cards.
	 */
	public static function render_page() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		?>
		<div class="wrap wrbet-admin">
			<h1><?php echo esc_html( get_admin_page_title() ); ?></h1>

			<div class="wrbet-admin__intro notice notice-info inline">
				<p>
					<?php esc_html_e( 'Drop any of the three cards anywhere shortcodes run:', 'wrbet-cards' ); ?>
					<code>[wrbet_odds]</code>, <code>[wrbet_crash]</code>, <code>[wrbet_aviator]</code>.
				</p>
				<p>
					<?php
					echo wp_kses_post(
						__( 'Every setting below doubles as a shortcode attribute, so a single instance can differ from the defaults — for example <code>[wrbet_crash variant="full" accent="#ff2d55" speed="1.6"]</code>.', 'wrbet-cards' )
					);
					?>
				</p>
			</div>

			<div class="wrbet-admin__layout">
				<form action="options.php" method="post" class="wrbet-admin__form">
					<?php
					settings_fields( self::PAGE );
					do_settings_sections( self::PAGE );
					submit_button();
					?>
				</form>

				<aside class="wrbet-admin__preview">
					<h2><?php esc_html_e( 'Preview', 'wrbet-cards' ); ?></h2>
					<p class="description"><?php esc_html_e( 'Saved settings, on a checkerboard — the cards paint no background of their own.', 'wrbet-cards' ); ?></p>
					<div class="wrbet-admin__stage">
						<?php
						// Output of our own shortcodes, already escaped during rendering.
						echo do_shortcode( '[wrbet_odds]' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
						echo do_shortcode( '[wrbet_crash]' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
						echo do_shortcode( '[wrbet_aviator]' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
						?>
					</div>
				</aside>
			</div>
		</div>
		<?php
	}
}

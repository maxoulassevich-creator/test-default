<?php
/**
 * Выдвижная панель входа/регистрации (справа, на всю высоту экрана).
 *
 * Переопределяется темой: wp-content/themes/ваша-тема/vl-account/auth-drawer.php
 *
 * @package VL_Account
 *
 * @var string $title    Заголовок панели.
 * @var string $message  Пояснение под заголовком.
 * @var string $redirect Куда вести после входа.
 */

defined( 'ABSPATH' ) || exit;

$vl_title    = isset( $title ) ? $title : '';
$vl_message  = isset( $message ) ? $message : '';
$vl_redirect = isset( $redirect ) ? $redirect : '';
?>
<div class="vl-drawer" data-vl-drawer hidden aria-hidden="true">
	<div class="vl-drawer__overlay" data-vl-drawer-close></div>

	<aside class="vl-drawer__panel" role="dialog" aria-modal="true" aria-label="<?php echo esc_attr( $vl_title ); ?>">
		<button type="button" class="vl-drawer__close" data-vl-drawer-close aria-label="<?php esc_attr_e( 'Закрыть', 'vl-account' ); ?>">
			<span aria-hidden="true"></span>
		</button>

		<div class="vl-drawer__inner">
			<?php if ( $vl_title ) : ?>
				<h2 class="vl-drawer__title"><?php echo esc_html( $vl_title ); ?></h2>
			<?php endif; ?>

			<?php if ( $vl_message ) : ?>
				<p class="vl-drawer__message" data-vl-drawer-message><?php echo esc_html( $vl_message ); ?></p>
			<?php else : ?>
				<p class="vl-drawer__message" data-vl-drawer-message hidden></p>
			<?php endif; ?>

			<div class="vl-drawer__body">
				<?php
				// phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- разметка формируется шаблоном формы.
				echo VL_Account_Shortcodes::render_auth(
					array(
						'redirect'    => $vl_redirect,
						'default_tab' => 'login',
						'show_tabs'   => 'yes',
					)
				);
				?>
			</div>
		</div>
	</aside>
</div>

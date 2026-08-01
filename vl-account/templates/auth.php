<?php
/**
 * Блок входа и регистрации.
 *
 * Переопределяется темой: wp-content/themes/ваша-тема/vl-account/auth.php
 *
 * @package VL_Account
 *
 * @var string $redirect    Куда вести после входа.
 * @var string $notice      Сообщение над формой.
 * @var string $title       Заголовок.
 * @var string $default_tab login|register.
 * @var string $show_tabs   yes|no.
 */

defined( 'ABSPATH' ) || exit;

$vl_tabs    = isset( $show_tabs ) && 'no' !== $show_tabs;
$vl_default = isset( $default_tab ) && 'register' === $default_tab ? 'register' : 'login';
$vl_notice  = isset( $notice ) ? $notice : '';
$vl_title   = isset( $title ) ? $title : '';
$vl_redir   = isset( $redirect ) ? $redirect : '';

// Сообщение из ссылки в письме с истёкшим сроком.
if ( ! $vl_notice && ! empty( $_GET['vlacc_notice'] ) && 'link_expired' === $_GET['vlacc_notice'] ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended
	$vl_notice = __( 'Ссылка для входа больше не действует. Войдите по коду из SMS.', 'vl-account' );
}
?>
<div class="vl-auth" data-vl-auth data-redirect="<?php echo esc_url( $vl_redir ); ?>" data-tab="<?php echo esc_attr( $vl_default ); ?>">

	<?php if ( $vl_title ) : ?>
		<h2 class="vl-auth__title"><?php echo esc_html( $vl_title ); ?></h2>
	<?php endif; ?>

	<?php if ( $vl_notice ) : ?>
		<div class="vl-message vl-message--info"><?php echo esc_html( $vl_notice ); ?></div>
	<?php endif; ?>

	<?php if ( $vl_tabs ) : ?>
		<div class="vl-auth__tabs" role="tablist">
			<button type="button" class="vl-auth__tab<?php echo 'login' === $vl_default ? ' is-active' : ''; ?>" data-vl-tab="login" role="tab">
				<?php esc_html_e( 'войти', 'vl-account' ); ?>
			</button>
			<button type="button" class="vl-auth__tab<?php echo 'register' === $vl_default ? ' is-active' : ''; ?>" data-vl-tab="register" role="tab">
				<?php esc_html_e( 'зарегистрироваться', 'vl-account' ); ?>
			</button>
		</div>
	<?php endif; ?>

	<div class="vl-auth__panes">
		<div class="vl-auth__pane<?php echo 'login' === $vl_default ? ' is-active' : ''; ?>" data-vl-pane="login">
			<?php vlacc_template( 'form-login.php', array( 'redirect' => $vl_redir ) ); ?>
		</div>

		<div class="vl-auth__pane<?php echo 'register' === $vl_default ? ' is-active' : ''; ?>" data-vl-pane="register">
			<?php vlacc_template( 'form-register.php', array( 'redirect' => $vl_redir ) ); ?>
		</div>

		<div class="vl-auth__pane" data-vl-pane="lost">
			<?php vlacc_template( 'form-lost-password.php', array( 'title' => '' ) ); ?>
		</div>
	</div>
</div>

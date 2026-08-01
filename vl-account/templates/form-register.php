<?php
/**
 * Форма регистрации: подтверждение номера по SMS + данные покупателя.
 *
 * @package VL_Account
 *
 * @var string $redirect Куда вести после регистрации.
 */

defined( 'ABSPATH' ) || exit;

$vl_redir     = isset( $redirect ) ? $redirect : '';
$vl_telegram  = (bool) VL_Account_Settings::get( 'show_telegram', 1 );
$vl_nopass    = (bool) VL_Account_Settings::get( 'passwordless', 1 );
$vl_email_req = (bool) VL_Account_Settings::get( 'require_email', 1 );
$vl_name_req  = (bool) VL_Account_Settings::get( 'require_name', 1 );
?>
<form class="vl-form vl-form--register" data-vl-form="register" method="post" novalidate>

	<div class="vl-form__messages" data-vl-messages></div>

	<div class="vl-field">
		<label class="vl-label" for="vl-reg-first">
			<?php esc_html_e( 'Имя', 'vl-account' ); ?>
			<?php if ( $vl_name_req ) : ?><span class="vl-req">*</span><?php endif; ?>
		</label>
		<input type="text" id="vl-reg-first" name="first_name" class="vl-input" autocomplete="given-name" />
		<span class="vl-field__error" data-vl-error="first_name"></span>
	</div>

	<div class="vl-field">
		<label class="vl-label" for="vl-reg-last"><?php esc_html_e( 'Фамилия', 'vl-account' ); ?></label>
		<input type="text" id="vl-reg-last" name="last_name" class="vl-input" autocomplete="family-name" />
	</div>

	<?php if ( $vl_telegram ) : ?>
		<div class="vl-field">
			<label class="vl-label" for="vl-reg-telegram">
				<?php echo vlacc_icon( 'telegram', 15 ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
				<?php esc_html_e( 'Telegram', 'vl-account' ); ?>
			</label>
			<input type="text" id="vl-reg-telegram" name="telegram" class="vl-input" placeholder="@username" />
		</div>
	<?php endif; ?>

	<div class="vl-field vl-field--phone">
		<label class="vl-label" for="vl-reg-phone">
			<?php echo vlacc_icon( 'phone', 15 ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
			<?php esc_html_e( 'Телефон', 'vl-account' ); ?> <span class="vl-req">*</span>
			<span class="vl-verified" data-vl-verified hidden><?php echo vlacc_icon( 'check', 14 ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?> <?php esc_html_e( 'подтверждён', 'vl-account' ); ?></span>
		</label>

		<div class="vl-inline">
			<input type="tel" id="vl-reg-phone" name="phone" class="vl-input" autocomplete="tel"
				placeholder="<?php echo esc_attr( VL_Account_Settings::get( 'phone_mask', '+7 (___) ___-__-__' ) ); ?>"
				data-vl-phone required />
			<button type="button" class="vl-btn vl-btn--outline" data-vl-action="send-code" data-purpose="register">
				<?php esc_html_e( 'получить код', 'vl-account' ); ?>
			</button>
		</div>
		<span class="vl-field__error" data-vl-error="phone"></span>
		<span class="vl-field__hint"><?php esc_html_e( 'На него придёт код подтверждения — по нему вы будете входить в кабинет.', 'vl-account' ); ?></span>
	</div>

	<div class="vl-field vl-field--code" data-vl-code-wrap hidden>
		<label class="vl-label" for="vl-reg-code"><?php esc_html_e( 'Код из SMS', 'vl-account' ); ?> <span class="vl-req">*</span></label>
		<div class="vl-inline">
			<input type="text" id="vl-reg-code" name="code" class="vl-input vl-input--code" inputmode="numeric"
				autocomplete="one-time-code" maxlength="8" data-vl-code />
			<button type="button" class="vl-btn vl-btn--outline" data-vl-action="verify-code" data-purpose="register">
				<?php esc_html_e( 'подтвердить', 'vl-account' ); ?>
			</button>
		</div>
		<span class="vl-field__error" data-vl-error="code"></span>
		<p class="vl-links">
			<button type="button" class="vl-link" data-vl-action="resend" data-purpose="register"><?php esc_html_e( 'Отправить код повторно', 'vl-account' ); ?></button>
		</p>
	</div>

	<div class="vl-field">
		<label class="vl-label" for="vl-reg-email">
			<?php esc_html_e( 'Email адрес', 'vl-account' ); ?>
			<?php if ( $vl_email_req ) : ?><span class="vl-req">*</span><?php endif; ?>
		</label>
		<input type="email" id="vl-reg-email" name="email" class="vl-input" autocomplete="email" data-vl-email />
		<span class="vl-field__error" data-vl-error="email"></span>
	</div>

	<?php if ( ! $vl_nopass ) : ?>
		<div class="vl-field">
			<label class="vl-label" for="vl-reg-pass"><?php esc_html_e( 'Пароль', 'vl-account' ); ?> <span class="vl-req">*</span></label>
			<input type="password" id="vl-reg-pass" name="password" class="vl-input" autocomplete="new-password" />
			<button type="button" class="vl-eye" data-vl-toggle-password aria-label="<?php esc_attr_e( 'Показать пароль', 'vl-account' ); ?>"></button>
			<span class="vl-field__error" data-vl-error="password"></span>
		</div>

		<div class="vl-field">
			<label class="vl-label" for="vl-reg-pass2"><?php esc_html_e( 'Подтвердить пароль', 'vl-account' ); ?> <span class="vl-req">*</span></label>
			<input type="password" id="vl-reg-pass2" name="password2" class="vl-input" autocomplete="new-password"
				placeholder="<?php esc_attr_e( 'Подтвердить пароль', 'vl-account' ); ?>" />
			<span class="vl-field__error" data-vl-error="password2"></span>
		</div>
	<?php else : ?>
		<p class="vl-note"><?php esc_html_e( 'Пароль придумывать не нужно — вход в кабинет по коду из SMS. Задать пароль можно потом в кабинете.', 'vl-account' ); ?></p>
	<?php endif; ?>

	<?php vlacc_template( 'parts/consents.php' ); ?>

	<div class="vl-actions">
		<button type="submit" class="vl-btn vl-btn--primary" data-vl-action="register">
			<?php esc_html_e( 'зарегистрироваться', 'vl-account' ); ?>
		</button>
		<button type="button" class="vl-btn vl-btn--dark" data-vl-action="show-login">
			<?php esc_html_e( 'войти', 'vl-account' ); ?>
		</button>
	</div>

	<input type="hidden" name="token" data-vl-token value="" />
	<input type="hidden" name="redirect_to" value="<?php echo esc_url( $vl_redir ); ?>" />
	<input type="text" name="vlacc_hp" class="vl-hp" tabindex="-1" autocomplete="off" aria-hidden="true" />
</form>

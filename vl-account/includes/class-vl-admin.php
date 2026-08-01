<?php
/**
 * Страница настроек в админке.
 *
 * @package VL_Account
 */

defined( 'ABSPATH' ) || exit;

/**
 * Админка.
 */
class VL_Account_Admin {

	/**
	 * Экземпляр.
	 *
	 * @var VL_Account_Admin|null
	 */
	private static $instance = null;

	/**
	 * Получить экземпляр.
	 *
	 * @return VL_Account_Admin
	 */
	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	/**
	 * Конструктор.
	 */
	private function __construct() {
		add_action( 'admin_menu', array( $this, 'menu' ) );
		add_action( 'admin_post_vlacc_save_settings', array( $this, 'save' ) );
		add_action( 'admin_post_vlacc_test_sms', array( $this, 'test_sms' ) );
		add_action( 'admin_post_vlacc_flush_rules', array( $this, 'flush_rules' ) );
		add_action( 'admin_post_vlacc_clear_log', array( $this, 'clear_log' ) );
		add_filter( 'plugin_action_links_' . VLACC_BASENAME, array( $this, 'action_links' ) );
	}

	/**
	 * Пункт меню.
	 */
	public function menu() {
		add_menu_page(
			__( 'Личный кабинет', 'vl-account' ),
			__( 'Личный кабинет', 'vl-account' ),
			'manage_options',
			'vl-account',
			array( $this, 'render' ),
			'dashicons-admin-users',
			58
		);
	}

	/**
	 * Ссылка «Настройки» в списке плагинов.
	 *
	 * @param array $links Ссылки.
	 * @return array
	 */
	public function action_links( $links ) {
		array_unshift( $links, '<a href="' . esc_url( admin_url( 'admin.php?page=vl-account' ) ) . '">' . esc_html__( 'Настройки', 'vl-account' ) . '</a>' );

		return $links;
	}

	/**
	 * Текущая вкладка.
	 *
	 * @return string
	 */
	protected function tab() {
		$tab = isset( $_GET['tab'] ) ? sanitize_key( wp_unslash( $_GET['tab'] ) ) : 'sms'; // phpcs:ignore WordPress.Security.NonceVerification.Recommended

		return in_array( $tab, array( 'sms', 'forms', 'account', 'orders', 'design', 'tools' ), true ) ? $tab : 'sms';
	}

	/**
	 * Вывод страницы.
	 */
	public function render() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		$tab = $this->tab();
		$s   = VL_Account_Settings::all();

		$tabs = array(
			'sms'     => __( 'SMS.RU', 'vl-account' ),
			'forms'   => __( 'Вход и регистрация', 'vl-account' ),
			'account' => __( 'Личный кабинет', 'vl-account' ),
			'orders'  => __( 'Заказы и письма', 'vl-account' ),
			'design'  => __( 'Оформление', 'vl-account' ),
			'tools'   => __( 'Диагностика', 'vl-account' ),
		);
		?>
		<div class="wrap vlacc-admin">
			<h1><?php esc_html_e( 'Личный кабинет и вход по SMS', 'vl-account' ); ?></h1>

			<?php $this->notices(); ?>

			<h2 class="nav-tab-wrapper">
				<?php foreach ( $tabs as $slug => $label ) : ?>
					<a class="nav-tab <?php echo $tab === $slug ? 'nav-tab-active' : ''; ?>"
						href="<?php echo esc_url( admin_url( 'admin.php?page=vl-account&tab=' . $slug ) ); ?>"><?php echo esc_html( $label ); ?></a>
				<?php endforeach; ?>
			</h2>

			<?php if ( 'tools' === $tab ) : ?>
				<?php $this->render_tools(); ?>
			<?php else : ?>
				<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
					<input type="hidden" name="action" value="vlacc_save_settings" />
					<input type="hidden" name="tab" value="<?php echo esc_attr( $tab ); ?>" />
					<?php wp_nonce_field( 'vlacc_save_settings' ); ?>

					<?php $this->{'render_' . $tab}( $s ); ?>

					<?php submit_button( __( 'Сохранить', 'vl-account' ) ); ?>
				</form>
			<?php endif; ?>
		</div>
		<?php
	}

	/**
	 * Уведомления после действий.
	 */
	protected function notices() {
		// phpcs:disable WordPress.Security.NonceVerification.Recommended
		if ( ! empty( $_GET['vlacc_msg'] ) ) {
			$messages = array(
				'saved'      => __( 'Настройки сохранены.', 'vl-account' ),
				'flushed'    => __( 'Постоянные ссылки обновлены.', 'vl-account' ),
				'log_clear'  => __( 'Журнал очищен.', 'vl-account' ),
			);

			$key = sanitize_key( wp_unslash( $_GET['vlacc_msg'] ) );

			if ( isset( $messages[ $key ] ) ) {
				printf( '<div class="notice notice-success is-dismissible"><p>%s</p></div>', esc_html( $messages[ $key ] ) );
			}
		}

		if ( ! empty( $_GET['vlacc_sms'] ) ) {
			$text = sanitize_text_field( wp_unslash( $_GET['vlacc_sms'] ) );
			$ok   = ! empty( $_GET['vlacc_sms_ok'] );

			printf(
				'<div class="notice notice-%s is-dismissible"><p>%s</p></div>',
				$ok ? 'success' : 'error',
				esc_html( $text )
			);
		}
		// phpcs:enable
	}

	/**
	 * Поле-чекбокс.
	 *
	 * @param string $name  Имя.
	 * @param array  $s     Настройки.
	 * @param string $label Подпись.
	 * @param string $desc  Описание.
	 */
	protected function checkbox( $name, $s, $label, $desc = '' ) {
		?>
		<tr>
			<th scope="row"><?php echo esc_html( $label ); ?></th>
			<td>
				<label>
					<input type="checkbox" name="vlacc[<?php echo esc_attr( $name ); ?>]" value="1" <?php checked( ! empty( $s[ $name ] ) ); ?> />
					<?php echo esc_html( $desc ); ?>
				</label>
			</td>
		</tr>
		<?php
	}

	/**
	 * Текстовое поле.
	 *
	 * @param string $name  Имя.
	 * @param array  $s     Настройки.
	 * @param string $label Подпись.
	 * @param string $desc  Описание.
	 * @param string $type  Тип поля.
	 */
	protected function text( $name, $s, $label, $desc = '', $type = 'text' ) {
		?>
		<tr>
			<th scope="row"><label for="vlacc-<?php echo esc_attr( $name ); ?>"><?php echo esc_html( $label ); ?></label></th>
			<td>
				<input type="<?php echo esc_attr( $type ); ?>" id="vlacc-<?php echo esc_attr( $name ); ?>"
					name="vlacc[<?php echo esc_attr( $name ); ?>]"
					value="<?php echo esc_attr( isset( $s[ $name ] ) ? $s[ $name ] : '' ); ?>"
					class="regular-text" />
				<?php if ( $desc ) : ?>
					<p class="description"><?php echo wp_kses_post( $desc ); ?></p>
				<?php endif; ?>
			</td>
		</tr>
		<?php
	}

	/**
	 * Выпадающий список.
	 *
	 * @param string $name    Имя.
	 * @param array  $s       Настройки.
	 * @param string $label   Подпись.
	 * @param array  $options Варианты.
	 * @param string $desc    Описание.
	 */
	protected function select( $name, $s, $label, $options, $desc = '' ) {
		?>
		<tr>
			<th scope="row"><label for="vlacc-<?php echo esc_attr( $name ); ?>"><?php echo esc_html( $label ); ?></label></th>
			<td>
				<select id="vlacc-<?php echo esc_attr( $name ); ?>" name="vlacc[<?php echo esc_attr( $name ); ?>]">
					<?php foreach ( $options as $value => $title ) : ?>
						<option value="<?php echo esc_attr( $value ); ?>" <?php selected( isset( $s[ $name ] ) ? $s[ $name ] : '', $value ); ?>><?php echo esc_html( $title ); ?></option>
					<?php endforeach; ?>
				</select>
				<?php if ( $desc ) : ?>
					<p class="description"><?php echo wp_kses_post( $desc ); ?></p>
				<?php endif; ?>
			</td>
		</tr>
		<?php
	}

	/**
	 * Список страниц.
	 *
	 * @param string $name  Имя.
	 * @param array  $s     Настройки.
	 * @param string $label Подпись.
	 * @param string $desc  Описание.
	 */
	protected function page_select( $name, $s, $label, $desc = '' ) {
		?>
		<tr>
			<th scope="row"><label for="vlacc-<?php echo esc_attr( $name ); ?>"><?php echo esc_html( $label ); ?></label></th>
			<td>
				<?php
				wp_dropdown_pages(
					array(
						'name'              => 'vlacc[' . $name . ']',
						'id'                => 'vlacc-' . $name,
						'selected'          => isset( $s[ $name ] ) ? (int) $s[ $name ] : 0,
						'show_option_none'  => __( '— не выбрано —', 'vl-account' ),
						'option_none_value' => 0,
					)
				);
				?>
				<?php if ( $desc ) : ?>
					<p class="description"><?php echo wp_kses_post( $desc ); ?></p>
				<?php endif; ?>
			</td>
		</tr>
		<?php
	}

	/**
	 * Вкладка SMS.RU.
	 *
	 * @param array $s Настройки.
	 */
	protected function render_sms( $s ) {
		?>
		<table class="form-table" role="presentation">
			<?php
			$this->text(
				'api_id',
				$s,
				__( 'api_id SMS.RU', 'vl-account' ),
				__( 'Личный кабинет SMS.RU → главная страница → блок «Ваш api_id». Ключ даёт полный доступ к рассылкам — не публикуйте его.', 'vl-account' )
			);

			$this->text(
				'sms_from',
				$s,
				__( 'Имя отправителя', 'vl-account' ),
				__( 'Только согласованное с операторами имя (раздел «Отправители» в SMS.RU). Пусто — отправка от общего имени.', 'vl-account' )
			);

			$this->select(
				'delivery_method',
				$s,
				__( 'Как отправлять код', 'vl-account' ),
				array(
					'sms'           => __( 'SMS с кодом', 'vl-account' ),
					'call'          => __( 'Звонок: код — последние 4 цифры номера (дешевле)', 'vl-account' ),
					'sms_then_call' => __( 'Сначала звонок, если не вышло — SMS', 'vl-account' ),
				),
				__( 'Авторизация звонком в SMS.RU обычно дешевле SMS и не требует согласования имени отправителя.', 'vl-account' )
			);

			$this->text(
				'sms_text',
				$s,
				__( 'Текст SMS', 'vl-account' ),
				__( 'Метка <code>{code}</code> — сам код, <code>{site}</code> — название сайта.', 'vl-account' )
			);

			$this->checkbox( 'test_mode', $s, __( 'Тестовый режим', 'vl-account' ), __( 'Запросы уходят с параметром test=1: SMS.RU отвечает как обычно, но сообщение не отправляется и деньги не списываются.', 'vl-account' ) );
			$this->checkbox( 'debug_show_code', $s, __( 'Показывать код на экране', 'vl-account' ), __( 'Только для отладки на тестовом сайте! На рабочем сайте обязательно выключить.', 'vl-account' ) );
			?>
		</table>

		<h2><?php esc_html_e( 'Ограничения отправки', 'vl-account' ); ?></h2>
		<table class="form-table" role="presentation">
			<?php
			$this->text( 'code_length', $s, __( 'Длина кода', 'vl-account' ), __( 'Для авторизации звонком всегда 4 цифры.', 'vl-account' ), 'number' );
			$this->text( 'code_ttl', $s, __( 'Срок жизни кода, сек.', 'vl-account' ), '', 'number' );
			$this->text( 'resend_timeout', $s, __( 'Пауза между отправками, сек.', 'vl-account' ), '', 'number' );
			$this->text( 'max_attempts', $s, __( 'Попыток ввода кода', 'vl-account' ), '', 'number' );
			$this->text( 'max_per_phone_day', $s, __( 'Кодов на номер в сутки', 'vl-account' ), '', 'number' );
			$this->text( 'max_per_ip_hour', $s, __( 'Кодов с одного IP в час', 'vl-account' ), __( 'Защита от перебора и слива баланса.', 'vl-account' ), 'number' );
			?>
		</table>
		<?php
	}

	/**
	 * Вкладка форм.
	 *
	 * @param array $s Настройки.
	 */
	protected function render_forms( $s ) {
		?>
		<table class="form-table" role="presentation">
			<?php
			$this->select(
				'auth_mode',
				$s,
				__( 'Способы входа', 'vl-account' ),
				array(
					'sms'  => __( 'Только по коду из SMS', 'vl-account' ),
					'both' => __( 'По коду из SMS и по паролю', 'vl-account' ),
				)
			);

			$this->checkbox( 'passwordless', $s, __( 'Регистрация без пароля', 'vl-account' ), __( 'Пароль не спрашиваем: вход по коду. Задать пароль можно позже в кабинете.', 'vl-account' ) );
			$this->checkbox( 'auto_register', $s, __( 'Регистрация «на лету»', 'vl-account' ), __( 'Незнакомый номер — сразу предлагаем короткую форму регистрации.', 'vl-account' ) );
			$this->checkbox( 'require_email', $s, __( 'E-mail обязателен', 'vl-account' ), __( 'Нужен для писем о заказах и восстановления доступа.', 'vl-account' ) );
			$this->checkbox( 'require_name', $s, __( 'Имя обязательно', 'vl-account' ), '' );
			$this->checkbox( 'show_telegram', $s, __( 'Поле Telegram', 'vl-account' ), __( 'Показывать поле Telegram в форме регистрации и в кабинете.', 'vl-account' ) );
			$this->text( 'cookie_days', $s, __( 'Помнить вход, дней', 'vl-account' ), __( 'Сколько посетитель остаётся авторизованным.', 'vl-account' ), 'number' );
			$this->text( 'phone_mask', $s, __( 'Маска телефона', 'vl-account' ), __( 'Например <code>+7 (___) ___-__-__</code>. Оставьте пустым, чтобы отключить маску.', 'vl-account' ) );
			$this->text( 'default_country', $s, __( 'Код страны по умолчанию', 'vl-account' ), __( 'Подставляется, если номер введён без кода.', 'vl-account' ) );
			?>
		</table>

		<h2><?php esc_html_e( 'Согласия', 'vl-account' ); ?></h2>
		<table class="form-table" role="presentation">
			<?php
			$this->checkbox( 'consent_privacy', $s, __( 'Согласие на обработку данных', 'vl-account' ), __( 'Обязательная галочка в форме регистрации.', 'vl-account' ) );
			$this->text( 'consent_privacy_text', $s, __( 'Текст согласия', 'vl-account' ), __( '<code>%s</code> заменится ссылкой на страницу политики.', 'vl-account' ) );
			$this->page_select( 'privacy_page', $s, __( 'Страница политики', 'vl-account' ) );
			$this->checkbox( 'consent_marketing', $s, __( 'Согласие на рассылки', 'vl-account' ), __( 'Отдельная необязательная галочка — согласие на рекламные рассылки.', 'vl-account' ) );
			$this->text( 'consent_marketing_text', $s, __( 'Текст согласия на рассылки', 'vl-account' ) );
			?>
		</table>
		<?php
	}

	/**
	 * Вкладка кабинета.
	 *
	 * @param array $s Настройки.
	 */
	protected function render_account( $s ) {
		$tabs = array(
			'dashboard'     => __( 'Обзор', 'vl-account' ),
			'orders'        => __( 'Мои заказы', 'vl-account' ),
			'wishlist'      => __( 'Избранное', 'vl-account' ),
			'promo'         => __( 'Промокоды', 'vl-account' ),
			'bonus'         => __( 'Бонусы', 'vl-account' ),
			'subscriptions' => __( 'Подписки', 'vl-account' ),
			'profile'       => __( 'Мои данные', 'vl-account' ),
			'security'      => __( 'Пароль и вход', 'vl-account' ),
		);

		$enabled = (array) ( isset( $s['tabs'] ) ? $s['tabs'] : array() );
		?>
		<table class="form-table" role="presentation">
			<?php
			$this->page_select( 'account_page', $s, __( 'Страница кабинета', 'vl-account' ), __( 'Страница с шорткодом <code>[vl_account]</code>. Если не выбрать — используется страница «Мой аккаунт» WooCommerce.', 'vl-account' ) );
			$this->page_select( 'auth_page', $s, __( 'Страница входа', 'vl-account' ), __( 'Страница с шорткодом <code>[vl_auth]</code>. Туда ведут иконка входа и все ссылки «войти».', 'vl-account' ) );
			$this->page_select( 'loyalty_page', $s, __( 'Условия программы лояльности', 'vl-account' ), __( 'Ссылка на неё появится в разделе «Бонусы».', 'vl-account' ) );
			?>
			<tr>
				<th scope="row"><?php esc_html_e( 'Разделы кабинета', 'vl-account' ); ?></th>
				<td>
					<?php foreach ( $tabs as $slug => $label ) : ?>
						<label style="display:block;margin-bottom:4px">
							<input type="checkbox" name="vlacc[tabs][]" value="<?php echo esc_attr( $slug ); ?>"
								<?php checked( in_array( $slug, $enabled, true ) ); ?> />
							<?php echo esc_html( $label ); ?>
						</label>
					<?php endforeach; ?>
				</td>
			</tr>
			<?php $this->checkbox( 'wishlist_on_product', $s, __( 'Кнопка «в избранное» в карточке', 'vl-account' ), __( 'Добавить кнопку на страницу товара автоматически. Если на сайте уже есть своя кнопка — не включайте, используйте шорткод.', 'vl-account' ) ); ?>
		</table>

		<h2><?php esc_html_e( 'Промокод за регистрацию', 'vl-account' ); ?></h2>
		<table class="form-table" role="presentation">
			<?php
			$this->select(
				'promo_mode',
				$s,
				__( 'Режим', 'vl-account' ),
				array(
					'none'     => __( 'Не выдавать', 'vl-account' ),
					'shared'   => __( 'Один общий код для всех', 'vl-account' ),
					'personal' => __( 'Персональный купон каждому', 'vl-account' ),
				),
				__( 'Выданный промокод виден в кабинете в разделе «Промокоды» и приходит в письме.', 'vl-account' )
			);
			$this->text( 'promo_shared_code', $s, __( 'Общий код', 'vl-account' ), __( 'Код существующего купона WooCommerce.', 'vl-account' ) );
			$this->text( 'promo_prefix', $s, __( 'Префикс персонального кода', 'vl-account' ) );
			$this->text( 'promo_discount', $s, __( 'Скидка, %', 'vl-account' ), '', 'number' );
			$this->text( 'promo_days', $s, __( 'Срок действия, дней', 'vl-account' ), '', 'number' );
			?>
		</table>
		<?php
	}

	/**
	 * Вкладка заказов и писем.
	 *
	 * @param array $s Настройки.
	 */
	protected function render_orders( $s ) {
		?>
		<table class="form-table" role="presentation">
			<?php
			$this->checkbox( 'auto_create_account', $s, __( 'Создавать кабинет при заказе', 'vl-account' ), __( 'Если покупатель оформил заказ без входа — заводим аккаунт и отправляем письмо с доступом.', 'vl-account' ) );
			$this->checkbox( 'attach_guest_orders', $s, __( 'Подтягивать прошлые заказы', 'vl-account' ), __( 'При входе привязываем к аккаунту заказы, оформленные с тем же e-mail или телефоном.', 'vl-account' ) );
			$this->checkbox( 'match_by_phone', $s, __( 'Искать заказы по телефону', 'vl-account' ), __( 'Учитываются все варианты записи номера: +7, 8, со скобками и без.', 'vl-account' ) );
			$this->checkbox( 'email_on_register', $s, __( 'Письмо после регистрации', 'vl-account' ), '' );
			$this->checkbox( 'email_on_autocreate', $s, __( 'Письмо при автосоздании кабинета', 'vl-account' ), '' );
			?>
		</table>
		<?php
	}

	/**
	 * Вкладка оформления.
	 *
	 * @param array $s Настройки.
	 */
	protected function render_design( $s ) {
		?>
		<table class="form-table" role="presentation">
			<?php
			$this->text( 'accent_color', $s, __( 'Акцентный цвет', 'vl-account' ), __( 'Кнопка «зарегистрироваться», активные пункты меню.', 'vl-account' ), 'color' );
			$this->text( 'button_color', $s, __( 'Цвет тёмной кнопки', 'vl-account' ), __( 'Кнопка «войти».', 'vl-account' ), 'color' );
			$this->text( 'radius', $s, __( 'Скругление углов, px', 'vl-account' ), __( '0 — прямые углы, как в оформлении сайта.', 'vl-account' ), 'number' );
			?>
		</table>

		<h2><?php esc_html_e( 'Шорткоды', 'vl-account' ); ?></h2>
		<table class="widefat striped" style="max-width:900px">
			<tbody>
				<?php
				$shortcodes = array(
					'[vl_auth]'                     => __( 'Вход + регистрация с переключателем', 'vl-account' ),
					'[vl_login]'                    => __( 'Только форма входа', 'vl-account' ),
					'[vl_register]'                 => __( 'Только форма регистрации', 'vl-account' ),
					'[vl_lost_password]'            => __( 'Восстановление доступа', 'vl-account' ),
					'[vl_account]'                  => __( 'Личный кабинет целиком', 'vl-account' ),
					'[vl_account_menu]'             => __( 'Только меню кабинета', 'vl-account' ),
					'[vl_account_icon]'             => __( 'Иконки в шапке: человечек — вход/кабинет, стрелка — выход', 'vl-account' ),
					'[vl_wishlist_button]'          => __( 'Кнопка «в избранное» (в карточке товара)', 'vl-account' ),
					'[vl_wishlist_count]'           => __( 'Счётчик избранного для шапки', 'vl-account' ),
					'[vl_user_name]'                => __( 'Имя текущего покупателя', 'vl-account' ),
				);

				foreach ( $shortcodes as $code => $desc ) :
					?>
					<tr>
						<td style="width:220px"><code><?php echo esc_html( $code ); ?></code></td>
						<td><?php echo esc_html( $desc ); ?></td>
					</tr>
					<?php
				endforeach;
				?>
			</tbody>
		</table>
		<p class="description">
			<?php esc_html_e( 'Дополнительные атрибуты: [vl_auth redirect="/my-account/" default_tab="register"], [vl_account_icon size="22" show_logout="no" show_label="yes"].', 'vl-account' ); ?>
		</p>
		<?php
	}

	/**
	 * Вкладка диагностики.
	 */
	protected function render_tools() {
		$checks = $this->diagnostics();
		?>
		<h2><?php esc_html_e( 'Проверка настроек', 'vl-account' ); ?></h2>
		<table class="widefat striped" style="max-width:900px">
			<tbody>
				<?php foreach ( $checks as $check ) : ?>
					<tr>
						<td style="width:32px">
							<span style="color:<?php echo 'ok' === $check['status'] ? '#2a9d3f' : ( 'warn' === $check['status'] ? '#d98f00' : '#d40000' ); ?>;font-size:18px">●</span>
						</td>
						<td style="width:280px"><strong><?php echo esc_html( $check['title'] ); ?></strong></td>
						<td><?php echo wp_kses_post( $check['text'] ); ?></td>
					</tr>
				<?php endforeach; ?>
			</tbody>
		</table>

		<h2><?php esc_html_e( 'Тестовая отправка', 'vl-account' ); ?></h2>
		<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
			<input type="hidden" name="action" value="vlacc_test_sms" />
			<?php wp_nonce_field( 'vlacc_test_sms' ); ?>
			<p>
				<input type="text" name="phone" placeholder="+7 926 000-00-00" class="regular-text" />
				<?php submit_button( __( 'Отправить тестовый код', 'vl-account' ), 'secondary', 'submit', false ); ?>
			</p>
			<p class="description"><?php esc_html_e( 'Отправка идёт выбранным способом (SMS или звонок) и списывает деньги с баланса, если выключен тестовый режим.', 'vl-account' ); ?></p>
		</form>

		<h2><?php esc_html_e( 'Служебное', 'vl-account' ); ?></h2>
		<p>
			<a class="button" href="<?php echo esc_url( wp_nonce_url( admin_url( 'admin-post.php?action=vlacc_flush_rules' ), 'vlacc_flush_rules' ) ); ?>">
				<?php esc_html_e( 'Обновить постоянные ссылки', 'vl-account' ); ?>
			</a>
			<a class="button" href="<?php echo esc_url( wp_nonce_url( admin_url( 'admin-post.php?action=vlacc_clear_log' ), 'vlacc_clear_log' ) ); ?>">
				<?php esc_html_e( 'Очистить журнал', 'vl-account' ); ?>
			</a>
		</p>

		<h2><?php esc_html_e( 'Журнал', 'vl-account' ); ?></h2>
		<?php
		$log = get_option( 'vlacc_log', array() );

		if ( ! $log ) {
			echo '<p>' . esc_html__( 'Пока пусто.', 'vl-account' ) . '</p>';
			return;
		}
		?>
		<table class="widefat striped" style="max-width:900px">
			<thead>
				<tr>
					<th style="width:160px"><?php esc_html_e( 'Время', 'vl-account' ); ?></th>
					<th><?php esc_html_e( 'Событие', 'vl-account' ); ?></th>
				</tr>
			</thead>
			<tbody>
				<?php foreach ( array_slice( $log, 0, 50 ) as $row ) : ?>
					<tr>
						<td><?php echo esc_html( $row['time'] ); ?></td>
						<td>
							<?php echo esc_html( $row['message'] ); ?>
							<?php if ( ! empty( $row['context'] ) ) : ?>
								<br><code style="font-size:11px"><?php echo esc_html( wp_json_encode( $row['context'], JSON_UNESCAPED_UNICODE ) ); ?></code>
							<?php endif; ?>
						</td>
					</tr>
				<?php endforeach; ?>
			</tbody>
		</table>
		<?php
	}

	/**
	 * Набор проверок.
	 *
	 * @return array
	 */
	protected function diagnostics() {
		$checks = array();

		// WooCommerce.
		$checks[] = array(
			'title'  => 'WooCommerce',
			'status' => vlacc_is_woo() ? 'ok' : 'warn',
			'text'   => vlacc_is_woo()
				? __( 'Активен — заказы, избранное и купоны работают.', 'vl-account' )
				: __( 'Не найден. Формы входа работать будут, разделы заказов и промокодов — нет.', 'vl-account' ),
		);

		// api_id.
		$api_ok = VL_Account_Settings::sms_ready();
		$text   = $api_ok ? __( 'Ключ указан.', 'vl-account' ) : __( 'Не заполнен — коды отправляться не будут.', 'vl-account' );

		if ( $api_ok ) {
			$balance = VL_Account_SmsRu::balance();

			if ( is_wp_error( $balance ) ) {
				$api_ok = false;
				$text   = sprintf(
					/* translators: %s — текст ошибки. */
					__( 'Ключ указан, но SMS.RU отвечает ошибкой: %s', 'vl-account' ),
					$balance->get_error_message()
				);
			} else {
				$text = sprintf(
					/* translators: %s — сумма баланса. */
					__( 'Связь есть. Баланс: %s ₽.', 'vl-account' ),
					number_format_i18n( $balance, 2 )
				);

				if ( $balance < 100 ) {
					$text .= ' ' . __( 'Баланса хватит ненадолго — пополните.', 'vl-account' );
				}
			}
		}

		$checks[] = array(
			'title'  => __( 'Подключение к SMS.RU', 'vl-account' ),
			'status' => $api_ok ? 'ok' : 'error',
			'text'   => $text,
		);

		// Имя отправителя.
		$from = trim( (string) VL_Account_Settings::get( 'sms_from', '' ) );

		if ( 'sms' === VL_Account_Settings::get( 'delivery_method', 'sms' ) ) {
			$checks[] = array(
				'title'  => __( 'Имя отправителя', 'vl-account' ),
				'status' => $from ? 'ok' : 'warn',
				'text'   => $from
					? sprintf(
						/* translators: %s — имя отправителя. */
						__( 'Используется имя «%s». Оно должно быть согласовано в разделе «Отправители» SMS.RU.', 'vl-account' ),
						esc_html( $from )
					)
					: __( 'Не задано — сообщения уйдут от общего имени SMS.RU. Это допустимо, но с фирменным именем доставляемость выше.', 'vl-account' ),
			);
		}

		// Отладочный вывод кода.
		if ( VL_Account_Settings::get( 'debug_show_code', 0 ) ) {
			$checks[] = array(
				'title'  => __( 'Показ кода на экране', 'vl-account' ),
				'status' => 'error',
				'text'   => __( 'Включён показ кода прямо в форме. На рабочем сайте это дыра в безопасности — выключите на вкладке SMS.RU.', 'vl-account' ),
			);
		}

		// Адрес сайта.
		$home = wp_parse_url( home_url(), PHP_URL_HOST );
		$site = wp_parse_url( site_url(), PHP_URL_HOST );

		$checks[] = array(
			'title'  => __( 'Адрес сайта', 'vl-account' ),
			'status' => $home === $site ? 'ok' : 'error',
			'text'   => $home === $site
				? __( 'Адреса сайта и WordPress совпадают.', 'vl-account' )
				: __( 'Адрес сайта и адрес WordPress различаются (например, с www и без). Из-за этого куки авторизации теряются при переходе между страницами — приведите оба адреса к одному виду в «Настройки → Общие».', 'vl-account' ),
		);

		// Кеш.
		if ( ! function_exists( 'is_plugin_active' ) ) {
			require_once ABSPATH . 'wp-admin/includes/plugin.php';
		}

		$cache_plugins = array(
			'wp-fastest-cache/wpFastestCache.php' => 'WP Fastest Cache',
			'litespeed-cache/litespeed-cache.php' => 'LiteSpeed Cache',
			'wp-rocket/wp-rocket.php'             => 'WP Rocket',
			'w3-total-cache/w3-total-cache.php'   => 'W3 Total Cache',
		);

		$active = array();

		foreach ( $cache_plugins as $file => $name ) {
			if ( is_plugin_active( $file ) ) {
				$active[] = $name;
			}
		}

		if ( $active ) {
			$checks[] = array(
				'title'  => __( 'Плагин кеширования', 'vl-account' ),
				'status' => VL_Account_Settings::get( 'no_cache', 1 ) ? 'warn' : 'error',
				'text'   => sprintf(
					/* translators: %s — названия плагинов кеширования. */
					__( 'Найден: %s. Плагин просит не кешировать страницы кабинета и залогиненных посетителей, но в настройках самого кеша тоже включите «не кешировать для авторизованных» и добавьте страницы входа/кабинета/корзины в исключения.', 'vl-account' ),
					esc_html( implode( ', ', $active ) )
				),
			);
		}

		// Страницы с шорткодами.
		$account_page = (int) VL_Account_Settings::get( 'account_page', 0 );
		$auth_page    = (int) VL_Account_Settings::get( 'auth_page', 0 );

		$checks[] = array(
			'title'  => __( 'Страница кабинета', 'vl-account' ),
			'status' => ( $account_page || vlacc_is_woo() ) ? 'ok' : 'warn',
			'text'   => $account_page
				? sprintf(
					/* translators: %s — ссылка на страницу. */
					__( 'Используется страница: %s', 'vl-account' ),
					'<a href="' . esc_url( get_permalink( $account_page ) ) . '" target="_blank">' . esc_html( get_the_title( $account_page ) ) . '</a>'
				)
				: __( 'Используется страница «Мой аккаунт» WooCommerce.', 'vl-account' ),
		);

		$checks[] = array(
			'title'  => __( 'Страница входа', 'vl-account' ),
			'status' => $auth_page ? 'ok' : 'warn',
			'text'   => $auth_page
				? sprintf(
					/* translators: %s — ссылка на страницу. */
					__( 'Используется страница: %s', 'vl-account' ),
					'<a href="' . esc_url( get_permalink( $auth_page ) ) . '" target="_blank">' . esc_html( get_the_title( $auth_page ) ) . '</a>'
				)
				: __( 'Не выбрана: ссылки «войти» ведут на страницу кабинета. Создайте страницу с шорткодом [vl_auth] и укажите её в настройках.', 'vl-account' ),
		);

		// ЧПУ.
		$checks[] = array(
			'title'  => __( 'Постоянные ссылки', 'vl-account' ),
			'status' => get_option( 'permalink_structure' ) ? 'ok' : 'warn',
			'text'   => get_option( 'permalink_structure' )
				? __( 'ЧПУ включены — разделы кабинета открываются красивыми адресами.', 'vl-account' )
				: __( 'ЧПУ выключены. Кабинет будет работать через параметры адреса — это нормально, но ссылки менее красивые.', 'vl-account' ),
		);

		return $checks;
	}

	/**
	 * Сохранение настроек.
	 */
	public function save() {
		if ( ! current_user_can( 'manage_options' ) || ! check_admin_referer( 'vlacc_save_settings' ) ) {
			wp_die( esc_html__( 'Недостаточно прав.', 'vl-account' ) );
		}

		$input = isset( $_POST['vlacc'] ) ? wp_unslash( $_POST['vlacc'] ) : array(); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized
		$tab   = isset( $_POST['tab'] ) ? sanitize_key( wp_unslash( $_POST['tab'] ) ) : 'sms';

		$current  = VL_Account_Settings::all();
		$defaults = VL_Account_Settings::defaults();

		// Чекбоксы текущей вкладки, которых нет в POST, сбрасываем в 0.
		$checkbox_map = array(
			'sms'     => array( 'test_mode', 'debug_show_code' ),
			'forms'   => array( 'passwordless', 'auto_register', 'require_email', 'require_name', 'show_telegram', 'consent_privacy', 'consent_marketing' ),
			'account' => array( 'wishlist_on_product' ),
			'orders'  => array( 'auto_create_account', 'attach_guest_orders', 'match_by_phone', 'email_on_register', 'email_on_autocreate' ),
			'design'  => array(),
		);

		$clean = array();

		foreach ( $input as $key => $value ) {
			if ( ! array_key_exists( $key, $defaults ) ) {
				continue;
			}

			if ( 'tabs' === $key ) {
				$clean['tabs'] = array_map( 'sanitize_key', (array) $value );
				continue;
			}

			if ( is_array( $value ) ) {
				$clean[ $key ] = array_map( 'sanitize_text_field', $value );
				continue;
			}

			if ( in_array( $key, array( 'consent_privacy_text', 'consent_marketing_text' ), true ) ) {
				$clean[ $key ] = wp_kses_post( $value );
				continue;
			}

			$clean[ $key ] = sanitize_text_field( $value );
		}

		if ( isset( $checkbox_map[ $tab ] ) ) {
			foreach ( $checkbox_map[ $tab ] as $key ) {
				if ( ! isset( $clean[ $key ] ) ) {
					$clean[ $key ] = 0;
				}
			}
		}

		// На вкладке кабинета список разделов может прийти пустым.
		if ( 'account' === $tab && ! isset( $clean['tabs'] ) ) {
			$clean['tabs'] = array();
		}

		VL_Account_Settings::update( array_merge( $current, $clean ) );

		do_action( 'vlacc_settings_saved', $clean );

		wp_safe_redirect( admin_url( 'admin.php?page=vl-account&tab=' . $tab . '&vlacc_msg=saved' ) );
		exit;
	}

	/**
	 * Тестовая отправка кода.
	 */
	public function test_sms() {
		if ( ! current_user_can( 'manage_options' ) || ! check_admin_referer( 'vlacc_test_sms' ) ) {
			wp_die( esc_html__( 'Недостаточно прав.', 'vl-account' ) );
		}

		$phone = isset( $_POST['phone'] ) ? sanitize_text_field( wp_unslash( $_POST['phone'] ) ) : '';
		$phone = VL_Account_Phone::normalize( $phone );

		if ( ! VL_Account_Phone::is_valid( $phone ) ) {
			$this->redirect_tools( __( 'Проверьте номер телефона.', 'vl-account' ), false );
		}

		$method = VL_Account_Settings::get( 'delivery_method', 'sms' );

		if ( 'call' === $method ) {
			$result = VL_Account_SmsRu::call_code( $phone );

			if ( ! empty( $result['success'] ) ) {
				$this->redirect_tools(
					sprintf(
						/* translators: %s — код подтверждения. */
						__( 'Звонок заказан. Код: %s (последние 4 цифры номера).', 'vl-account' ),
						$result['code']
					),
					true
				);
			}
		} else {
			$result = VL_Account_SmsRu::send_sms( $phone, __( 'Проверка связи с сайтом. Код: 1234', 'vl-account' ) );

			if ( ! empty( $result['success'] ) ) {
				$this->redirect_tools( __( 'SMS отправлено успешно.', 'vl-account' ), true );
			}
		}

		$this->redirect_tools(
			sprintf(
				/* translators: %s — текст ошибки. */
				__( 'Не отправлено. Ответ SMS.RU: %s', 'vl-account' ),
				$result['message']
			),
			false
		);
	}

	/**
	 * Редирект с сообщением.
	 *
	 * @param string $message Сообщение.
	 * @param bool   $ok      Успех.
	 */
	protected function redirect_tools( $message, $ok ) {
		wp_safe_redirect(
			add_query_arg(
				array(
					'page'         => 'vl-account',
					'tab'          => 'tools',
					'vlacc_sms'    => rawurlencode( $message ),
					'vlacc_sms_ok' => $ok ? 1 : 0,
				),
				admin_url( 'admin.php' )
			)
		);
		exit;
	}

	/**
	 * Сброс правил ЧПУ.
	 */
	public function flush_rules() {
		if ( ! current_user_can( 'manage_options' ) || ! check_admin_referer( 'vlacc_flush_rules' ) ) {
			wp_die( esc_html__( 'Недостаточно прав.', 'vl-account' ) );
		}

		VL_Account_MyAccount::register_endpoints();
		flush_rewrite_rules();

		wp_safe_redirect( admin_url( 'admin.php?page=vl-account&tab=tools&vlacc_msg=flushed' ) );
		exit;
	}

	/**
	 * Очистка журнала.
	 */
	public function clear_log() {
		if ( ! current_user_can( 'manage_options' ) || ! check_admin_referer( 'vlacc_clear_log' ) ) {
			wp_die( esc_html__( 'Недостаточно прав.', 'vl-account' ) );
		}

		delete_option( 'vlacc_log' );

		wp_safe_redirect( admin_url( 'admin.php?page=vl-account&tab=tools&vlacc_msg=log_clear' ) );
		exit;
	}
}

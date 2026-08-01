<?php
/**
 * Заказы в личном кабинете.
 *
 * Закрывает задачи:
 *  — «Настроить попадание всех заказов в личный кабинет»;
 *  — «Организовать автосоздание ЛК при заказе + письмо с доступом».
 *
 * @package VL_Account
 */

defined( 'ABSPATH' ) || exit;

/**
 * Заказы.
 */
class VL_Account_Orders {

	/**
	 * Экземпляр.
	 *
	 * @var VL_Account_Orders|null
	 */
	private static $instance = null;

	/**
	 * Получить экземпляр.
	 *
	 * @return VL_Account_Orders
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
		if ( ! vlacc_is_woo() ) {
			return;
		}

		add_action( 'woocommerce_checkout_order_processed', array( $this, 'after_checkout' ), 20, 3 );
		add_action( 'woocommerce_store_api_checkout_order_processed', array( $this, 'after_checkout_blocks' ), 20 );

		// Подсказка на оформлении заказа для незарегистрированных.
		add_action( 'woocommerce_after_checkout_billing_form', array( $this, 'checkout_notice' ) );

		// Телефон из заказа сохраняем пользователю в нормализованном виде.
		add_action( 'woocommerce_checkout_update_customer', array( $this, 'sync_phone' ), 10, 2 );
	}

	/**
	 * Обработка после оформления заказа (классический чекаут).
	 *
	 * @param int   $order_id Заказ.
	 * @param array $posted   Данные формы.
	 * @param mixed $order    Объект заказа.
	 */
	public function after_checkout( $order_id, $posted = array(), $order = null ) {
		$order = $order instanceof WC_Order ? $order : wc_get_order( $order_id );

		if ( $order ) {
			$this->process_order( $order );
		}
	}

	/**
	 * То же для блочного чекаута (Store API).
	 *
	 * @param WC_Order $order Заказ.
	 */
	public function after_checkout_blocks( $order ) {
		if ( $order instanceof WC_Order ) {
			$this->process_order( $order );
		}
	}

	/**
	 * Привязка заказа к аккаунту или создание аккаунта.
	 *
	 * @param WC_Order $order Заказ.
	 */
	protected function process_order( $order ) {
		if ( $order->get_customer_id() ) {
			// Заказ уже за пользователем — просто обновим телефон.
			$this->store_phone_from_order( $order->get_customer_id(), $order );
			return;
		}

		$email = $order->get_billing_email();
		$phone = VL_Account_Phone::normalize( $order->get_billing_phone() );

		// 1. Пользователь уже есть — привязываем заказ.
		$user = false;

		if ( $email ) {
			$user = get_user_by( 'email', $email );
		}

		if ( ! $user && $phone && VL_Account_Settings::get( 'match_by_phone', 1 ) ) {
			$user = VL_Account_User::get_by_phone( $phone );
		}

		if ( $user ) {
			$order->set_customer_id( $user->ID );
			$order->save();
			$this->store_phone_from_order( $user->ID, $order );

			vlacc_log(
				'Заказ привязан к существующему аккаунту',
				array(
					'order'   => $order->get_id(),
					'user_id' => $user->ID,
				)
			);
			return;
		}

		// 2. Автосоздание кабинета.
		if ( ! VL_Account_Settings::get( 'auto_create_account', 1 ) ) {
			return;
		}

		if ( ! $email && ! $phone ) {
			return;
		}

		$user_id = VL_Account_User::create(
			array(
				'phone'      => $phone,
				'email'      => $email,
				'first_name' => $order->get_billing_first_name(),
				'last_name'  => $order->get_billing_last_name(),
				'consents'   => array( 'privacy' => true ),
				'source'     => 'checkout',
			)
		);

		if ( is_wp_error( $user_id ) ) {
			vlacc_log(
				'Не удалось создать кабинет по заказу',
				array(
					'order' => $order->get_id(),
					'error' => $user_id->get_error_message(),
				)
			);
			return;
		}

		$order->set_customer_id( $user_id );
		$order->save();

		// Остальные заказы этого покупателя тоже подтянем.
		self::attach_guest_orders( $user_id );

		do_action( 'vlacc_account_created_from_order', $user_id, $order );

		vlacc_log(
			'Кабинет создан по заказу',
			array(
				'order'   => $order->get_id(),
				'user_id' => $user_id,
			)
		);
	}

	/**
	 * Сохранить нормализованный телефон пользователю.
	 *
	 * @param int      $user_id Пользователь.
	 * @param WC_Order $order   Заказ.
	 */
	protected function store_phone_from_order( $user_id, $order ) {
		$phone = VL_Account_Phone::normalize( $order->get_billing_phone() );

		if ( $phone && ! get_user_meta( $user_id, VL_Account_User::META_PHONE, true ) ) {
			update_user_meta( $user_id, VL_Account_User::META_PHONE, $phone );
		}
	}

	/**
	 * Синхронизация телефона покупателя при оформлении.
	 *
	 * @param WC_Customer $customer Покупатель.
	 * @param array       $data     Данные.
	 */
	public function sync_phone( $customer, $data = array() ) {
		if ( ! $customer instanceof WC_Customer || ! $customer->get_id() ) {
			return;
		}

		$phone = VL_Account_Phone::normalize( $customer->get_billing_phone() );

		if ( $phone ) {
			update_user_meta( $customer->get_id(), VL_Account_User::META_PHONE, $phone );
		}
	}

	/**
	 * Привязать гостевые заказы к аккаунту по e-mail и телефону.
	 *
	 * @param int $user_id Пользователь.
	 * @return int Сколько заказов привязали.
	 */
	public static function attach_guest_orders( $user_id ) {
		if ( ! vlacc_is_woo() || ! VL_Account_Settings::get( 'attach_guest_orders', 1 ) ) {
			return 0;
		}

		$user = get_user_by( 'id', $user_id );

		if ( ! $user ) {
			return 0;
		}

		$orders = array();

		if ( VL_Account_User::has_real_email( $user ) ) {
			$by_email = wc_get_orders(
				array(
					'billing_email' => $user->user_email,
					'limit'         => 100,
					'type'          => 'shop_order',
					'return'        => 'objects',
				)
			);

			if ( is_array( $by_email ) ) {
				// Страховка: если версия WooCommerce не поддержала фильтр,
				// перепроверяем совпадение сами, чтобы не привязать чужие заказы.
				foreach ( $by_email as $order ) {
					if ( $order instanceof WC_Order && strtolower( $order->get_billing_email() ) === strtolower( $user->user_email ) ) {
						$orders[] = $order;
					}
				}
			}
		}

		$phone = VL_Account_User::get_phone( $user_id );

		if ( $phone && VL_Account_Settings::get( 'match_by_phone', 1 ) ) {
			$by_phone = self::find_orders_by_phone( $phone );
			$orders   = array_merge( $orders, $by_phone );
		}

		$attached = 0;

		foreach ( $orders as $order ) {
			if ( ! $order instanceof WC_Order || $order->get_customer_id() ) {
				continue;
			}

			$order->set_customer_id( $user_id );
			$order->save();
			++$attached;
		}

		if ( $attached ) {
			vlacc_log(
				'Гостевые заказы привязаны к кабинету',
				array(
					'user_id' => $user_id,
					'count'   => $attached,
				)
			);
		}

		return $attached;
	}

	/**
	 * Поиск заказов по телефону во всех вариантах записи.
	 *
	 * @param string $phone Телефон.
	 * @return array
	 */
	public static function find_orders_by_phone( $phone ) {
		$variants = VL_Account_Phone::variants( $phone );

		if ( ! $variants ) {
			return array();
		}

		$normalized = VL_Account_Phone::normalize( $phone );
		$found      = array();

		foreach ( $variants as $variant ) {
			$orders = wc_get_orders(
				array(
					'limit'         => 50,
					'type'          => 'shop_order',
					'billing_phone' => $variant,
					'return'        => 'objects',
				)
			);

			if ( ! is_array( $orders ) ) {
				continue;
			}

			foreach ( $orders as $order ) {
				if ( ! $order instanceof WC_Order ) {
					continue;
				}

				// Обязательная перепроверка: некоторые сборки WooCommerce молча
				// игнорируют неизвестный параметр запроса и возвращают все заказы.
				if ( VL_Account_Phone::normalize( $order->get_billing_phone() ) !== $normalized ) {
					continue;
				}

				$found[ $order->get_id() ] = $order;
			}
		}

		return array_values( $found );
	}

	/**
	 * Заказы пользователя для кабинета.
	 *
	 * Берём и привязанные заказы, и заказы, оформленные тем же e-mail/телефоном
	 * без входа в аккаунт — чтобы в кабинете была полная история.
	 *
	 * @param int $user_id Пользователь.
	 * @param int $limit   Сколько заказов.
	 * @return WC_Order[]
	 */
	public static function get_user_orders( $user_id, $limit = 20 ) {
		if ( ! vlacc_is_woo() ) {
			return array();
		}

		$statuses = array_keys( wc_get_order_statuses() );

		$orders = wc_get_orders(
			array(
				'customer_id' => $user_id,
				'limit'       => $limit,
				'orderby'     => 'date',
				'order'       => 'DESC',
				'status'      => $statuses,
				'type'        => 'shop_order',
				'return'      => 'objects',
			)
		);

		$orders = is_array( $orders ) ? $orders : array();
		$result = array();

		foreach ( $orders as $order ) {
			if ( $order instanceof WC_Order ) {
				$result[ $order->get_id() ] = $order;
			}
		}

		// Гостевые заказы с тем же e-mail.
		$user = get_user_by( 'id', $user_id );

		if ( $user && VL_Account_User::has_real_email( $user ) ) {
			$guest = wc_get_orders(
				array(
					'billing_email' => $user->user_email,
					'limit'         => $limit,
					'orderby'       => 'date',
					'order'         => 'DESC',
					'status'        => $statuses,
					'type'          => 'shop_order',
					'return'        => 'objects',
				)
			);

			if ( is_array( $guest ) ) {
				foreach ( $guest as $order ) {
					if ( ! $order instanceof WC_Order || isset( $result[ $order->get_id() ] ) ) {
						continue;
					}

					if ( strtolower( $order->get_billing_email() ) !== strtolower( $user->user_email ) ) {
						continue;
					}

					$result[ $order->get_id() ] = $order;
				}
			}
		}

		uasort(
			$result,
			static function ( $a, $b ) {
				$da = $a->get_date_created() ? $a->get_date_created()->getTimestamp() : 0;
				$db = $b->get_date_created() ? $b->get_date_created()->getTimestamp() : 0;

				return $db <=> $da;
			}
		);

		return array_slice( array_values( $result ), 0, $limit );
	}

	/**
	 * Может ли пользователь смотреть заказ.
	 *
	 * @param WC_Order $order   Заказ.
	 * @param int      $user_id Пользователь.
	 * @return bool
	 */
	public static function can_view( $order, $user_id ) {
		if ( ! $order instanceof WC_Order ) {
			return false;
		}

		if ( (int) $order->get_customer_id() === (int) $user_id ) {
			return true;
		}

		$user = get_user_by( 'id', $user_id );

		if ( $user && VL_Account_User::has_real_email( $user ) && strtolower( $order->get_billing_email() ) === strtolower( $user->user_email ) ) {
			return true;
		}

		return user_can( $user_id, 'manage_woocommerce' );
	}

	/**
	 * Подсказка о кабинете на странице оформления заказа.
	 */
	public function checkout_notice() {
		if ( is_user_logged_in() || ! VL_Account_Settings::get( 'auto_create_account', 1 ) ) {
			return;
		}

		echo '<p class="vl-checkout-notice">' . esc_html__( 'После оформления мы создадим для вас личный кабинет и пришлём ссылку для входа — там будут все заказы, избранное и бонусы.', 'vl-account' ) . '</p>';
	}
}

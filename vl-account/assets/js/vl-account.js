/**
 * VL Account — логика форм входа/регистрации и кабинета.
 * Без внешних зависимостей.
 */
( function () {
	'use strict';

	if ( typeof window.VLACC === 'undefined' ) {
		return;
	}

	var cfg = window.VLACC;

	/* ------------------------------------------------------------------
	 * Вспомогательные функции
	 * ------------------------------------------------------------------ */

	function post( action, data ) {
		var body = new FormData();

		body.append( 'action', 'vlacc_' + action );
		body.append( 'nonce', cfg.nonce );

		Object.keys( data || {} ).forEach( function ( key ) {
			if ( data[ key ] !== undefined && data[ key ] !== null ) {
				body.append( key, data[ key ] );
			}
		} );

		return fetch( cfg.ajax_url, {
			method: 'POST',
			body: body,
			credentials: 'same-origin'
		} ).then( function ( response ) {
			return response.json().catch( function () {
				return { success: false, data: { message: cfg.i18n.network } };
			} );
		} ).catch( function () {
			return { success: false, data: { message: cfg.i18n.network } };
		} );
	}

	function qs( root, selector ) {
		return root ? root.querySelector( selector ) : null;
	}

	function qsa( root, selector ) {
		return root ? Array.prototype.slice.call( root.querySelectorAll( selector ) ) : [];
	}

	function message( form, text, type ) {
		var box = qs( form, '[data-vl-messages]' );

		if ( ! box ) {
			return;
		}

		if ( ! text ) {
			box.innerHTML = '';
			return;
		}

		box.innerHTML = '<div class="vl-message vl-message--' + ( type || 'info' ) + '"></div>';
		box.firstChild.textContent = text;

		if ( typeof box.scrollIntoView === 'function' ) {
			box.scrollIntoView( { behavior: 'smooth', block: 'nearest' } );
		}
	}

	function fieldErrors( form, errors ) {
		qsa( form, '.vl-field__error' ).forEach( function ( el ) {
			el.textContent = '';
			el.classList.remove( 'is-visible' );
		} );

		qsa( form, '.vl-input' ).forEach( function ( el ) {
			el.classList.remove( 'is-error' );
		} );

		if ( ! errors ) {
			return;
		}

		Object.keys( errors ).forEach( function ( name ) {
			var holder = qs( form, '[data-vl-error="' + name + '"]' );
			var input = qs( form, '[name="' + name + '"]' );

			if ( holder ) {
				holder.textContent = errors[ name ];
				holder.classList.add( 'is-visible' );
			}

			if ( input ) {
				input.classList.add( 'is-error' );
			}
		} );
	}

	function loading( button, state ) {
		if ( ! button ) {
			return;
		}

		if ( state ) {
			button.classList.add( 'is-loading' );
			button.dataset.vlLabel = button.textContent;
			button.textContent = cfg.i18n.sending;
		} else {
			button.classList.remove( 'is-loading' );

			if ( button.dataset.vlLabel ) {
				button.textContent = button.dataset.vlLabel;
				delete button.dataset.vlLabel;
			}
		}
	}

	function value( form, name ) {
		var el = qs( form, '[name="' + name + '"]' );

		return el ? el.value.trim() : '';
	}

	function checked( form, name ) {
		var el = qs( form, '[name="' + name + '"]' );

		return el && el.checked ? 1 : '';
	}

	function step( form, name ) {
		qsa( form, '[data-vl-step]' ).forEach( function ( el ) {
			el.classList.toggle( 'is-active', el.dataset.vlStep === name );
		} );

		var input = qs( form, '[data-vl-step="' + name + '"] input' );

		if ( input ) {
			setTimeout( function () {
				input.focus();
			}, 60 );
		}
	}

	function redirect( url ) {
		window.location.href = url || window.location.href;
	}

	/* ------------------------------------------------------------------
	 * Маска телефона
	 * ------------------------------------------------------------------ */

	function formatPhone( raw ) {
		var digits = ( raw || '' ).replace( /\D/g, '' );

		if ( ! digits ) {
			return '';
		}

		if ( digits[ 0 ] === '8' ) {
			digits = '7' + digits.slice( 1 );
		}

		if ( digits[ 0 ] === '9' ) {
			digits = '7' + digits;
		}

		if ( digits[ 0 ] !== '7' ) {
			return '+' + digits.slice( 0, 15 );
		}

		digits = digits.slice( 0, 11 );

		var out = '+7';

		if ( digits.length > 1 ) {
			out += ' (' + digits.slice( 1, 4 );
		}

		if ( digits.length >= 5 ) {
			out += ') ' + digits.slice( 4, 7 );
		}

		if ( digits.length >= 8 ) {
			out += '-' + digits.slice( 7, 9 );
		}

		if ( digits.length >= 10 ) {
			out += '-' + digits.slice( 9, 11 );
		}

		return out;
	}

	document.addEventListener( 'input', function ( event ) {
		var el = event.target;

		if ( ! el.matches || ! el.matches( '[data-vl-phone]' ) || ! cfg.phone_mask ) {
			return;
		}

		var start = el.selectionStart;
		var before = el.value.length;

		el.value = formatPhone( el.value );

		if ( start !== null && start < before ) {
			var shift = el.value.length - before;
			el.setSelectionRange( Math.max( 0, start + shift ), Math.max( 0, start + shift ) );
		}
	} );

	/* ------------------------------------------------------------------
	 * Таймер повторной отправки
	 * ------------------------------------------------------------------ */

	var timers = {};

	function startTimer( form, seconds ) {
		var button = qs( form, '[data-vl-action="resend"]' );

		if ( ! button ) {
			return;
		}

		var key = form.dataset.vlForm || 'form';
		var left = seconds || cfg.resend_wait;

		if ( timers[ key ] ) {
			clearInterval( timers[ key ] );
		}

		button.disabled = true;

		var tick = function () {
			if ( left <= 0 ) {
				clearInterval( timers[ key ] );
				button.disabled = false;
				button.textContent = cfg.i18n.resend;
				return;
			}

			button.textContent = cfg.i18n.wait.replace( '%d', left );
			left--;
		};

		tick();
		timers[ key ] = setInterval( tick, 1000 );
	}

	/* ------------------------------------------------------------------
	 * Действия
	 * ------------------------------------------------------------------ */

	function sendCode( form, button, purpose ) {
		var phone = value( form, 'phone' );

		fieldErrors( form, null );
		message( form, '' );

		if ( phone.replace( /\D/g, '' ).length < 10 ) {
			fieldErrors( form, { phone: cfg.i18n.bad_phone } );
			return;
		}

		loading( button, true );

		post( 'send_code', { phone: phone, purpose: purpose } ).then( function ( res ) {
			loading( button, false );

			if ( ! res.success ) {
				var data = res.data || {};

				message( form, data.message || cfg.i18n.network, 'error' );

				if ( data.wait ) {
					startTimer( form, data.wait );
				}

				if ( data.reload ) {
					setTimeout( function () {
						window.location.reload();
					}, 2500 );
				}

				return;
			}

			var payload = res.data || {};

			form.dataset.vlPhone = payload.phone || phone;

			var hint = qs( form, '[data-vl-code-hint]' );

			if ( hint ) {
				hint.textContent = payload.message || '';
			}

			var wrap = qs( form, '[data-vl-code-wrap]' );

			if ( wrap ) {
				wrap.hidden = false;
			}

			if ( qs( form, '[data-vl-step="code"]' ) ) {
				step( form, 'code' );
			}

			var codeInput = qs( form, '[data-vl-code]' );

			if ( codeInput ) {
				codeInput.value = '';
				setTimeout( function () {
					codeInput.focus();
				}, 60 );
			}

			startTimer( form, payload.wait );

			if ( payload.debug_code ) {
				message( form, 'DEBUG: код ' + payload.debug_code, 'info' );
			}
		} );
	}

	function verifyCode( form, button, purpose ) {
		var code = value( form, 'code' );
		var phone = form.dataset.vlPhone || value( form, 'phone' );

		fieldErrors( form, null );

		if ( ! code ) {
			fieldErrors( form, { code: cfg.i18n.bad_code.replace( '%d', cfg.code_length ) } );
			return;
		}

		loading( button, true );

		post( 'verify_code', { phone: phone, code: code, purpose: purpose } ).then( function ( res ) {
			loading( button, false );

			if ( ! res.success ) {
				var err = ( res.data && res.data.message ) || cfg.i18n.network;

				fieldErrors( form, { code: err } );
				return;
			}

			var data = res.data || {};

			if ( data.logged_in ) {
				message( form, data.message || '', 'success' );
				redirect( data.redirect );
				return;
			}

			if ( data.need_register ) {
				// Из формы входа переносим уже подтверждённый номер в форму
				// регистрации — повторное SMS не отправляем.
				if ( form.dataset.vlForm === 'login' ) {
					var target = switchPane( form, 'register' );

					if ( target ) {
						markVerified( target, phone, data.token );
						message( target, 'Аккаунта с таким номером ещё нет — номер подтверждён, осталось заполнить пару полей.', 'info' );

						var nextField = qs( target, '[name="first_name"]' ) || qs( target, '[data-vl-email]' );

						if ( nextField ) {
							nextField.focus();
						}
					}

					return;
				}

				markVerified( form, phone, data.token );
				message( form, data.message || '', 'success' );

				var email = qs( form, '[data-vl-email]' );

				if ( email ) {
					email.focus();
				}
			}
		} );
	}

	/**
	 * Отметить телефон в форме как подтверждённый.
	 */
	function markVerified( form, phone, token ) {
		form.dataset.vlPhone = phone;

		var tokenField = qs( form, '[data-vl-token]' );

		if ( tokenField ) {
			tokenField.value = token || '';
		}

		var phoneInput = qs( form, '[data-vl-phone]' );

		if ( phoneInput ) {
			phoneInput.value = formatPhone( phone );
			phoneInput.readOnly = true;
		}

		var badge = qs( form, '[data-vl-verified]' );

		if ( badge ) {
			badge.hidden = false;
		}

		var codeWrap = qs( form, '[data-vl-code-wrap]' );

		if ( codeWrap ) {
			codeWrap.hidden = true;
		}

		var sendButton = qs( form, '[data-vl-action="send-code"]' );

		if ( sendButton ) {
			sendButton.hidden = true;
		}
	}

	function switchPane( form, pane ) {
		var root = form.closest( '[data-vl-auth]' );

		if ( ! root ) {
			return null;
		}

		qsa( root, '[data-vl-pane]' ).forEach( function ( el ) {
			el.classList.toggle( 'is-active', el.dataset.vlPane === pane );
		} );

		qsa( root, '[data-vl-tab]' ).forEach( function ( el ) {
			el.classList.toggle( 'is-active', el.dataset.vlTab === pane );
		} );

		return qs( root, '[data-vl-pane="' + pane + '"] [data-vl-form]' );
	}

	function register( form, button ) {
		fieldErrors( form, null );
		message( form, '' );

		var token = value( form, 'token' );

		if ( ! token ) {
			message( form, 'Сначала подтвердите номер телефона — нажмите «получить код».', 'error' );
			return;
		}

		loading( button, true );

		post( 'register', {
			phone: form.dataset.vlPhone || value( form, 'phone' ),
			token: token,
			first_name: value( form, 'first_name' ),
			last_name: value( form, 'last_name' ),
			telegram: value( form, 'telegram' ),
			email: value( form, 'email' ),
			password: value( form, 'password' ),
			password2: value( form, 'password2' ),
			consent_privacy: checked( form, 'consent_privacy' ),
			consent_marketing: checked( form, 'consent_marketing' ),
			redirect_to: value( form, 'redirect_to' )
		} ).then( function ( res ) {
			loading( button, false );

			if ( ! res.success ) {
				var data = res.data || {};

				message( form, data.message || cfg.i18n.network, 'error' );
				fieldErrors( form, data.fields );

				if ( data.restart ) {
					step( form, 'phone' );
				}

				return;
			}

			message( form, res.data.message || '', 'success' );
			redirect( res.data.redirect );
		} );
	}

	function loginPassword( form, button ) {
		fieldErrors( form, null );
		message( form, '' );
		loading( button, true );

		post( 'login_password', {
			login: value( form, 'login' ),
			password: value( form, 'password' ),
			redirect_to: value( form, 'redirect_to' )
		} ).then( function ( res ) {
			loading( button, false );

			if ( ! res.success ) {
				message( form, ( res.data && res.data.message ) || cfg.i18n.network, 'error' );
				return;
			}

			redirect( res.data.redirect );
		} );
	}

	function lostPassword( form, button ) {
		fieldErrors( form, null );
		message( form, '' );

		var login = value( form, 'login' );

		if ( ! login ) {
			fieldErrors( form, { login: 'Укажите телефон или e-mail.' } );
			return;
		}

		loading( button, true );

		post( 'lost_password', { login: login } ).then( function ( res ) {
			loading( button, false );

			if ( ! res.success ) {
				message( form, ( res.data && res.data.message ) || cfg.i18n.network, 'error' );
				return;
			}

			var data = res.data || {};

			if ( data.mode === 'sms' ) {
				form.dataset.vlPhone = data.phone;

				var hint = qs( form, '[data-vl-code-hint]' );

				if ( hint ) {
					hint.textContent = data.message || '';
				}

				step( form, 'code' );
				startTimer( form, data.wait );

				if ( data.debug_code ) {
					message( form, 'DEBUG: код ' + data.debug_code, 'info' );
				}

				return;
			}

			message( form, data.message || '', 'success' );
		} );
	}

	function resetPassword( form, button ) {
		fieldErrors( form, null );
		message( form, '' );
		loading( button, true );

		post( 'reset_password', {
			phone: form.dataset.vlPhone || '',
			code: value( form, 'code' ),
			password: value( form, 'password' ),
			password2: value( form, 'password2' )
		} ).then( function ( res ) {
			loading( button, false );

			if ( ! res.success ) {
				message( form, ( res.data && res.data.message ) || cfg.i18n.network, 'error' );
				return;
			}

			message( form, res.data.message || '', 'success' );
			redirect( res.data.redirect );
		} );
	}

	function saveProfile( form, button ) {
		message( form, '' );
		loading( button, true );

		post( 'profile_save', {
			first_name: value( form, 'first_name' ),
			last_name: value( form, 'last_name' ),
			telegram: value( form, 'telegram' ),
			email: value( form, 'email' )
		} ).then( function ( res ) {
			loading( button, false );
			message( form, ( res.data && res.data.message ) || cfg.i18n.network, res.success ? 'success' : 'error' );
		} );
	}

	function savePassword( form, button ) {
		message( form, '' );
		loading( button, true );

		post( 'password_save', {
			current_password: value( form, 'current_password' ),
			password: value( form, 'password' ),
			password2: value( form, 'password2' )
		} ).then( function ( res ) {
			loading( button, false );
			message( form, ( res.data && res.data.message ) || cfg.i18n.network, res.success ? 'success' : 'error' );

			if ( res.success ) {
				qsa( form, 'input[type="password"]' ).forEach( function ( el ) {
					el.value = '';
				} );
			}
		} );
	}

	function saveConsents( form, button ) {
		message( form, '' );
		loading( button, true );

		post( 'consents_save', {
			consent_privacy: checked( form, 'consent_privacy' ),
			consent_marketing: checked( form, 'consent_marketing' )
		} ).then( function ( res ) {
			loading( button, false );
			message( form, ( res.data && res.data.message ) || cfg.i18n.network, res.success ? 'success' : 'error' );
		} );
	}

	/* ------------------------------------------------------------------
	 * Обработчики
	 * ------------------------------------------------------------------ */

	var actions = {
		'send-code': function ( form, button, el ) {
			sendCode( form, button, el.dataset.purpose || 'login' );
		},
		'resend': function ( form, button, el ) {
			sendCode( form, button, el.dataset.purpose || 'login' );
		},
		'verify-code': function ( form, button, el ) {
			verifyCode( form, button, el.dataset.purpose || 'login' );
		},
		'register': function ( form, button ) {
			register( form, button );
		},
		'login-password': function ( form, button ) {
			loginPassword( form, button );
		},
		'lost-password': function ( form, button ) {
			lostPassword( form, button );
		},
		'reset-password': function ( form, button ) {
			resetPassword( form, button );
		},
		'save-profile': function ( form, button ) {
			saveProfile( form, button );
		},
		'save-password': function ( form, button ) {
			savePassword( form, button );
		},
		'save-consents': function ( form, button ) {
			saveConsents( form, button );
		},
		'change-phone': function ( form ) {
			step( form, 'phone' );
		},
		'show-password-login': function ( form ) {
			step( form, 'password' );
		},
		'show-sms-login': function ( form ) {
			step( form, 'phone' );
		},
		'show-lost': function ( form ) {
			switchPane( form, 'lost' );
		},
		'show-login': function ( form ) {
			switchPane( form, 'login' );
		}
	};

	document.addEventListener( 'click', function ( event ) {
		var el = event.target.closest ? event.target.closest( '[data-vl-action]' ) : null;

		if ( el ) {
			var form = el.closest( '[data-vl-form]' );

			if ( form && actions[ el.dataset.vlAction ] ) {
				event.preventDefault();
				actions[ el.dataset.vlAction ]( form, el, el );
				return;
			}
		}

		// Переключение вкладок «войти / зарегистрироваться».
		var tab = event.target.closest ? event.target.closest( '[data-vl-tab]' ) : null;

		if ( tab ) {
			event.preventDefault();

			var root = tab.closest( '[data-vl-auth]' );

			qsa( root, '[data-vl-pane]' ).forEach( function ( pane ) {
				pane.classList.toggle( 'is-active', pane.dataset.vlPane === tab.dataset.vlTab );
			} );

			qsa( root, '[data-vl-tab]' ).forEach( function ( item ) {
				item.classList.toggle( 'is-active', item === tab );
			} );

			return;
		}

		// Меню кабинета на мобильных.
		var toggle = event.target.closest ? event.target.closest( '[data-vl-menu-toggle]' ) : null;

		if ( toggle ) {
			event.preventDefault();

			var account = toggle.closest( '[data-vl-account]' );
			var menu = qs( account, '[data-vl-menu]' );

			if ( menu ) {
				var open = menu.classList.toggle( 'is-open' );
				toggle.setAttribute( 'aria-expanded', open ? 'true' : 'false' );
			}

			return;
		}

		// Показать/скрыть пароль.
		var eye = event.target.closest ? event.target.closest( '[data-vl-toggle-password]' ) : null;

		if ( eye ) {
			event.preventDefault();

			var input = qs( eye.parentNode, 'input' );

			if ( input ) {
				input.type = input.type === 'password' ? 'text' : 'password';
			}

			return;
		}

		// Копирование промокода.
		var copy = event.target.closest ? event.target.closest( '[data-vl-copy]' ) : null;

		if ( copy ) {
			event.preventDefault();

			var code = copy.dataset.vlCopy;

			if ( navigator.clipboard ) {
				navigator.clipboard.writeText( code );
			}

			var original = copy.getAttribute( 'title' );
			copy.setAttribute( 'title', cfg.i18n.copied );

			setTimeout( function () {
				if ( original ) {
					copy.setAttribute( 'title', original );
				} else {
					copy.removeAttribute( 'title' );
				}
			}, 1500 );

			return;
		}

		// Избранное.
		var wish = event.target.closest ? event.target.closest( '[data-vl-wishlist]' ) : null;

		if ( wish ) {
			event.preventDefault();

			post( 'wishlist_toggle', { product_id: wish.dataset.vlWishlist } ).then( function ( res ) {
				if ( ! res.success ) {
					return;
				}

				var active = res.data.in_list;

				wish.classList.toggle( 'is-active', active );
				wish.setAttribute( 'aria-pressed', active ? 'true' : 'false' );

				var label = qs( wish, '.vl-wishlist-btn__label' );

				if ( label ) {
					label.textContent = active ? label.dataset.labelOn : label.dataset.labelOff;
				}

				qsa( document, '[data-vl-wishlist-count]' ).forEach( function ( counter ) {
					counter.textContent = res.data.count;
				} );
			} );

			return;
		}

		var remove = event.target.closest ? event.target.closest( '[data-vl-wishlist-remove]' ) : null;

		if ( remove ) {
			event.preventDefault();

			var id = remove.dataset.vlWishlistRemove;

			post( 'wishlist_remove', { product_id: id } ).then( function ( res ) {
				if ( ! res.success ) {
					return;
				}

				var item = document.querySelector( '[data-vl-wishlist-item="' + id + '"]' );

				if ( item ) {
					item.parentNode.removeChild( item );
				}

				qsa( document, '[data-vl-wishlist-count]' ).forEach( function ( counter ) {
					counter.textContent = res.data.count;
				} );

				var grid = document.querySelector( '[data-vl-wishlist-grid]' );

				if ( grid && ! grid.children.length ) {
					window.location.reload();
				}
			} );
		}
	} );

	// Отправка форм по Enter — используем основное действие формы.
	document.addEventListener( 'submit', function ( event ) {
		var form = event.target.closest ? event.target.closest( '[data-vl-form]' ) : null;

		if ( ! form ) {
			return;
		}

		event.preventDefault();

		var activeStep = qs( form, '[data-vl-step].is-active' );
		var scope = activeStep || form;
		var button = qs( scope, 'button[type="submit"][data-vl-action]' ) || qs( scope, '[data-vl-action]' );

		if ( button && actions[ button.dataset.vlAction ] ) {
			actions[ button.dataset.vlAction ]( form, button, button );
		}
	} );

	// Автоотправка кода, когда введено нужное количество цифр.
	document.addEventListener( 'input', function ( event ) {
		var el = event.target;

		if ( ! el.matches || ! el.matches( '[data-vl-code]' ) ) {
			return;
		}

		el.value = el.value.replace( /\D/g, '' );

		var form = el.closest( '[data-vl-form]' );

		if ( ! form || el.value.length < cfg.code_length ) {
			return;
		}

		var button = qs( form, '[data-vl-action="verify-code"]' );

		if ( button && ! button.classList.contains( 'is-loading' ) ) {
			actions[ 'verify-code' ]( form, button, button );
		}
	} );

	// Подтверждение выхода.
	document.addEventListener( 'click', function ( event ) {
		var link = event.target.closest ? event.target.closest( '[data-vl-confirm-logout]' ) : null;

		if ( link && ! window.confirm( cfg.i18n.confirm_exit ) ) {
			event.preventDefault();
		}
	} );

	// Проверка e-mail на «уже зарегистрирован» при потере фокуса.
	document.addEventListener( 'blur', function ( event ) {
		var el = event.target;

		if ( ! el.matches || ! el.matches( '[data-vl-email]' ) || ! el.value ) {
			return;
		}

		var form = el.closest( '[data-vl-form]' );

		post( 'check_email', { email: el.value } ).then( function ( res ) {
			if ( res.success && res.data.exists ) {
				fieldErrors( form, { email: res.data.message } );
			}
		} );
	}, true );
}() );

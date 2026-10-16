(function () {
  'use strict';
  const data = window.W3DPVSettings;
  const form = document.querySelector('.w3dpv-settings-form');
  if (!data || !form) return;
  const icon = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/></svg>';
  const style = document.createElement('style');
  style.id = 'w3dpv-live-style';
  document.head.appendChild(style);

  function values() {
    const result = {};
    form.querySelectorAll('[data-setting]').forEach(input => {
      result[input.getAttribute('data-setting')] = input.type === 'checkbox' ? (input.checked ? 'yes' : 'no') : input.value;
    });
    return result;
  }

  function rgba(hex, alpha) {
    const value = /^#[0-9a-f]{6}$/i.test(hex) ? hex : '#000000';
    return 'rgba(' + [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16)).join(',') + ',' + alpha + ')';
  }

  /** Same rules as W3DPV_Settings::css() so the preview matches the saved result. */
  function css(v) {
    const vars = [];
    Object.keys(data.spec).forEach(key => {
      const field = data.spec[key];
      if (field.var) vars.push(field.var + ':' + v[key] + (field.type === 'int' ? 'px' : ''));
    });
    if (v.btn_fill !== 'yes') vars.push('--w3dpv-btn-bg:transparent');
    vars.push('--w3dpv-btn-shadow:' + (v.btn_shadow === 'yes' ? '0 4px 12px rgba(39,63,98,.12)' : 'none'));
    vars.push('--w3dpv-status-bg:' + rgba(v.status_bg, 0.96), '--w3dpv-sw-bg:' + rgba(v.sw_bg, 0.94), '--w3dpv-badge-bg:' + rgba(v.badge_bg, 0.88));
    const backdrop = rgba(v.backdrop_color, Math.max(0, Math.min(100, Number(v.backdrop_opacity) || 0)) / 100);
    const blur = Math.max(0, Math.min(12, Number(v.backdrop_blur) || 0));
    let text = ':root{' + vars.join(';') + '}.w3dpv-dialog::backdrop{background:' + backdrop + ';-webkit-backdrop-filter:blur(' + blur + 'px);backdrop-filter:blur(' + blur + 'px)}.w3dpv-fallback-backdrop{background:' + backdrop + '}';
    if (v.btn_font === 'inherit') text += '.w3dpv-button-wrap .w3dpv-trigger{font-family:inherit!important}';
    if (v.dlg_font === 'inherit') text += '.w3dpv-dialog.w3dpv-dialog,.w3dpv-dialog.w3dpv-dialog *{font-family:inherit!important}';
    return text;
  }

  function update() {
    const v = values();
    style.textContent = css(v);
    form.querySelectorAll('input[type=color]').forEach(input => {
      const code = input.parentNode.querySelector('.w3dpv-color-code');
      if (code) code.textContent = input.value;
    });
    const wrap = form.querySelector('.w3dpv-settings-preview-button .w3dpv-button-wrap');
    const button = wrap && wrap.querySelector('.w3dpv-trigger');
    if (!button) return;
    wrap.className = 'w3dpv-button-wrap w3dpv-width-' + v.btn_width + ' w3dpv-align-' + v.btn_align;
    const svg = button.querySelector('svg');
    if (v.btn_icon === 'yes' && !svg) button.insertAdjacentHTML('afterbegin', icon);
    if (v.btn_icon !== 'yes' && svg) svg.remove();
    button.querySelector('span').textContent = v.btn_label || 'Посмотреть в 3D';
    button.setAttribute('data-label', v.btn_label);
  }

  function openDemo(trigger) {
    if (!window.W3DPV || !data.demo.length) return;
    const v = values();
    window.W3DPVConfig.ui = {eyebrow: v.dlg_eyebrow, badge: v.show_badge === 'yes' ? v.badge_text : '', palette: v.show_palette === 'yes', fullscreen: v.show_fullscreen === 'yes', help: v.show_help === 'yes', switcher: v.sw_position};
    window.W3DPV.applyUI();
    window.W3DPV.open({models: data.demo, title: 'Демонстрационное кресло', auto: false, speed: 8, yaw: 0, color: '#9aa7b7', background: '#f2f4f7'}, trigger);
  }

  form.addEventListener('input', update);
  form.addEventListener('change', update);
  form.querySelector('.w3dpv-open-demo').addEventListener('click', e => openDemo(e.currentTarget));
  form.querySelector('.w3dpv-settings-preview-button').addEventListener('click', e => {
    const trigger = e.target.closest('.w3dpv-trigger');
    if (trigger) openDemo(trigger);
  });
  form.querySelector('.w3dpv-reset-defaults').addEventListener('click', () => {
    form.querySelectorAll('[data-setting]').forEach(input => {
      const value = data.defaults[input.getAttribute('data-setting')];
      if (input.type === 'checkbox') input.checked = value === 'yes'; else input.value = value;
    });
    update();
  });
  update();
})();

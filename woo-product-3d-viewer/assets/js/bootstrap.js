(function () {
  'use strict';
  if (window.W3DPV || !window.W3DPVConfig) return;
  const config = window.W3DPVConfig;
  const icons = {
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    reset: '<path d="M4 9a8 8 0 1 1 0 6M4 3v6h6"/>',
    rotate: '<path d="M19 7a8 8 0 1 0 1 8M20 3v5h-5"/>',
    fullscreen: '<path d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5"/>',
    palette: '<path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1.7-3 1.7 1.7 0 0 1 1.5-2.5H18a3 3 0 0 0 3-3A9 9 0 0 0 12 3Z"/><circle cx="7.5" cy="10" r=".8"/><circle cx="10" cy="6.5" r=".8"/><circle cx="14" cy="6.5" r=".8"/><circle cx="17" cy="10" r=".8"/>'
  };
  const svg = name => '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + icons[name] + '</svg>';
  let dialog, backdrop, current, generation = 0, modulePromise;
  const initialModels = new WeakMap();
  const warmed = new Set();
  const palettes = {
    background: [
      ['#f2f4f7','Светло-серый'], ['#ffffff','Белый'], ['#efe3d4','Тёплый бежевый'], ['#dbe8ea','Серо-голубой'], ['#cbd5e1','Серебристый'],
      ['#586774','Графитовый'], ['#1f2937','Тёмно-серый'], ['#111827','Почти чёрный'], ['#dce9df','Светло-зелёный'], ['#e7def0','Светло-лиловый']
    ],
    model: [
      ['#ffffff','Белый'], ['#9aa7b7','Серебристый'], ['#1f2937','Графитовый'], ['#c7a66a','Песочный'], ['#8b4e35','Коричневый'],
      ['#b33b3b','Красный'], ['#cf7740','Терракотовый'], ['#2f6eac','Синий'], ['#367461','Зелёный'], ['#7a5ba7','Фиолетовый']
    ]
  };
  const validColor = color => /^#[0-9a-f]{6}$/i.test(color || '');
  const MAX_MODELS = 3;
  const ui = () => ({eyebrow: 'ПРОСМОТР В 3D', badge: '360°', palette: true, paletteBackground: true, paletteModel: true, fullscreen: true, help: true, switcher: 'bottom', ...(config.ui || {})});
  /** Palette tabs the shop allows; "palette: false" from 1.2.0 markup turns both off. */
  const paletteTabs = () => { const settings = ui(); return settings.palette === false ? [] : ['background', 'model'].filter(tab => settings[tab === 'background' ? 'paletteBackground' : 'paletteModel'] !== false); };

  function createDialog() {
    if (dialog) return;
    dialog = document.createElement('dialog');
    dialog.className = 'w3dpv-dialog';
    dialog.setAttribute('aria-labelledby', 'w3dpv-dialog-title');
    dialog.setAttribute('aria-describedby', 'w3dpv-help');
    dialog.innerHTML = '<div class="w3dpv-shell">' +
      '<header class="w3dpv-header"><div class="w3dpv-heading"><span class="w3dpv-eyebrow"></span><h2 id="w3dpv-dialog-title"></h2></div><button type="button" class="w3dpv-icon-button w3dpv-close" data-action="close" aria-label="Закрыть просмотр">' + svg('close') + '</button></header>' +
      '<div class="w3dpv-stage" id="w3dpv-stage"><div class="w3dpv-canvas-host"></div><div class="w3dpv-status" role="status" aria-live="polite"><span class="w3dpv-spinner" aria-hidden="true"></span><strong class="w3dpv-status-title">Подготовка просмотра</strong><p class="w3dpv-status-detail">Загружаем 3D-модель…</p><button type="button" class="w3dpv-retry" data-action="retry" hidden>Попробовать снова</button></div><span class="w3dpv-stage-badge" aria-hidden="true"></span><div class="w3dpv-models" role="tablist" aria-label="Модели товара" hidden></div>' +
      '<section class="w3dpv-palette-panel" id="w3dpv-palette-panel" aria-label="Палитра просмотра" hidden><div class="w3dpv-palette-heading"><strong class="w3dpv-palette-title" id="w3dpv-palette-title" hidden></strong><div class="w3dpv-palette-tabs" role="tablist" aria-label="Что перекрасить"><button type="button" id="w3dpv-tab-background" data-color-tab="background" role="tab" aria-controls="w3dpv-color-options" aria-selected="true">Фон</button><button type="button" id="w3dpv-tab-model" data-color-tab="model" role="tab" aria-controls="w3dpv-color-options" aria-selected="false" tabindex="-1">Модель</button></div><button type="button" class="w3dpv-icon-button" data-action="palette-close" aria-label="Закрыть палитру">' + svg('close') + '</button></div><div id="w3dpv-color-options" role="tabpanel" aria-labelledby="w3dpv-tab-background"><div class="w3dpv-swatch-grid" role="group" aria-label="Цвета фона"></div><div class="w3dpv-custom-row"><label class="w3dpv-custom-color" for="w3dpv-custom-color"><input type="color" id="w3dpv-custom-color" value="#f2f4f7"><span>Свой цвет</span></label><button type="button" data-action="palette-reset">Исходный фон</button></div><output class="w3dpv-color-value" for="w3dpv-custom-color" aria-live="polite"></output></div><p class="w3dpv-palette-note">Цвета меняются только для просмотра.</p></section></div>' +
      '<div class="w3dpv-footer"><div class="w3dpv-toolbar" role="group" aria-label="Управление 3D-моделью"><div class="w3dpv-zoom-controls"><button type="button" class="w3dpv-icon-button" data-action="minus" aria-label="Отдалить модель" title="Отдалить">' + svg('minus') + '</button><button type="button" class="w3dpv-icon-button" data-action="plus" aria-label="Приблизить модель" title="Приблизить">' + svg('plus') + '</button></div><button type="button" class="w3dpv-control-button" data-action="rotate" aria-pressed="false">' + svg('rotate') + '<span>Включить вращение</span></button><button type="button" class="w3dpv-control-button" data-action="reset">' + svg('reset') + '<span>Сбросить вид</span></button><button type="button" class="w3dpv-icon-button" data-action="fullscreen" aria-label="Полный экран" title="Полный экран">' + svg('fullscreen') + '</button></div><p id="w3dpv-help" class="w3dpv-help"></p></div></div>';
    const paletteButton = document.createElement('button');
    paletteButton.type = 'button'; paletteButton.className = 'w3dpv-control-button';
    paletteButton.setAttribute('data-action', 'palette'); paletteButton.setAttribute('aria-expanded', 'false');
    paletteButton.setAttribute('aria-controls', 'w3dpv-palette-panel');
    paletteButton.innerHTML = svg('palette') + '<span>Палитра</span>';
    dialog.querySelector('.w3dpv-toolbar').insertBefore(paletteButton, dialog.querySelector('[data-action="fullscreen"]'));
    document.body.appendChild(dialog);
    if (typeof dialog.showModal !== 'function') {
      dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.hidden = true;
      backdrop = document.createElement('div'); backdrop.className = 'w3dpv-fallback-backdrop'; backdrop.hidden = true;
      backdrop.setAttribute('aria-hidden', 'true'); backdrop.addEventListener('click', close); document.body.appendChild(backdrop);
    }
    dialog.addEventListener('cancel', e => { e.preventDefault(); close(); });
    dialog.addEventListener('close', () => { if (current) close(); });
    dialog.addEventListener('click', e => {
      const tab = e.target.closest('[data-color-tab]');
      if (tab) { setPaletteTab(tab.getAttribute('data-color-tab')); return; }
      const modelTab = e.target.closest('[data-model-index]');
      if (modelTab) { select(Number(modelTab.getAttribute('data-model-index'))); return; }
      const swatch = e.target.closest('[data-color-swatch]');
      if (swatch) { applyPaletteColor(swatch.getAttribute('data-color-swatch')); revealColorResult(); return; }
      const button = e.target.closest('[data-action]');
      if (button) { action(button.getAttribute('data-action')); return; }
      if (e.target === dialog) {
        const rect = dialog.getBoundingClientRect();
        if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) close();
      }
    });
    const customColor = dialog.querySelector('#w3dpv-custom-color');
    const colorInput = e => applyPaletteColor(e.target.value);
    customColor.addEventListener('input', colorInput);
    customColor.addEventListener('change', e => { colorInput(e); revealColorResult(); });
    dialog.addEventListener('pointerdown', e => {
      if (!dialog.querySelector('.w3dpv-palette-panel').hidden && !e.target.closest('.w3dpv-palette-panel, [data-action="palette"]')) showPalette(false, false);
    });
    dialog.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !dialog.querySelector('.w3dpv-palette-panel').hidden) { e.preventDefault(); e.stopPropagation(); showPalette(false, true); return; }
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.target.matches('[data-color-tab]') && ['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) {
        e.preventDefault();
        const next = e.key === 'Home' ? 'background' : e.key === 'End' ? 'model' : current.paletteTab === 'background' ? 'model' : 'background';
        setPaletteTab(next); dialog.querySelector('[data-color-tab="' + next + '"]').focus(); return;
      }
      const tab = e.target.closest('[data-model-index]');
      if (tab && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
        // Arrows move focus; Enter or Space loads the focused model (a model can be large).
        e.preventDefault();
        const tabs = [...dialog.querySelectorAll('[data-model-index]')], index = tabs.indexOf(tab);
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (index + (['ArrowLeft', 'ArrowUp'].includes(e.key) ? -1 : 1) + tabs.length) % tabs.length;
        tabs.forEach((item, i) => { item.tabIndex = i === next ? 0 : -1; });
        tabs[next].focus(); return;
      }
      if (/^[1-9]$/.test(e.key) && !e.altKey && !e.ctrlKey && !e.metaKey && !e.target.matches('input, textarea, select') && current && Number(e.key) <= current.settings.models.length) {
        e.preventDefault(); select(Number(e.key) - 1); return;
      }
      if (e.key === 'Tab' && typeof dialog.showModal !== 'function') {
        const focusable = [...dialog.querySelectorAll('button:not(:disabled):not([hidden]):not([tabindex="-1"]), input:not(:disabled), canvas')].filter(el => el.getClientRects().length);
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    applyUI();
    if (config.canDiagnose) {
      const diagnostic = document.createElement('button'); diagnostic.type = 'button'; diagnostic.className = 'w3dpv-diagnostics'; diagnostic.hidden = true;
      diagnostic.setAttribute('data-action', 'diagnostics'); diagnostic.textContent = 'Скопировать диагностику';
      dialog.querySelector('.w3dpv-status').appendChild(diagnostic);
    }
  }

  /** Texts and visibility from WooCommerce > 3D-просмотр; can be re-applied by the settings preview. */
  function applyUI() {
    if (!dialog) return;
    const settings = ui();
    dialog.querySelector('.w3dpv-eyebrow').textContent = settings.eyebrow || '';
    dialog.querySelector('.w3dpv-stage-badge').textContent = settings.badge || '';
    const multiple = current && current.settings.models.length > 1;
    dialog.querySelector('#w3dpv-help').textContent = 'Потяните модель для вращения. Масштаб — колёсиком, двумя пальцами или кнопками + и −. С клавиатуры: фокус на модели и стрелки' + (multiple ? ', цифры 1–' + current.settings.models.length + ' — модели.' : '.');
    dialog.querySelector('#w3dpv-help').hidden = !settings.help;
    const tabs = paletteTabs(), single = tabs.length === 1, panel = dialog.querySelector('.w3dpv-palette-panel');
    const focusInPanel = panel.contains(document.activeElement);
    dialog.querySelector('[data-action="palette"]').hidden = !tabs.length;
    dialog.querySelectorAll('[data-color-tab]').forEach(button => { button.hidden = !tabs.includes(button.getAttribute('data-color-tab')); });
    dialog.querySelector('.w3dpv-palette-tabs').hidden = tabs.length < 2;
    dialog.querySelector('.w3dpv-palette-title').hidden = !single;
    dialog.querySelector('.w3dpv-palette-title').textContent = single ? (tabs[0] === 'background' ? 'Цвет фона' : 'Цвет модели') : '';
    if (current) {
      // A switched-off part returns to the product background or the file's own materials.
      if (!tabs.includes('background') && current.background !== current.defaultBackground) { current.background = current.defaultBackground; dialog.querySelector('.w3dpv-stage').style.backgroundColor = current.background; }
      if (!tabs.includes('model') && current.modelColor) { current.modelColor = null; if (current.controller) current.controller.resetModelColor(); }
      if (tabs.length && !tabs.includes(current.paletteTab)) current.paletteTab = tabs[0];
      if (tabs.length && !panel.hidden) {
        renderPalette();
        // A focused tab that was just hidden would leave focus on the page.
        if (focusInPanel && (!panel.contains(document.activeElement) || document.activeElement.closest('[hidden]'))) showPalette(true);
      }
    }
    if (!tabs.length) showPalette(false);
    const full = dialog.querySelector('[data-action="fullscreen"]');
    full.hidden = !settings.fullscreen || !document.fullscreenEnabled || typeof dialog.querySelector('.w3dpv-shell').requestFullscreen !== 'function';
    const top = settings.switcher === 'top';
    dialog.querySelector('.w3dpv-models').classList.toggle('w3dpv-models--top', top);
    dialog.querySelector('.w3dpv-stage').classList.toggle('w3dpv-stage--models', !!multiple && !top);
    dialog.querySelector('.w3dpv-stage').classList.toggle('w3dpv-stage--models-top', !!multiple && top);
    if (current) markModel();
  }

  /** Accepts the 1.2 format ({models: [...]}) and the earlier single-model format ({model, mobileModel}). */
  function normalize(settings) {
    if (!settings || typeof settings !== 'object') return null;
    const list = Array.isArray(settings.models) && settings.models.length ? settings.models : [{model: settings.model, mobileModel: settings.mobileModel || null, label: ''}];
    const models = list.filter(entry => entry && entry.model && entry.model.url).slice(0, MAX_MODELS);
    return models.length ? {...settings, models} : null;
  }

  function modelLabel(entry, index) {
    return (entry && typeof entry.label === 'string' && entry.label.trim()) || 'Модель ' + (index + 1);
  }

  function renderModels() {
    const bar = dialog.querySelector('.w3dpv-models'), models = current.settings.models;
    bar.replaceChildren();
    bar.hidden = models.length < 2;
    models.forEach((entry, index) => {
      const tab = document.createElement('button');
      tab.type = 'button'; tab.className = 'w3dpv-model-tab'; tab.setAttribute('role', 'tab');
      tab.setAttribute('data-model-index', String(index));
      tab.setAttribute('aria-controls', 'w3dpv-stage');
      tab.textContent = modelLabel(entry, index); tab.title = tab.textContent;
      bar.appendChild(tab);
    });
    applyUI();
  }

  function markModel() {
    const count = current.settings.models.length;
    dialog.querySelectorAll('[data-model-index]').forEach(tab => {
      const selected = Number(tab.getAttribute('data-model-index')) === current.index;
      tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1;
    });
    const eyebrow = ui().eyebrow || '';
    dialog.querySelector('.w3dpv-eyebrow').textContent = count > 1 ? (eyebrow ? eyebrow + ' · ' : '') + (current.index + 1) + '/' + count : eyebrow;
  }

  /** Shows another model of the product in the open window; the background and palette stay. */
  function select(index) {
    if (!current || index === current.index || index < 0 || index >= current.settings.models.length) return;
    current.index = index;
    current.model = modelFor(current.settings.models[index]);
    markModel();
    mount(++generation);
    document.dispatchEvent(new CustomEvent('w3dpv:model', {detail: {index, modelId: current.model.id || 0}}));
  }

  function renderPalette() {
    if (!current) return;
    const tab = current.paletteTab;
    const color = tab === 'background' ? current.background : current.modelColor;
    const grid = dialog.querySelector('.w3dpv-swatch-grid');
    if (grid.dataset.tab !== tab) {
      grid.replaceChildren(); grid.dataset.tab = tab;
      for (const [value, name] of palettes[tab]) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'w3dpv-swatch';
        button.style.setProperty('--w3dpv-swatch-color', value); button.setAttribute('data-color-swatch', value);
        button.setAttribute('aria-label', name + ' — ' + value.toUpperCase()); button.title = name;
        grid.appendChild(button);
      }
    }
    grid.setAttribute('aria-label', tab === 'background' ? 'Цвета фона' : 'Цвета модели');
    grid.querySelectorAll('[data-color-swatch]').forEach(button => button.setAttribute('aria-pressed', String(button.getAttribute('data-color-swatch') === color)));
    dialog.querySelectorAll('[data-color-tab]').forEach(button => {
      const selected = button.getAttribute('data-color-tab') === tab;
      button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
    });
    dialog.querySelector('#w3dpv-color-options').setAttribute('aria-labelledby', paletteTabs().length === 1 ? 'w3dpv-palette-title' : 'w3dpv-tab-' + tab);
    const custom = dialog.querySelector('#w3dpv-custom-color');
    const customValue = color || (validColor(current.settings.color) ? current.settings.color : '#9aa7b7');
    if (custom.value !== customValue) custom.value = customValue;
    custom.setAttribute('aria-label', tab === 'background' ? 'Выбрать свой цвет фона' : 'Выбрать свой цвет модели');
    dialog.querySelector('[data-action="palette-reset"]').textContent = tab === 'background' ? 'Исходный фон' : 'Исходные цвета';
    dialog.querySelector('.w3dpv-color-value').textContent = color ? color.toUpperCase() : 'Исходные материалы модели';
  }

  function setPaletteTab(tab) {
    if (!current || !palettes[tab] || !paletteTabs().includes(tab)) return;
    current.paletteTab = tab; renderPalette();
  }

  function showPalette(show, returnFocus = false) {
    if (!dialog) return;
    dialog.querySelector('.w3dpv-palette-panel').hidden = !show;
    const button = dialog.querySelector('[data-action="palette"]');
    button.setAttribute('aria-expanded', String(show));
    if (show) {
      renderPalette();
      // With one part allowed there are no tabs; focus goes to the first colour.
      const target = paletteTabs().length > 1 ? dialog.querySelector('[data-color-tab="' + current.paletteTab + '"]') : dialog.querySelector('.w3dpv-swatch');
      if (target) target.focus({preventScroll: true});
    }
    else if (returnFocus) button.focus({preventScroll: true});
  }

  function applyPaletteColor(color) {
    if (!current || !validColor(color) || !paletteTabs().includes(current.paletteTab)) return;
    color = color.toLowerCase();
    if (current.paletteTab === 'background') {
      if (current.background === color) return;
      current.background = color; dialog.querySelector('.w3dpv-stage').style.backgroundColor = color;
    } else {
      if (current.modelColor === color || !current.controller || !current.controller.setModelColor(color)) return;
      current.modelColor = color;
    }
    renderPalette();
  }

  function revealColorResult() {
    if (matchMedia('(max-width: 600px)').matches || matchMedia('(max-height: 500px)').matches) showPalette(false, true);
  }

  function restorePaletteColor() {
    if (!current) return;
    if (current.paletteTab === 'background') {
      current.background = current.defaultBackground; dialog.querySelector('.w3dpv-stage').style.backgroundColor = current.background;
    } else {
      current.modelColor = null; if (current.controller) current.controller.resetModelColor();
    }
    renderPalette();
  }

  function status(title, detail, error) {
    dialog.querySelector('.w3dpv-status').hidden = false;
    dialog.querySelector('.w3dpv-status').classList.toggle('w3dpv-status--error', !!error);
    dialog.querySelector('.w3dpv-status-title').textContent = title;
    dialog.querySelector('.w3dpv-status-detail').textContent = detail;
    dialog.querySelector('.w3dpv-spinner').hidden = !!error;
    dialog.querySelector('.w3dpv-retry').hidden = !error;
    const diagnostic = dialog.querySelector('.w3dpv-diagnostics');
    if (diagnostic) { diagnostic.hidden = !error; diagnostic.textContent = 'Скопировать диагностику'; }
  }

  function controlsEnabled(enabled) {
    if (!enabled) showPalette(false);
    dialog.querySelectorAll('[data-action="plus"], [data-action="minus"], [data-action="rotate"], [data-action="reset"], [data-action="palette"]').forEach(button => { button.disabled = !enabled; });
  }

  function rotation(rotating) {
    const button = dialog.querySelector('[data-action="rotate"]');
    button.setAttribute('aria-pressed', String(rotating));
    button.querySelector('span').textContent = rotating ? 'Остановить вращение' : 'Включить вращение';
  }

  function stage(value) {
    if (!current) return;
    current.diagnostics.phase = value;
    const messages = {
      memory: ['Открываем сохранённую модель', 'Подготовка просмотра…'],
      browser: ['Открываем модель из кэша', 'Подготовка просмотра…'],
      graphics: ['Подготовка просмотра', 'Настраиваем освещение…'],
      materials: ['Подготовка модели', 'Обрабатываем материалы и текстуры…'],
      render: ['Почти готово', 'Подготовка изображения…']
    };
    if (messages[value]) status(messages[value][0], messages[value][1], false);
  }

  /** Phones and tablets get the lighter file of a model when one is set. */
  function modelFor(entry) {
    const apple = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const small = apple || matchMedia('(max-width: 767px)').matches || (matchMedia('(pointer: coarse)').matches && matchMedia('(max-width: 1024px)').matches);
    return small && entry.mobileModel && entry.mobileModel.url ? entry.mobileModel : entry.model;
  }

  function module() {
    if (!modulePromise) {
      let timer;
      modulePromise = Promise.race([
        import(config.viewerUrl),
        new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('Тайм-аут загрузки модуля просмотра.')), 45000); })
      ]).catch(error => { modulePromise = null; throw error; }).finally(() => clearTimeout(timer));
    }
    return modulePromise;
  }

  function diagnostics() {
    if (!current) return null;
    return {...current.diagnostics, version: config.version, browser: navigator.userAgent, viewport: {width: innerWidth, height: innerHeight}, secure: window.isSecureContext,
      model: {id: current.model.id, format: current.model.format, bytes: Number(current.model.bytes), mobile: current.model === current.settings.models[current.index].mobileModel, index: current.index + 1, count: current.settings.models.length},
      cache: window.W3DPVModelCache ? window.W3DPVModelCache.diagnostics() : {source: 'unavailable'}};
  }

  async function mount(token, refresh = false) {
    controlsEnabled(false);
    const count = current.settings.models.length;
    status('Подготовка просмотра', count > 1 ? 'Загружаем «' + modelLabel(current.settings.models[current.index], current.index) + '» (' + (current.index + 1) + ' из ' + count + ')…' : 'Загружаем 3D-модель…', false);
    if (current.downloadAbort) current.downloadAbort.abort();
    if (current.controller) { current.controller.dispose(); current.controller = null; }
    current.diagnostics = {phase: 'download'};
    current.downloadAbort = new AbortController();
    const state = current;
    try {
      const downloadPromise = window.W3DPVModelCache.load(state.model, {
        signal: state.downloadAbort.signal, refresh,
        progress: percent => { if (current === state && token === generation) status('Загрузка модели', percent === null ? 'Подождите немного…' : percent + '%', false); },
        stage: value => { if (current === state && token === generation) stage(value); }
      });
      downloadPromise.catch(() => {});
      const viewer = await module();
      if (!current || token !== generation) return;
      current.controller = viewer.mount(dialog.querySelector('.w3dpv-canvas-host'), {...current.settings, model: current.model, downloadPromise}, config, {
        progress: () => {},
        stage: value => { if (current && token === generation) stage(value); },
        details: details => { if (current && token === generation) Object.assign(current.diagnostics, details); },
        ready: () => { if (current && token === generation) { current.diagnostics.phase = 'ready'; if (current.modelColor) current.controller.setModelColor(current.modelColor); dialog.querySelector('.w3dpv-status').hidden = true; controlsEnabled(true); } },
        error: (message, detail) => { if (current && token === generation) { current.downloadAbort.abort(); Object.assign(current.diagnostics, detail, {message}); controlsEnabled(false); status('Не удалось открыть модель', message + (detail && detail.code ? ' Код: ' + detail.code + '.' : ''), true); } },
        rotation: rotating => { if (current && token === generation) rotation(rotating); }
      });
    } catch (error) {
      state.downloadAbort.abort();
      if (current && token === generation) { current.diagnostics = {phase: 'module', code: 'VIEWER_MODULE', message: error.message}; status('Просмотр недоступен', 'Не удалось загрузить модуль просмотра. Проверьте соединение и повторите попытку. Код: VIEWER_MODULE.', true); }
    }
  }

  function open(settings, trigger, index = 0) {
    settings = normalize(settings);
    if (!settings) return;
    if (current) close();
    createDialog();
    index = Math.min(Math.max(Number(index) || 0, 0), settings.models.length - 1);
    const scrollY = window.scrollY, bodyStyle = document.body.getAttribute('style');
    const gap = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
    const defaultBackground = validColor(settings.background) ? settings.background.toLowerCase() : '#f2f4f7';
    current = {settings, index, model: modelFor(settings.models[index]), trigger: trigger || document.activeElement, scrollY, bodyStyle, controller: null, defaultBackground, background: defaultBackground, modelColor: null, paletteTab: 'background', diagnostics: {phase: 'module'}};
    dialog.querySelector('#w3dpv-dialog-title').textContent = settings.title || '3D-модель товара';
    renderModels();
    dialog.querySelector('.w3dpv-stage').style.backgroundColor = defaultBackground;
    showPalette(false);
    document.body.style.position = 'fixed'; document.body.style.top = '-' + scrollY + 'px';
    document.body.style.width = '100%'; document.body.style.overflow = 'hidden';
    if (gap) document.body.style.paddingRight = gap + 'px';
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else { dialog.hidden = false; dialog.setAttribute('open', ''); if (backdrop) backdrop.hidden = false; }
    dialog.querySelector('.w3dpv-close').focus({preventScroll: true});
    mount(++generation);
    document.dispatchEvent(new CustomEvent('w3dpv:open', {detail: {modelId: current.model.id || 0, index, count: settings.models.length}}));
  }

  function close() {
    if (!current) return;
    const previous = current; current = null; ++generation;
    if (previous.downloadAbort) previous.downloadAbort.abort();
    if (previous.controller) previous.controller.dispose();
    if (document.fullscreenElement && dialog.contains(document.fullscreenElement) && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    if (typeof dialog.showModal === 'function' && typeof dialog.close === 'function') dialog.close();
    else { dialog.removeAttribute('open'); dialog.hidden = true; }
    if (backdrop) backdrop.hidden = true;
    if (previous.bodyStyle === null) document.body.removeAttribute('style');
    else document.body.setAttribute('style', previous.bodyStyle);
    window.scrollTo({top: previous.scrollY, left: window.scrollX, behavior: 'instant'});
    if (previous.trigger && previous.trigger.isConnected) previous.trigger.focus({preventScroll: true});
    document.dispatchEvent(new CustomEvent('w3dpv:close'));
  }

  function action(name) {
    if (!current) return;
    if (name === 'close') { close(); return; }
    if (name === 'retry') { mount(++generation, true); return; }
    if (name === 'diagnostics') {
      const button = dialog.querySelector('.w3dpv-diagnostics'), report = JSON.stringify(diagnostics(), null, 2);
      const fallback = () => window.prompt('Скопируйте диагностику:', report);
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(report).then(() => { button.textContent = 'Диагностика скопирована'; }).catch(fallback);
      else fallback();
      return;
    }
    if (name === 'palette') { if (paletteTabs().length) showPalette(dialog.querySelector('.w3dpv-palette-panel').hidden); return; }
    if (name === 'palette-close') { showPalette(false, true); return; }
    if (name === 'palette-reset') { restorePaletteColor(); return; }
    if (name === 'fullscreen') {
      const shell = dialog.querySelector('.w3dpv-shell');
      if (document.fullscreenElement === shell) document.exitFullscreen().catch(() => {});
      else shell.requestFullscreen().catch(() => { dialog.querySelector('[data-action="fullscreen"]').hidden = true; });
      return;
    }
    const viewer = current.controller;
    if (!viewer) return;
    if (name === 'plus') viewer.zoom(0.8);
    if (name === 'minus') viewer.zoom(1.25);
    if (name === 'rotate') viewer.toggleRotation();
    if (name === 'reset') viewer.reset();
  }

  function getInitial(button) {
    if (!initialModels.has(button)) {
      try { initialModels.set(button, JSON.parse(button.getAttribute('data-w3dpv') || 'null')); }
      catch (error) { initialModels.set(button, null); }
    }
    return initialModels.get(button);
  }

  function updateVariation(form, variation) {
    const id = form.getAttribute('data-product_id');
    document.querySelectorAll('.w3dpv-trigger[data-product-id]').forEach(button => {
      if (button.getAttribute('data-product-id') !== id || button.getAttribute('data-fixed') === '1') return;
      const initial = getInitial(button);
      const settings = variation ? (variation.w3dpv || null) : initial;
      button.setAttribute('data-w3dpv', JSON.stringify(settings));
      button.disabled = !settings;
      button.querySelector('span').textContent = settings ? (button.getAttribute('data-label') || 'Посмотреть в 3D') : (button.getAttribute('data-label-disabled') || 'Выберите вариант для 3D');
    });
  }

  document.addEventListener('click', e => {
    const button = e.target.closest('.w3dpv-trigger');
    if (!button || button.disabled) return;
    getInitial(button);
    try { open(JSON.parse(button.getAttribute('data-w3dpv')), button); } catch (error) { /* Invalid third-party markup is ignored. */ }
  });
  function prewarm(e) {
    const button = e.target.closest('.w3dpv-trigger');
    if (!button || button.disabled || (e.relatedTarget && button.contains(e.relatedTarget))) return;
    try {
      const settings = normalize(JSON.parse(button.getAttribute('data-w3dpv')));
      if (!settings) return;
      module().catch(() => {});
      // Only the model that opens first is preloaded.
      const first = modelFor(settings.models[0]), key = first.url;
      if (!matchMedia('(pointer: coarse)').matches && !warmed.has(key)) { warmed.add(key); window.W3DPVModelCache.warm(first); }
    } catch (error) { /* Markup controlled by third-party builders may be incomplete. */ }
  }
  document.addEventListener('pointerover', prewarm);
  document.addEventListener('focusin', prewarm);
  if (window.jQuery) {
    window.jQuery(document).on('found_variation.w3dpv', '.variations_form', function (e, variation) { updateVariation(this, variation); });
    window.jQuery(document).on('reset_data.w3dpv', '.variations_form', function () { updateVariation(this, null); });
    window.jQuery(function () {
      document.querySelectorAll('.w3dpv-trigger').forEach(getInitial);
      window.jQuery('.variations_form').each(function () {
        const selected = Number(window.jQuery(this).find('input.variation_id').val());
        const variations = window.jQuery(this).data('product_variations');
        if (selected && Array.isArray(variations)) updateVariation(this, variations.find(v => v.variation_id === selected));
      });
    });
  }
  window.W3DPV = {open, close, select, diagnostics, applyUI};
})();

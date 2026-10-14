(function ($) {
  'use strict';
  function settings(model) {
    const title = document.getElementById('title');
    return {
      model, title: title ? title.value : '3D-модель товара',
      auto: $('#_w3dpv_auto').prop('checked'),
      speed: Math.max(1, Math.min(30, Number($('#_w3dpv_speed').val()) || 8)),
      yaw: Number($('#_w3dpv_yaw').val()) || 0,
      color: $('#_w3dpv_color').val() || '#9aa7b7',
      background: $('#_w3dpv_background').val() || '#f2f4f7'
    };
  }
  $(document).on('click', '.w3dpv-select-file', function () {
    const field = $(this).closest('.w3dpv-file-field');
    const frame = wp.media({title: 'Выберите GLB или OBJ', button: {text: 'Использовать 3D-модель'}, multiple: false});
    frame.on('select', function () {
      const file = frame.state().get('selection').first().toJSON();
      const ext = (file.filename || '').split('.').pop().toLowerCase();
      if (!['glb', 'obj'].includes(ext)) { window.alert('Нужен файл GLB или OBJ.'); return; }
      if (file.filesizeInBytes > W3DPVConfig.maxBytes) { window.alert('Модель превышает лимит ' + (W3DPVConfig.maxBytes / 1048576) + ' МиБ.'); return; }
      field.find('.w3dpv-attachment-id').val(file.id).trigger('change');
      field.find('.w3dpv-file-info').text(file.filename);
      field.find('.w3dpv-remove-file').prop('disabled', false);
      field.find('.w3dpv-admin-preview').prop('disabled', false).attr('data-model', JSON.stringify({id: file.id, url: file.url, name: file.filename, format: ext, bytes: file.filesizeInBytes || 0}));
    });
    frame.open();
  });
  $(document).on('click', '.w3dpv-remove-file', function () {
    const field = $(this).closest('.w3dpv-file-field');
    field.find('.w3dpv-attachment-id').val('0').trigger('change');
    field.find('.w3dpv-file-info').text('Модель не выбрана');
    field.find('.w3dpv-remove-file, .w3dpv-admin-preview').prop('disabled', true);
    field.find('.w3dpv-admin-preview').attr('data-model', 'null');
  });
  $(document).on('click', '.w3dpv-admin-preview', function () {
    try {
      const model = JSON.parse(this.getAttribute('data-model'));
      if (model && window.W3DPV) window.W3DPV.open(settings(model), this);
    } catch (error) { window.alert('Не удалось прочитать выбранную модель. Выберите файл заново.'); }
  });
})(jQuery);

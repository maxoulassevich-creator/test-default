/* Wrbet Cards — settings screen behaviour */
(function ($) {
	'use strict';

	$(function () {
		// Colour picker on every hex field. rgba() values are typed directly:
		// wpColorPicker keeps the raw string when it cannot parse it.
		$('.wrbet-color').each(function () {
			var $field = $(this);

			if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test($.trim($field.val()))) {
				$field.wpColorPicker();
			} else {
				$field.addClass('regular-text').attr(
					'placeholder',
					'rgba(242,242,242,0.66)'
				);
			}
		});

		// Custom families only matter when the font source asks for them.
		var $source = $('#wrbet_font_source');

		function syncFontFields() {
			var custom = $source.val() === 'custom';
			// readonly rather than disabled: a disabled field is not submitted,
			// which would quietly wipe a saved family on the next save.
			$('#wrbet_font_head, #wrbet_font_body')
				.prop('readonly', !custom)
				.closest('tr')
				.css('opacity', custom ? '' : 0.55);
		}

		if ($source.length) {
			syncFontFields();
			$source.on('change', syncFontFields);
		}
	});
})(jQuery);

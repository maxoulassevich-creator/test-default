(function () {
  'use strict';

  var tabs = document.querySelectorAll('.isux-tabs [data-tab]');
  var panels = document.querySelectorAll('.isux-panel[data-panel]');

  Array.prototype.forEach.call(tabs, function (tab) {
    tab.addEventListener('click', function () {
      Array.prototype.forEach.call(tabs, function (node) { node.classList.toggle('is-active', node === tab); });
      Array.prototype.forEach.call(panels, function (panel) { panel.classList.toggle('is-active', panel.getAttribute('data-panel') === tab.getAttribute('data-tab')); });
      try { sessionStorage.setItem('isux-admin-tab', tab.getAttribute('data-tab')); } catch (error) {}
    });
  });

  try {
    var saved = sessionStorage.getItem('isux-admin-tab');
    if (saved) {
      var savedTab = document.querySelector('.isux-tabs [data-tab="' + saved + '"]');
      if (savedTab) savedTab.click();
    }
  } catch (error) {}
})();

// Содержимое плиток создаётся скриптом: обычный парсер исходного HTML его не увидит.
document.addEventListener('DOMContentLoaded', () => {
  const grid = document.querySelector('.grid');
  if (!grid) return;
  const items = JSON.parse(grid.getAttribute('data-items') || '[]');
  grid.innerHTML = items.map((t, i) => `<div class="tile"><h3>${t}</h3><p>Карточка №${i + 1}, создана JavaScript.</p></div>`).join('');
});

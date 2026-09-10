# Карта ссылок — постранично

Итог аудита всех 9 файлов. Проверено скриптом: каждая внутренняя ссылка ведёт
на существующий файл или на существующий `id` на странице; ссылок-заглушек
(`#`, `#top` на не-логотипе) не осталось ни одной.

Обозначения: **страница** = переход на другой html, *якорь* = скролл внутри
текущей страницы.

---

## Общий каркас — одинаковый на всех 9 страницах

Эти блоки скопированы без изменений везде, чтобы шапка и футер вели себя
одинаково на любой странице сайта.

### Шапка (`.site-header`)

| Элемент | Ведёт |
|---|---|
| Логотип `W Wrbet Kenya` | `index.html` (на самой главной — *якорь* `#top`) |
| Sports Betting | `sports-betting.html` |
| Online Casino | `online-casino.html` |
| Live Casino | `live-casino.html` |
| Crash Games | `crash-games.html` |
| Virtual Sport | `virtual-sports.html` |
| FAQ | `faq.html` |
| Кнопка `Play responsibly` | `responsible-gambling.html` |

Активный пункт помечается `class="is-active"` + `aria-current="page"`.
Bonuses и Responsible Gambling в шапку не вынесены — их 6 пунктов и так на
пределе по ширине; обе доступны из бургера, футера и блоков «Related».

### Бургер-меню (`.drawer`) — 8 пунктов, полный список разделов

| Элемент | Ведёт |
|---|---|
| 01 Sports Betting | `sports-betting.html` |
| 02 Online Casino | `online-casino.html` |
| 03 Live Casino | `live-casino.html` |
| 04 Crash Games | `crash-games.html` |
| 05 Virtual Sport | `virtual-sports.html` |
| 06 Bonuses | `bonuses.html` |
| 07 Responsible Gambling | `responsible-gambling.html` |
| 08 FAQ | `faq.html` |
| Кнопка внизу | на внутренних — `Back to home` → `index.html`; на главной — `Explore the guide` → *якорь* `#guide` |

### Футер — три колонки

| Колонка | Ссылки |
|---|---|
| **Betting** | `sports-betting.html`, `virtual-sports.html`, `bonuses.html` |
| **Casino** | `online-casino.html`, `live-casino.html`, `crash-games.html` |
| **About** | `responsible-gambling.html`, `faq.html`, `index.html` |
| Логотип в футере | `index.html` (на главной — `#top`) |

### Нижняя цветная полоса (`.cta-band`)

| Страница | Левая кнопка | Правая кнопка |
|---|---|---|
| Главная | `sports-betting.html` | `faq.html` |
| Все внутренние, кроме FAQ | `index.html` | `faq.html` |
| FAQ | `index.html` | `responsible-gambling.html` |

На FAQ правая кнопка изменена намеренно: вести с FAQ на FAQ бессмысленно.

### Служебное

- `Skip to content` — *якорь* `#main`, на всех страницах.
- Хлебные крошки на внутренних: `Home` → `index.html`, текущая страница —
  текст без ссылки с `aria-current="page"`.
- Кнопка «наверх» (`.to-top`) — не ссылка, а `<button>`, скроллит вверх.

---

## 1. `index.html` — главная

Уникальные для страницы ссылки, сверх общего каркаса:

| Место | Элемент | Ведёт |
|---|---|---|
| Первый экран | Кнопка `Start with the basics` | `sports-betting.html` |
| Первый экран | Кнопка `Responsible gambling` | `responsible-gambling.html` |
| Секция 03, Aviator | Кнопка `Set your limits first` | `responsible-gambling.html` |
| **Секция 04, 7 карточек** | Sports Betting | `sports-betting.html` |
| | Online Casino | `online-casino.html` |
| | Live Casino | `live-casino.html` |
| | Crash Games | `crash-games.html` |
| | Virtual Sports | `virtual-sports.html` |
| | Bonuses | `bonuses.html` |
| | Responsible Gambling | `responsible-gambling.html` |
| Секция 05 | `Read the responsible gambling guide →` | `responsible-gambling.html` |
| Секция 06, под FAQ | `All questions, grouped by topic →` | `faq.html` |

Кликабельна вся карточка секции 04 целиком, не только заголовок: содержимое
обёрнуто в `<a class="bento__link">`, стрелка справа от заголовка — индикатор.

---

## 2. `sports-betting.html`

| Место | Элемент | Ведёт |
|---|---|---|
| Оглавление чипами | 6 чипов | *якоря* `#how-it-works`, `#odds`, `#markets`, `#live`, `#risks`, `#faq` |
| Секция 05 | `Read the responsible gambling guide →` | `responsible-gambling.html` |
| Related | Virtual Sport | `virtual-sports.html` |
| Related | Bonuses | `bonuses.html` |
| Related | Responsible Gambling | `responsible-gambling.html` |

## 3. `online-casino.html`

| Место | Элемент | Ведёт |
|---|---|---|
| Оглавление чипами | 6 чипов | *якоря* `#what`, `#games`, `#rtp`, `#rules`, `#risks`, `#faq` |
| Секция 01, карточка Live casino | `See the live casino guide →` | `live-casino.html` |
| Секция 01, карточка Crash games | `See the crash games guide →` | `crash-games.html` |
| Секция 05 | `Read the responsible gambling guide →` | `responsible-gambling.html` |
| Related | Live Casino / Crash Games / Responsible Gambling | `live-casino.html`, `crash-games.html`, `responsible-gambling.html` |

## 4. `live-casino.html`

| Место | Элемент | Ведёт |
|---|---|---|
| Оглавление чипами | 6 чипов | *якоря* `#what`, `#formats`, `#table`, `#compare`, `#risks`, `#faq` |
| Секция 05 | `Read the responsible gambling guide →` | `responsible-gambling.html` |
| Related | Online Casino / Bonuses / Responsible Gambling | `online-casino.html`, `bonuses.html`, `responsible-gambling.html` |

## 5. `crash-games.html`

| Место | Элемент | Ведёт |
|---|---|---|
| Оглавление чипами | 6 чипов | *якоря* `#what`, `#round`, `#cashout`, `#fairness`, `#risks`, `#faq` |
| Секция 05 | `Read the responsible gambling guide →` | `responsible-gambling.html` |
| Related | Online Casino / Virtual Sport / Responsible Gambling | `online-casino.html`, `virtual-sports.html`, `responsible-gambling.html` |

## 6. `virtual-sports.html`

| Место | Элемент | Ведёт |
|---|---|---|
| Оглавление чипами | 6 чипов | *якоря* `#what`, `#formats`, `#settlement`, `#compare`, `#risks`, `#faq` |
| Секция 03, в тексте | ссылка `sports betting` | `sports-betting.html` |
| Секция 05 | `Read the responsible gambling guide →` | `responsible-gambling.html` |
| Related | Sports Betting / Crash Games / Responsible Gambling | `sports-betting.html`, `crash-games.html`, `responsible-gambling.html` |

## 7. `bonuses.html`

| Место | Элемент | Ведёт |
|---|---|---|
| Оглавление чипами | 6 чипов | *якоря* `#what`, `#types`, `#wagering`, `#terms`, `#risks`, `#faq` |
| Секция 05 | `Read the responsible gambling guide →` | `responsible-gambling.html` |
| Related | Sports Betting / Online Casino / Responsible Gambling | `sports-betting.html`, `online-casino.html`, `responsible-gambling.html` |

## 8. `responsible-gambling.html`

| Место | Элемент | Ведёт |
|---|---|---|
| Оглавление чипами | 6 чипов | *якоря* `#meaning`, `#limits`, `#signs`, `#break`, `#support`, `#faq` |
| Related | Sports Betting / Online Casino / Bonuses | `sports-betting.html`, `online-casino.html`, `bonuses.html` |

Кнопка `Play responsibly` в шапке помечена активной. Ссылки «наружу» —
телефоны и сайты организаций поддержки — **не проставлены сознательно**: в
секции 05 стоят пунктирные пустые поля под название, телефон, часы и адрес
сайта. Заполнить проверенными данными, тогда там появятся внешние ссылки.

## 9. `faq.html`

| Место | Элемент | Ведёт |
|---|---|---|
| Оглавление чипами | 8 чипов | *якоря* `#general`, `#sports`, `#casino`, `#live`, `#crash`, `#virtual`, `#bonuses`, `#responsible` |
| Под каждой из 7 тематических групп | `Full … guide →` | соответствующая страница раздела |

Группа General ссылок под собой не имеет — это вопросы о самом сайте.

---

## Чего пока нет

В ТЗ не заявлены, поэтому не созданы и ссылок на них не осталось:
**About Wrbet**, **Editorial policy**, **Contact**. Раньше они висели в футере
главной с `href="#top"` — то есть кликались, но никуда не вели; убраны.
Если такие страницы нужны (для информационного сайта про азартные игры они
обычно полезны — авторство и редакционная политика), скажите — сверстаю в том
же каркасе и верну в колонку About.

## Как проверить

```
python3 tools/build-single-file.py     # пересобрать автономные версии
```

Скрипт печатает `UNRESOLVED`, если в странице остался локальный путь, который
не удалось вшить. Проверка целостности ссылок — отдельным проходом по всем
`href`: каждый должен указывать на существующий файл либо на существующий `id`.

# Ссылки и кнопки — таблица

Проверено скриптом по всем 9 файлам: каждая ссылка ведёт либо на существующий
файл, либо на существующий `id`. Ссылок-заглушек не осталось.

`#имя` — якорь, скролл внутри той же страницы.

---

## Шапка, бургер и футер — одинаковы на всех 9 страницах

| Где | Кнопка / ссылка | Ведёт на |
|---|---|---|
| Шапка | Логотип `Wrbet Kenya` | `index.html` |
| Шапка | Sports Betting | `sports-betting.html` |
| Шапка | Online Casino | `online-casino.html` |
| Шапка | Live Casino | `live-casino.html` |
| Шапка | Crash Games | `crash-games.html` |
| Шапка | Virtual Sport | `virtual-sports.html` |
| Шапка | FAQ | `faq.html` |
| Шапка | Кнопка `Play responsibly` | `responsible-gambling.html` |
| Бургер | 01 Sports Betting | `sports-betting.html` |
| Бургер | 02 Online Casino | `online-casino.html` |
| Бургер | 03 Live Casino | `live-casino.html` |
| Бургер | 04 Crash Games | `crash-games.html` |
| Бургер | 05 Virtual Sport | `virtual-sports.html` |
| Бургер | 06 Bonuses | `bonuses.html` |
| Бургер | 07 Responsible Gambling | `responsible-gambling.html` |
| Бургер | 08 FAQ | `faq.html` |
| Бургер | Кнопка `Play responsibly` | `responsible-gambling.html` |
| Крошки | Home | `index.html` |
| Футер · Betting | Sports Betting | `sports-betting.html` |
| Футер · Betting | Virtual Sport | `virtual-sports.html` |
| Футер · Betting | Bonuses | `bonuses.html` |
| Футер · Casino | Online Casino | `online-casino.html` |
| Футер · Casino | Live Casino | `live-casino.html` |
| Футер · Casino | Crash Games | `crash-games.html` |
| Футер · About | Responsible Gambling | `responsible-gambling.html` |
| Футер · About | FAQ | `faq.html` |
| Футер · About | Home | `index.html` |
| Футер | Логотип `Wrbet Kenya` | `index.html` |
| Низ страницы | Кнопка `Back to the guide` | `index.html` |
| Низ страницы | Кнопка `Browse the FAQ` | `faq.html` |
| Служебное | Skip to content | `#main` |

Кнопка `Play responsibly` в шапке скрыта ниже 1024px, поэтому та же кнопка
продублирована внизу бургер-меню — на мобильных это единственный способ до
неё добраться. На главную ведут логотип и крошки, отдельная кнопка не нужна.

Исключения из этой таблицы:

| Страница | Кнопка / ссылка | Ведёт на | Почему |
|---|---|---|---|
| `index.html` | Логотип в шапке и футере | `#top` | уже на главной |
| `index.html` | Низ страницы, левая кнопка `Start with sports betting` | `sports-betting.html` | вместо `Back to the guide` |
| `faq.html` | Низ страницы, правая кнопка `Play responsibly` | `responsible-gambling.html` | вместо `Browse the FAQ` |

---

## 1. `index.html` — главная

| Кнопка / ссылка | Ведёт на |
|---|---|
| Первый экран · `Start with the basics` | `sports-betting.html` |
| Первый экран · `Responsible gambling` | `responsible-gambling.html` |
| Секция 03 Aviator · `Set your limits first` | `responsible-gambling.html` |
| Секция 04 · карточка Sports Betting | `sports-betting.html` |
| Секция 04 · карточка Online Casino | `online-casino.html` |
| Секция 04 · карточка Live Casino | `live-casino.html` |
| Секция 04 · карточка Crash Games | `crash-games.html` |
| Секция 04 · карточка Virtual Sports | `virtual-sports.html` |
| Секция 04 · карточка Bonuses | `bonuses.html` |
| Секция 04 · карточка Responsible Gambling | `responsible-gambling.html` |
| Секция 05 · `Read the responsible gambling guide` | `responsible-gambling.html` |
| Секция 06 · `All questions, grouped by topic` | `faq.html` |

Кликабельна вся карточка секции 04 целиком, не только заголовок.

## 2. `sports-betting.html`

| Кнопка / ссылка | Ведёт на |
|---|---|
| Чип `How it works` | `#how-it-works` |
| Чип `Odds explained` | `#odds` |
| Чип `Markets & bet types` | `#markets` |
| Чип `Live betting odds` | `#live` |
| Чип `Risks & limits` | `#risks` |
| Чип `FAQ` | `#faq` |
| Секция 05 · `Read the responsible gambling guide` | `responsible-gambling.html` |
| Related · Virtual Sport | `virtual-sports.html` |
| Related · Bonuses | `bonuses.html` |
| Related · Responsible Gambling | `responsible-gambling.html` |

## 3. `online-casino.html`

| Кнопка / ссылка | Ведёт на |
|---|---|
| Чип `What it is` | `#what` |
| Чип `Game types` | `#games` |
| Чип `RTP & volatility` | `#rtp` |
| Чип `Reading game rules` | `#rules` |
| Чип `Risks & limits` | `#risks` |
| Чип `FAQ` | `#faq` |
| Секция 01 · `See the live casino guide` | `live-casino.html` |
| Секция 01 · `See the crash games guide` | `crash-games.html` |
| Секция 05 · `Read the responsible gambling guide` | `responsible-gambling.html` |
| Related · Live Casino | `live-casino.html` |
| Related · Crash Games | `crash-games.html` |
| Related · Responsible Gambling | `responsible-gambling.html` |

## 4. `live-casino.html`

| Кнопка / ссылка | Ведёт на |
|---|---|
| Чип `What it is` | `#what` |
| Чип `Formats` | `#formats` |
| Чип `At the table` | `#table` |
| Чип `Live vs automated` | `#compare` |
| Чип `Risks & limits` | `#risks` |
| Чип `FAQ` | `#faq` |
| Секция 05 · `Read the responsible gambling guide` | `responsible-gambling.html` |
| Related · Online Casino | `online-casino.html` |
| Related · Bonuses | `bonuses.html` |
| Related · Responsible Gambling | `responsible-gambling.html` |

## 5. `crash-games.html`

| Кнопка / ссылка | Ведёт на |
|---|---|
| Чип `What they are` | `#what` |
| Чип `How a round works` | `#round` |
| Чип `Multipliers & cash out` | `#cashout` |
| Чип `Fairness & predictions` | `#fairness` |
| Чип `Risks & limits` | `#risks` |
| Чип `FAQ` | `#faq` |
| Секция 05 · `Read the responsible gambling guide` | `responsible-gambling.html` |
| Related · Online Casino | `online-casino.html` |
| Related · Virtual Sport | `virtual-sports.html` |
| Related · Responsible Gambling | `responsible-gambling.html` |

## 6. `virtual-sports.html`

| Кнопка / ссылка | Ведёт на |
|---|---|
| Чип `What it is` | `#what` |
| Чип `Formats` | `#formats` |
| Чип `Event to settlement` | `#settlement` |
| Чип `Virtual vs real vs esports` | `#compare` |
| Чип `Risks & limits` | `#risks` |
| Чип `FAQ` | `#faq` |
| Секция 03 · ссылка в тексте `sports betting` | `sports-betting.html` |
| Секция 05 · `Read the responsible gambling guide` | `responsible-gambling.html` |
| Related · Sports Betting | `sports-betting.html` |
| Related · Crash Games | `crash-games.html` |
| Related · Responsible Gambling | `responsible-gambling.html` |

## 7. `bonuses.html`

| Кнопка / ссылка | Ведёт на |
|---|---|
| Чип `What they are` | `#what` |
| Чип `Common types` | `#types` |
| Чип `Wagering requirements` | `#wagering` |
| Чип `Terms to check` | `#terms` |
| Чип `Offers & responsible play` | `#risks` |
| Чип `FAQ` | `#faq` |
| Секция 05 · `Read the responsible gambling guide` | `responsible-gambling.html` |
| Related · Sports Betting | `sports-betting.html` |
| Related · Online Casino | `online-casino.html` |
| Related · Responsible Gambling | `responsible-gambling.html` |

## 8. `responsible-gambling.html`

| Кнопка / ссылка | Ведёт на |
|---|---|
| Чип `What it means` | `#meaning` |
| Чип `Setting limits` | `#limits` |
| Чип `Signs of harm` | `#signs` |
| Чип `Breaks & self-exclusion` | `#break` |
| Чип `Finding support` | `#support` |
| Чип `FAQ` | `#faq` |
| Related · Sports Betting | `sports-betting.html` |
| Related · Online Casino | `online-casino.html` |
| Related · Bonuses | `bonuses.html` |

Секция 05 «Finding Support» — три карточки с пустыми пунктирными полями под
название, телефон, часы и сайт организации. Ссылок там нет намеренно: заполнить
проверенными контактами перед публикацией.

## 9. `faq.html`

| Кнопка / ссылка | Ведёт на |
|---|---|
| Чип `General` | `#general` |
| Чип `Sports betting` | `#sports` |
| Чип `Online casino` | `#casino` |
| Чип `Live casino` | `#live` |
| Чип `Crash games` | `#crash` |
| Чип `Virtual sport` | `#virtual` |
| Чип `Bonuses` | `#bonuses` |
| Чип `Responsible gambling` | `#responsible` |
| `Full sports betting guide` | `sports-betting.html` |
| `Full online casino guide` | `online-casino.html` |
| `Full live casino guide` | `live-casino.html` |
| `Full crash games guide` | `crash-games.html` |
| `Full virtual sport guide` | `virtual-sports.html` |
| `Full bonuses guide` | `bonuses.html` |
| `Full responsible gambling guide` | `responsible-gambling.html` |

---

## Чего нет

В ТЗ не заявлены **About Wrbet**, **Editorial policy**, **Contact**. Раньше
висели в футере главной с `href="#top"` — кликались, но никуда не вели.
Убраны. Если нужны — сверстаю в том же каркасе и верну в колонку About.

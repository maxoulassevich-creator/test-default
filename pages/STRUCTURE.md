# Структура внутренних страниц — сокращённая

Основано на ТЗ заказчика и структуре, подготовленной GPT. Секции сокращены
примерно на 30%: было 7–8 блоков на страницу, стало **5 содержательных + FAQ**.
Все ключи из ТЗ сохранены, ни один не потерян.

## Что и почему объединено

Сокращение сделано не отбрасыванием блоков, а слиянием тех, что отвечают на
один и тот же вопрос читателя. Ни одна тема из исходной структуры не выпала.

| Страница | Было | Стало | Что слито |
|---|---|---|---|
| Sports Betting | 7 | 5 + FAQ | «Markets» + «Singles, Accumulators, Cash Out» → один блок о том, на что и как ставят. «Implied probability» — врезка внутри блока о коэффициентах |
| Online Casino | 7 | 5 + FAQ | «How RNG Works» → внутрь блока о RTP: и то и другое отвечает «как устроена математика игры» |
| Live Casino | 7 | 5 + FAQ | «How a Round Works» + «Table Rules, Limits, Connection» → один блок о практике за столом |
| Crash Games | 7 | 5 + FAQ | «Round Results and Fairness» + «Questions About Predictions» → один блок: оба про «можно ли предсказать» |
| Virtual Sports | 7 | 5 + FAQ | «How Betting Works» + «Odds, Results and Settlement» → одна цепочка от события до расчёта |
| Bonuses | 7 | 5 + FAQ | «Terms to Check» + «How to Read an Offer» → чек-лист с разобранным примером |
| Responsible Gambling | 8 | 5 + FAQ | «Understanding Risks» → во вводный блок; «Supporting Someone» → в блок поддержки |

Секции держим короткими: 2–4 абзаца либо одна сетка карточек. Длинные разборы
уходят в карточки и таблицы, а не в сплошной текст.

## Ключи

Пять ключей заданы в ТЗ явно, два предложены GPT по теме. Ключ идёт в Title,
H1 и первый абзац — дальше по тексту в естественных формулировках, без
повторения в каждом подзаголовке.

| Страница | Основной ключ | Источник | Файл |
|---|---|---|---|
| Sports Betting | `Sports Betting` | ТЗ | `sports-betting.html` |
| Online Casino | `Online casino` | ТЗ | `online-casino.html` |
| Live Casino | `live casino` | ТЗ | `live-casino.html` |
| Crash Games | `Crash games` | ТЗ | `crash-games.html` |
| Virtual Sports | `Virtual sport` (ед. ч.) | ТЗ | `virtual-sports.html` |
| Bonuses | `betting bonuses` | предложен | `bonuses.html` |
| Responsible Gambling | `responsible gambling` | предложен | `responsible-gambling.html` |
| FAQ | `wrbet faq` | дополнение ТЗ | `faq.html` |

Дополнительные фразы из старых метатегов сохранены и распределены по блокам:
`sports betting online`, `live betting odds`, `online casino wrbet`,
`live casino wrbet`, `crash games online`, `virtual sports betting`,
`Wrbet Kenya`.

## Метаописания

ТЗ требует убрать из мета всё про бонусы и добавить ответственную игру. Старые
мета содержали «150 FS on 1st deposit», «Bonus up to 100%», «up to 25% bonus» —
всё это убрано. В каждом описании есть упоминание рисков или личных лимитов.

---

## 1. Sports Betting

**Title:** Sports Betting Online: Odds, Markets & Rules | Wrbet Kenya
**Description:** How sports betting online works in Kenya — odds formats, markets, live betting odds and settlement. Includes risks, personal limits and responsible gambling.

**H1 · Sports Betting in Kenya: Odds, Markets and Rules**

1. **How Sports Betting Online Works** — цепочка «событие → рынок → исход → расчёт» схемой, короткий текст под ней.
2. **Betting Odds Explained** — десятичные, дробные, американские. Таблица расчёта выплаты. Врезка: implied probability и маржа букмекера.
3. **Markets and Bet Types** — карточки 1X2, Over/Under, Handicap, BTTS. Ниже — одиночные, экспрессы, cash out.
4. **Live Betting Odds** — таблица сравнения Pre-Match и Live: когда размещают, что меняется, темп решений.
5. **Betting Risks and Personal Limits** — коротко, переход на Responsible Gambling.
6. **FAQ** — 5 вопросов.

Связанные: Virtual Sports, Bonuses, Responsible Gambling.

## 2. Online Casino

**Title:** Online Casino Guide: Games, RTP and Risks | Wrbet Kenya
**Description:** Online casino game types, RTP, volatility and house edge explained. What to check in game rules, plus personal limits and responsible gambling.

**H1 · Online Casino in Kenya: Games, Rules and Risks**

1. **What Is an Online Casino** — формат и категории игр, разграничение с Live Casino и Crash Games.
2. **Game Types** — карточки Slots, Roulette, Blackjack, Video Poker.
3. **RTP, Volatility and House Edge** — три подраздела + объяснение RNG внутри этого же блока.
4. **How to Read Casino Game Rules** — чек-лист: таблица выплат, комбинации, спецсимволы, размер ставки, ограничения.
5. **Casino Risks and Setting Limits** — коротко.
6. **FAQ** — 5 вопросов.

Связанные: Live Casino, Crash Games, Responsible Gambling.

## 3. Live Casino

**Title:** Live Casino Guide: Dealer Games and Rules | Wrbet Kenya
**Description:** How live casino works — dealer tables, round timing, table limits and connection issues. Includes risks, session limits and responsible gambling.

**H1 · Live Casino in Kenya: How Dealer Games Work**

1. **What Is Live Casino** — трансляция, дилер, интерфейс, информация о раунде.
2. **Common Live Casino Formats** — карточки Roulette, Blackjack, Baccarat, Game Shows.
3. **At the Table: Round, Limits and Connection** — схема раунда плюс правила стола, таймер, обрыв связи.
4. **Live and Automated Games Compared** — таблица: проведение раунда, дилер, темп, интерфейс.
5. **Live Casino Risks and Session Limits** — коротко.
6. **FAQ** — 5 вопросов.

Связанные: Online Casino, Bonuses, Responsible Gambling.

## 4. Crash Games

**Title:** Crash Games Online: Multipliers and Rules | Wrbet Kenya
**Description:** How crash games online work — multipliers, crash point, cash out and round results. Includes risks, personal limits and responsible gambling.

**H1 · Crash Games Online: Multipliers, Rules and Risks**

1. **What Are Crash Games** — формат и словарь: Multiplier, Crash Point, Cash Out, Auto Cash Out.
2. **How a Round Works** — схема раунда с иллюстрацией, подпись «Illustrative example».
3. **Multipliers and Cash Out** — учебный расчёт, ручная и автоматическая фиксация.
4. **Fairness and Predictions** — как определяется результат, что такое provably fair, почему прошлые раунды ничего не предсказывают.
5. **Crash Game Risks and Personal Limits** — коротко.
6. **FAQ** — 5 вопросов.

Связанные: Online Casino, Virtual Sports, Responsible Gambling.

## 5. Virtual Sports

**Title:** Virtual Sport Guide: Rules and Settlement | Wrbet Kenya
**Description:** How virtual sport works — simulated events, formats, odds and settlement rules. Includes risks, personal limits and responsible gambling.

**H1 · Virtual Sport in Kenya: How Simulated Events Work**

1. **What Is Virtual Sport** — определение и термины Virtual Event, Simulation, Schedule, Settlement.
2. **Virtual Sports Formats** — карточки: футбол, теннис, гонки.
3. **From Event to Settlement** — цепочка «событие → рынок → приём ставок закрыт → расчёт», чтение коэффициентов и проверка результата.
4. **Virtual, Real Sport and Esports Compared** — таблица трёх направлений.
5. **Virtual Sports Risks and Personal Limits** — коротко.
6. **FAQ** — 5 вопросов.

Связанные: Sports Betting, Crash Games, Responsible Gambling.

## 6. Bonuses

**Title:** Betting Bonuses Explained: Terms and Conditions | Wrbet Kenya
**Description:** Understand betting bonuses — wagering requirements, eligible games, time limits and withdrawal restrictions, with personal limits and responsible gambling.

**H1 · Betting Bonuses: Understanding Terms and Conditions**

1. **What Are Betting Bonuses** — Cash Balance, Promotional Balance, Eligibility.
2. **Common Types** — карточки Welcome Bonus, Free Bet, Free Spins, Cashback, Reload.
3. **Wagering Requirements** — к какой сумме применяется, как считается оборот, учебный числовой пример с пометкой.
4. **Terms to Check, with an Example** — чек-лист параметров и разобранный образец условий с комментариями.
5. **Offers and Responsible Gambling** — коротко.
6. **FAQ** — 5 вопросов.

Связанные: Sports Betting, Online Casino, Responsible Gambling.

> Страница объясняет **условия** предложений, а не рекламирует их. Конкретных
> размеров бонусов на ней нет — это соответствует требованию ТЗ убрать
> бонусную информацию из мета и снизить рекламный тон.

## 7. Responsible Gambling

**Title:** Responsible Gambling: Limits, Signs and Support | Wrbet Kenya
**Description:** Responsible gambling in Kenya — setting deposit and time limits, recognising signs of harm, taking a break, self-exclusion and where to find support.

**H1 · Responsible Gambling in Kenya: Limits, Awareness and Support**

1. **What Responsible Gambling Means** — понятие и осознанное решение об участии; сюда же финансовые, временные и эмоциональные риски.
2. **Setting Personal Limits** — карточки: лимит расходов, лимит времени, проверка активности.
3. **Recognising Signs of Harm** — список признаков и короткие вопросы для самопроверки.
4. **Taking a Break and Self-Exclusion** — Time-Out, Self-Exclusion, Account Closure: чем отличаются.
5. **Finding Support in Kenya** — организации и способы обращения; здесь же как поддержать близкого.
6. **FAQ** — 5 вопросов.

Связанные: все тематические страницы.

> Контакты организаций поддержки я не выдумываю. В вёрстке блок сделан с
> явными местами под названия и ссылки и полем «дата последней проверки» —
> заполнить проверенными данными перед публикацией.

## 8. FAQ

**Title:** Frequently Asked Questions | Wrbet Kenya
**Description:** Answers about sports betting, online casino, live casino, crash games, virtual sport, bonus terms and responsible gambling in Kenya.

**H1 · Frequently Asked Questions**

Одна страница-аккордеон, вопросы сгруппированы по темам — по 5 из каждой
тематической страницы плюс общие. Из главной таблица FAQ сокращается, полный
список переезжает сюда (требование ТЗ).

---

## Единый каркас страницы

Порядок блоков одинаковый на всех восьми:

```
хлебные крошки → H1 + вводный абзац + оглавление чипами
→ 5 содержательных секций → FAQ → связанные страницы → CTA → футер
```

Дизайн, вёрстка, стили и анимация — те же, что на главной: общие
`assets/css/style.css` и `assets/js/main.js`, палитра, шрифты Sora + Public
Sans, reveal при скролле, аккордеон на нативном `<details>`.

## Навигация

После сборки страниц:

- добавить их в хедер и в бургер-меню;
- добавить в футер;
- проставить ссылки с карточек секции 4 главной страницы;
- сократить FAQ на главной, оставив 4–5 вопросов и ссылку на `faq.html`.

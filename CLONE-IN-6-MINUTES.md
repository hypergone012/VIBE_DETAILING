# Новая студия за 6 минут

Новая студия — это папка `tenants/<slug>/` (один `business.json` + фото) и три команды.
Исходники не меняются, ранее опубликованные студии не затрагиваются.

Проверено на этом репозитории (локальный Supabase, прод-сборка): от `tenant:new` до
`tenant:verify --browser` 10/10 — **36 секунд машинного времени**; остальное — время
человека на текст и фото. Предполагается, что окружение уже настроено (SETUP.md).

---

### 0:00 — создать папку (10 с)

```bash
pnpm tenant:new avtoluch --name "Детейлинг «Автолуч»" --accent "#2BB673" --timezone Europe/Moscow
# или взять готовую студию за основу:  --from graphite   (скопирует услуги, часы и фото)
```

`slug` — латиница, цифры и дефис: он станет адресом `/s/avtoluch/` и кабинетом
`/s/avtoluch/owner/`.

### 0:10 — заполнить `tenants/avtoluch/business.json` (≈ 3 мин)

Редактор подсказывает поля по `tenants/business.schema.json`. Главное:

| Поле | Пример | Заметки |
|---|---|---|
| `name`, `shortName` | «Детейлинг «Автолуч»», «Автолуч» | `shortName` ≤ 24 символов — подпись под иконкой |
| `tagline`, `description` | одна строка / 2–3 предложения | |
| `accentColor` | `#2BB673` | единственный цвет бренда; контраст текста на нём считается сам |
| `timezone` | `Europe/Moscow` | все часы и даты — по времени студии |
| `contacts` | `phone`, `address`, `addressNote`, `mapUrl` | помощник отвечает «как найти» по ним |
| `hours` | `"mon": "09:00-21:00"`, `"sun": "closed"` | можно с перерывом: `"08:00-13:00, 14:00-20:00"` |
| `resources` | боксы/посты/подъёмники | одна машина на ресурс одновременно |
| `services` | `price` в рублях, `duration` `"1h 30m"` / `"2d"`, `buffer` `"15m"` | `resources` — где можно делать; `priceFrom: true` → «от» |
| `infoCards` | ровно 3 карточки | `icon`: sparkle, shield, clock, drop, car, star, wrench, medal, coffee, camera |
| `booking` | `slotStepMinutes`, `minLeadMinutes`, `horizonDays`, `cancelUntilHours` | правила записи и онлайн-отмены |
| `owner.email` | почта владельца | на неё создаётся вход в кабинет |
| `demo` | `true` пока это образец | перед запуском убрать |

### 3:10 — фото (≈ 1 мин)

```
tenants/avtoluch/images/logo.png      квадрат от 512 px (иконка приложения, maskable делается сам)
tenants/avtoluch/images/hero.jpg      от 1200 px, лучше вертикальное 4:5, машина в нижней половине
tenants/avtoluch/images/works/*.jpg   от 800 px; подписи — в "works" в business.json
```

Конвейер сам сожмёт фото в WebP, сделает иконки 192/512, maskable, apple-touch 180 и
12 заставок iOS.

### 4:10 — проверить и опубликовать образец (≈ 30 с)

```bash
pnpm tenant:validate avtoluch     # ошибки по-русски: какое поле и что не так
pnpm tenant:publish avtoluch      # данные → база (preview), фото → Storage, аккаунт владельца
```

`tenant:publish` печатает **пароль владельца один раз** — передайте его владельцу.
Образец: записи помечаются как демо, уведомления не отправляются, вверху плашка «Образец».

### 4:40 — выложить оболочку и проверить ссылку (≈ 1 мин)

```bash
git add tenants/avtoluch && git commit -m "Studio avtoluch" && git push
pnpm deploy:vercel                # или: pnpm deploy:cloudflare
pnpm tenant:verify avtoluch --url https://ваш-домен --browser
```

`tenant:verify` проверяет 10 пунктов: оболочку этой студии на глубоких ссылках, кабинет
(noindex, свой manifest), manifest id/start_url/scope, иконки и maskable, apple-touch,
service worker со своим scope, данные из API, фото, наличие свободного времени и что
Chrome готов установить приложение.

### 5:40 — запуск

Когда данные настоящие: уберите `"demo": true` и выполните

```bash
pnpm tenant:publish avtoluch --live
```

Строгая проверка: нет флага `demo`, указан `owner.email`, не осталось заглушек
(«ЗАПОЛНИТЬ», «демо-адрес», `000-00-00`, example.com…), фото нужного размера и не меньше
трёх работ. После неё студия становится live, демо-записи образца удаляются, напоминания
начинают отправляться.

---

**Повторная публикация** того же `business.json` безопасна: записи, оплаты и всё, что
владелец поменял в кабинете (тексты, цены, часы, фото), сохраняются.
**Ссылки**: клиентам — `https://ваш-домен/s/avtoluch/`, владельцу — `…/s/avtoluch/owner/`.

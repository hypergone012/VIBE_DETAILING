# SETUP — локальный запуск, Supabase и публикация

Одна сборка фронтенда и один проект Supabase обслуживают все студии:
клиентская страница `/s/{slug}/`, кабинет владельца `/s/{slug}/owner/`.
Данные студии — в базе; `tenants/<slug>/business.json` + фото — вход конвейера.

Требования: Node 22+, pnpm 10 (`corepack enable`), Docker (для локального Supabase).
Supabase CLI ставится как dev-зависимость (`pnpm exec supabase …`), отдельно не нужен.

---

## 1. Локальный запуск (≈ 10 минут, большая часть — загрузка Docker-образов)

```bash
pnpm install
pnpm local:bootstrap        # supabase start → db reset (миграции + seed) → фото демо-студий
```

`local:bootstrap` поднимает Postgres/Auth/Storage/PostgREST/Edge Runtime, применяет
`supabase/migrations/*`, загружает `supabase/seed.sql` (две демо-студии с записями) и
выкладывает их фото в Storage. **После каждого `pnpm db:reset` повторите
`pnpm demo:media`**: сброс стирает записи о файлах в Storage.

Создайте `.env.local` (в git не попадает):

```bash
pnpm exec supabase status -o env | grep -E '^(API_URL|PUBLISHABLE_KEY)='
# перенесите значения в .env.local под именами:
#   VITE_SUPABASE_URL=http://127.0.0.1:54321
#   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_…
```

Запуск:

| Что | Команда | Адрес |
|---|---|---|
| Dev-сервер | `pnpm dev` | http://127.0.0.1:5173/s/graphite/ |
| Прод-сборка как на хостинге (SW, оболочки студий) | `pnpm build && pnpm preview` | http://127.0.0.1:4173/s/graphite/ |
| Edge Functions (помощник, рассылка) | `pnpm functions:serve` | http://127.0.0.1:54321/functions/v1/… |

Демо-студии и кабинеты (только локально, пароли из seed):

| Студия | Клиент | Кабинет | Вход |
|---|---|---|---|
| GRAPHITE Detailing | `/s/graphite/` | `/s/graphite/owner/` | `owner@graphite.example` / `demo-graphite-local` |
| Автосервис «Северный бокс» | `/s/severny-boks/` | `/s/severny-boks/owner/` | `owner@severny-boks.example` / `demo-severny-boks-local` |

Обе студии — **образцы** (preview): записи помечаются как демо, уведомления не отправляются.

### Помощник локально

Без `LLM_*` помощник работает в честном режиме «по шаблону»: те же серверные
инструменты, ответ собирается из данных, в интерфейсе пометка, что модель недоступна.
С моделью — любой OpenAI-совместимый endpoint:

```bash
export LLM_BASE_URL=https://api.openai.com/v1 LLM_API_KEY=sk-… LLM_MODEL=gpt-4.1-mini
pnpm functions:serve
```

Проверить цепочку «инструменты → модель» без ключа можно фейковым endpoint’ом
(это не языковая модель, он только сообщает, сколько результатов инструментов получил):
`pnpm dev:fake-llm` и `LLM_BASE_URL=http://host.docker.internal:54399/v1 LLM_API_KEY=fake LLM_MODEL=fake pnpm functions:serve`.

### Напоминания локально

```bash
pnpm push:vapid            # VITE_VAPID_PUBLIC_KEY → .env.local; остальное — в shell
export VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… VAPID_SUBJECT=mailto:… DISPATCH_SECRET=…
pnpm functions:serve
DISPATCH_SECRET=… pnpm exec tsx scripts/dev/check-cron-push.ts
```

Скрипт кладёт в Vault `project_url` (`http://kong:8000`) и `dispatch_secret`, создаёт
live-студию с записью и подпиской на локальный **фейковый** push-сервис и ждёт, пока
Supabase Cron (раз в минуту) вызовет `notifications-dispatch`; затем расшифровывает
доставленное сообщение. Реальная доставка на телефон требует настоящего push-сервиса
браузера (FCM/Apple/Mozilla) и открытого сайта по HTTPS.

### Проверки

```bash
pnpm verify                 # typecheck + lint + нет данных студий в src + unit + SQL-тесты
pnpm test:integration       # HTTP: Kong→PostgREST/GoTrue/Storage, помощник, рассылка, конвейер
pnpm build && pnpm test:e2e # Playwright: запись→кабинет, PWA/офлайн, Astryx/shadcn слои
pnpm tenant:verify graphite --browser
pnpm db:lint
```

---

## 2. Supabase (облако)

1. Создайте проект на supabase.com. Регион ближе к клиентам.
2. Свяжите репозиторий и примените миграции (демо-seed в облако **не** попадает):
   ```bash
   pnpm exec supabase login
   pnpm exec supabase link --project-ref <ref>
   pnpm exec supabase db push
   ```
   Миграции включают расширения `pg_cron`, `pg_net`, `btree_gist`, бакет `tenant-media`,
   RLS и GRANT’ы. Новые таблицы не публикуются в API без явных GRANT.
3. **Auth** (Dashboard → Authentication):
   - выключите «Allow new users to sign up» (регистрации нет, владельцев создаёт конвейер);
   - провайдер Email включён (вход владельца по паролю);
   - Site URL = ваш домен (`PUBLIC_SITE_URL`), Redirect URLs — тот же домен.
   Те же значения записаны в `supabase/config.toml`; можно применить `pnpm exec supabase config push`.
4. **Секреты Edge Functions** (только на сервере):
   ```bash
   pnpm exec supabase secrets set \
     LLM_BASE_URL=https://api.openai.com/v1 LLM_API_KEY=sk-… LLM_MODEL=gpt-4.1-mini \
     VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… VAPID_SUBJECT=mailto:you@example.com \
     DISPATCH_SECRET=… ASSISTANT_ALLOWED_ORIGINS=https://booking.example.com
   ```
   `SUPABASE_URL` и ключи сервиса платформа передаёт функциям сама.
5. **Функции**:
   ```bash
   pnpm exec supabase functions deploy assistant notifications-dispatch
   ```
   `verify_jwt = false` для обеих задан в `supabase/config.toml`: помощник сам проверяет
   режим (владелец — JWT + членство через `owner_session`), рассылку вызывает Cron с секретом.
6. **Cron → рассылка**. Задача `notifications-dispatch` (каждую минуту) создана миграцией;
   ей нужны два значения в Vault (SQL Editor):
   ```sql
   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
   select vault.create_secret('<тот же DISPATCH_SECRET>', 'dispatch_secret');
   -- проверка
   select jobname, schedule from cron.job;
   select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;
   ```
   Без этих секретов задача ничего не делает (тихо выходит).
7. Лимиты и бюджеты — в `private.app_config` (SQL): `rate.*` (запросы с одного IP),
   `llm.tenant_daily_requests`, `llm.tenant_daily_tokens`, `llm.global_daily_tokens`.

---

## 3. Фронтенд-хостинг (статический сайт)

Сборка одна для всех студий: `pnpm build` = Vite + оболочки `dist/s/{slug}/`
(свой HTML, manifest, иконки, maskable, apple-touch, заставки, `sw.js` со своим scope).
Переменные окружения сборки: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`,
`VITE_VAPID_PUBLIC_KEY`, `PUBLIC_SITE_URL`. Оболочки студий строятся из
`tenants/*/business.json` и фото в репозитории (база при сборке не нужна), поэтому
**папка новой студии должна быть закоммичена до деплоя**. Секретов в сборке нет.

**Vercel** — `vercel.json` уже содержит rewrites глубоких ссылок и заголовки.
Создайте проект (Framework: Other), задайте переменные окружения, затем
`pnpm deploy:vercel` (Vercel соберёт сам по `vercel.json`).

**Cloudflare Pages** — `pnpm build` кладёт `dist/_redirects` и `dist/_headers`.
`CF_PAGES_PROJECT=<имя> pnpm deploy:cloudflare` (или подключите репозиторий:
build `pnpm build`, output `dist`, те же переменные).

После деплоя: `pnpm tenant:verify <slug> --url https://ваш-домен --browser`.

---

## 4. Публикация студии (кратко; по шагам — CLONE-IN-6-MINUTES.md)

```bash
pnpm tenant:new <slug> --name "Название" --accent "#4690FF" --timezone Europe/Moscow
#   заполнить tenants/<slug>/business.json, положить фото в images/
pnpm tenant:validate <slug>
pnpm tenant:publish <slug>          # образец (preview) + аккаунт владельца, пароль печатается 1 раз
pnpm deploy:vercel                  # или deploy:cloudflare — оболочка /s/<slug>/
pnpm tenant:verify <slug> --url https://ваш-домен --browser
pnpm tenant:publish <slug> --live   # после проверки: строгая валидация, демо-записи удаляются
```

Переиздание (`tenant:publish` повторно) обновляет настройки из `business.json`, но
**сохраняет записи, оплаты и всё, что владелец изменил в кабинете** (поля из
`owner_overrides`, фото, загруженные владельцем). Другие студии не затрагиваются.

# Новая студия

1. Заполните `business.json` (подсказки в редакторе — из `tenants/business.schema.json`).
2. Положите фото в `images/`: `logo.png` (квадрат от 512 px), `hero.jpg` (от 1200 px,
   лучше вертикальное 4:5), работы в `images/works/` (от 800 px).
3. `pnpm tenant:validate <slug>` → `pnpm tenant:publish <slug>` → `pnpm build` → деплой →
   `pnpm tenant:verify <slug> --url https://ваш-домен`.
4. Когда данные настоящие: уберите `"demo": true`, укажите `owner.email` и выполните
   `pnpm tenant:publish <slug> --live`.

Подробно — `CLONE-IN-6-MINUTES.md` в корне репозитория.

# Deep Photos — запуск и деплой

Этот документ описывает текущий рабочий способ запуска Deep Photos из нашего репозитория.

Проект пока сохраняет часть upstream-имен Immich: сервисы, контейнеры, package names и некоторые переменные окружения могут называться `immich`. Для запуска нашего кода важно использовать compose-файл, который собирает локальные образы из этого репозитория.

## Требования

- Linux-сервер или рабочая машина с Docker Engine и Docker Compose v2.
- Git.
- Достаточно места на диске для фото/видео, PostgreSQL и ML cache.
- Для разработки без Docker: Node.js 24.x и pnpm 10.x, как указано в `package.json`.

## Быстрый production-запуск

1. Склонировать репозиторий:

```bash
git clone git@github.com:Qzarov/deep-media.git
cd deep-media
```

2. Создать env-файл:

```bash
cp docker/example.env docker/.env
```

3. Отредактировать `docker/.env`.

Минимально рекомендуется изменить:

```dotenv
UPLOAD_LOCATION=/srv/deep-photos
DB_PASSWORD=changeThisToALongRandomValue
DB_USERNAME=postgres
DB_DATABASE_NAME=immich
```

`UPLOAD_LOCATION` должен указывать на постоянный каталог. В production compose внутри него будут храниться:

- `${UPLOAD_LOCATION}/photos` — медиафайлы;
- `${UPLOAD_LOCATION}/postgres` — PostgreSQL data directory.

4. Запустить сборку и сервисы:

```bash
make prod
```

То же самое без Makefile:

```bash
docker compose -f ./docker/docker-compose.prod.yml up --build -V --remove-orphans
```

Приложение будет доступно на:

```text
http://localhost:2283
```

Для фонового режима:

```bash
docker compose -f ./docker/docker-compose.prod.yml up --build -d --remove-orphans
```

## Важное про compose-файлы

- `docker/docker-compose.prod.yml` — основной вариант для Deep Photos: собирает `immich-server:latest` и `immich-machine-learning:latest` из локального репозитория.
- `docker/docker-compose.dev.yml` — dev-окружение с live-кодом и отдельным web dev server.
- `docker/docker-compose.yml` — upstream-style compose, который тянет образы `ghcr.io/immich-app/...`. Для проверки наших изменений его использовать нельзя.
- `docker/docker-compose.rootless.yml` — rootless-вариант upstream-style compose, также не собирает наш локальный server image.

## Локальная разработка через Docker

1. Подготовить env:

```bash
cp docker/example.env docker/.env
```

2. Запустить dev compose:

```bash
make dev
```

Dev compose поднимает:

- API/server на `http://localhost:2283`;
- web dev server на `http://localhost:3000`;
- PostgreSQL на `localhost:5432`;
- machine-learning на `localhost:3003`.

Остановить:

```bash
make dev-down
```

Пересобрать dev-образы:

```bash
make dev-update
```

## Локальная разработка без Docker

Этот режим полезен для быстрых проверок кода, но сервисам всё равно нужны PostgreSQL и Redis.

Установка зависимостей:

```bash
pnpm install
pnpm --filter @immich/sdk run build
```

Проверки, которые обычно нужны перед коммитом:

```bash
pnpm --dir server run check
pnpm --dir server run lint
pnpm --dir web run check:typescript
pnpm --dir web run check:svelte
pnpm --dir web run lint
pnpm --dir web run build
```

Запуск server в watch mode:

```bash
pnpm --dir server run start:dev
```

Запуск web dev server:

```bash
pnpm --dir web run dev
```

## Миграции базы данных

В Docker production миграции выполняются приложением при старте штатным механизмом Immich/Deep Photos.

Для ручного запуска миграций из локального окружения:

```bash
pnpm --dir server run migrations:run
```

По умолчанию команда использует:

```text
postgres://postgres:postgres@localhost:5432/immich
```

Для другой базы передайте `DB_URL`:

```bash
DB_URL=postgres://postgres:password@localhost:5432/immich pnpm --dir server run migrations:run
```

## Обновление production-инсталляции

1. Перейти в репозиторий:

```bash
cd /path/to/deep-media
```

2. Получить свежий код:

```bash
git pull --ff-only origin main
```

3. Сделать backup базы и медиа перед обновлением.

4. Пересобрать и поднять сервисы:

```bash
docker compose -f ./docker/docker-compose.prod.yml up --build -d --remove-orphans
```

5. Проверить логи:

```bash
docker compose -f ./docker/docker-compose.prod.yml logs -f immich-server
```

## Бэкап и восстановление

Минимальный backup должен включать:

- PostgreSQL dump;
- каталог `${UPLOAD_LOCATION}/photos`;
- `docker/.env`;
- при необходимости `${UPLOAD_LOCATION}/postgres` как cold backup, только при остановленных контейнерах.

Пример dump базы:

```bash
docker exec immich_postgres pg_dump -U postgres -d immich > deep-photos.sql
```

Пример восстановления в пустую базу:

```bash
docker exec -i immich_postgres psql -U postgres -d immich < deep-photos.sql
```

Перед восстановлением остановите приложение, оставив доступной базу, либо выполняйте восстановление на отдельном окружении.

## Reverse proxy и HTTPS

Контейнер приложения слушает порт `2283`. За reverse proxy проксируйте HTTP/WebSocket трафик на:

```text
http://127.0.0.1:2283
```

Если proxy находится не на той же машине или использует отдельную docker-сеть, настройте доверенные proxy через `IMMICH_TRUSTED_PROXIES` в `docker/.env`.

Пример:

```dotenv
IMMICH_TRUSTED_PROXIES=10.0.0.0/8,172.16.0.0/12,192.168.0.0/16
```

## Проверка после деплоя

После запуска проверьте:

1. Открывается web UI на `http://host:2283`.
2. Первый вход/создание администратора доступен, если это новая установка.
3. Загружается файл и появляется в ленте.
4. Работает раздел `/folders`.
5. Создаётся папка, добавляются ассеты, открываются breadcrumbs.
6. ACL: пользователь получает доступ к папке и видит уведомление.
7. В логах `immich-server` нет циклических ошибок миграций, БД или Redis.

## Диагностика

Статус контейнеров:

```bash
docker compose -f ./docker/docker-compose.prod.yml ps
```

Логи server:

```bash
docker compose -f ./docker/docker-compose.prod.yml logs -f immich-server
```

Логи базы:

```bash
docker compose -f ./docker/docker-compose.prod.yml logs -f database
```

Остановка production compose:

```bash
make prod-down
```

или:

```bash
docker compose -f ./docker/docker-compose.prod.yml down --remove-orphans
```

## Ограничения текущей инструкции

- Публичные registry images для Deep Photos пока не описаны. Production compose собирает образы локально.
- Upstream `docker/docker-compose.yml` оставлен для совместимости, но не отражает наши изменения.
- Hardware acceleration для transcoding/ML наследуется от upstream compose snippets и требует отдельной настройки под конкретный сервер.

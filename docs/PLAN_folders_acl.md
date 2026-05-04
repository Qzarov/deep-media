# Deep Photos — План разработки: Папки, ACL, Фронтенд

## Общий план MVP

| # | Задача | Статус |
|---|--------|--------|
| 1 | Иерархия папок (бэкенд) | Done |
| 2 | ACL с наследованием (бэкенд) | Done |
| 3 | Интеграция фронтенда с Folder API | Done |
| 4 | Расширение shared links | Done |
| 5 | Аудит-лог | Planned |
| 6 | In-app уведомления | Planned |
| 7 | Русская локализация | Planned |

---

## 1. Иерархия папок (Done)

Реализовано в коммите `20ae346`.

- Таблица `folder` с `parentId` для вложенности
- Closure table (`folder_closure`) для эффективных запросов по дереву
- Полный CRUD: создание, обновление, перемещение, мягкое удаление
- Breadcrumbs, проверка циклических ссылок, уникальность имён на уровне
- Таблица `folder_asset` для привязки ассетов к папкам
- Таблица `folder_user` для ролей доступа

### API эндпоинты

| Метод | Путь | Описание |
|-------|------|----------|
| POST | /folders | Создать папку |
| GET | /folders | Корневые папки |
| GET | /folders/:id | Детали папки |
| GET | /folders/:id/children | Дочерние папки |
| GET | /folders/:id/breadcrumbs | Цепочка предков |
| PUT | /folders/:id | Обновить папку |
| PUT | /folders/:id/move | Переместить папку |
| DELETE | /folders/:id | Удалить (soft delete) |
| PUT | /folders/:id/assets | Добавить ассеты |
| DELETE | /folders/:id/assets | Удалить ассеты |
| PUT | /folders/:id/users | Добавить пользователей |
| PUT | /folders/:id/user/:userId | Обновить роль |
| DELETE | /folders/:id/user/:userId | Убрать пользователя |

### Файлы

- `server/src/schema/tables/folder.table.ts`
- `server/src/schema/tables/folder-closure.table.ts`
- `server/src/schema/tables/folder-asset.table.ts`
- `server/src/schema/tables/folder-user.table.ts`
- `server/src/schema/migrations/1777849565465-AddFolderTables.ts`
- `server/src/repositories/folder.repository.ts`
- `server/src/repositories/folder-user.repository.ts`
- `server/src/services/folder.service.ts`
- `server/src/controllers/folder.controller.ts`
- `server/src/dtos/folder.dto.ts`

---

## 2. ACL с наследованием прав (Done)

### Ролевая модель — `FolderUserRole` (6 ролей)

| Роль | Вес | Возможности |
|------|-----|-------------|
| Owner | 6 | Полный контроль |
| Administrator | 5 | Всё кроме управления владельцем |
| Editor | 4 | Просмотр, скачивание, загрузка, теги, структура |
| Contributor | 3 | Просмотр, скачивание, загрузка, теги |
| ViewerDownload | 2 | Просмотр, скачивание |
| Viewer | 1 | Только просмотр |

### Новые колонки в `folder_user`

| Колонка | Тип | Default | Назначение |
|---------|-----|---------|------------|
| effect | varchar | 'allow' | `allow` / `deny` — явный запрет блокирует наследование |
| restrictions | jsonb | '{}' | `{ noDownload?, noRawDownload? }` |
| validFrom | timestamptz | NULL | Начало временного доступа |
| validUntil | timestamptz | NULL | Конец временного доступа |

### Алгоритм разрешения прав — "ближайший предок побеждает"

1. Собрать все записи `folder_user` по цепочке предков (closure table), сортировка по `depth ASC`
2. Отфильтровать просроченные записи (temporal check)
3. Взять запись с минимальным depth — это "эффективная"
4. `deny` → доступ запрещён; `allow` + роль достаточна → доступ разрешён

SQL: `DISTINCT ON (id_descendant) ... ORDER BY depth ASC` → проверка `effect = 'allow'` и `role IN (accessRoles)`

### Новые эндпоинты

| Метод | Путь | Описание |
|-------|------|----------|
| GET | /folders/:id/permissions | Эффективные права текущего пользователя |
| GET | /folders/:id/access-matrix | Все пользователи с доступом (для Owner/Admin) |

### Новые Permission значения

- `Permission.FolderDownload` — минимальная роль ViewerDownload
- `Permission.FolderUpload` — минимальная роль Contributor

### Файлы (изменённые)

- `server/src/enum.ts` — `FolderUserRole`, `FolderEffect`, `getFolderRolesAtOrAbove()`, новые Permission
- `server/src/schema/enums.ts` — `folder_user_role_enum`
- `server/src/schema/tables/folder-user.table.ts` — новые колонки
- `server/src/schema/migrations/1777875306022-AddFolderAcl.ts` — миграция
- `server/src/repositories/access.repository.ts` — переписан `checkSharedFolderAccess` с deny/temporal
- `server/src/repositories/folder-user.repository.ts` — `getEffectivePermission()`, `getAllEffectivePermissions()`
- `server/src/utils/access.ts` — обновлены case'ы для FolderUserRole
- `server/src/dtos/folder.dto.ts` — новые DTO
- `server/src/services/folder.service.ts` — `getEffectivePermissions()`, `getAccessMatrix()`
- `server/src/controllers/folder.controller.ts` — 2 новых эндпоинта

### Что отложено (post-MVP)

- Водяные знаки, IP-ограничения
- Групповые роли (таблица `group`)
- ACL на уровне отдельных файлов (asset-level)
- Фоновая очистка просроченных записей
- Аудит-лог изменений прав

---

## 3. Интеграция фронтенда с Folder API (Done)

### Проблема

Фронтенд использует legacy path-based навигацию:
- `getUniqueOriginalPaths()` → плоские строковые пути
- `TreeNode.fromPaths()` → дерево из строк
- URL: `/folders?path=/Photos/2024`

SDK не содержит методов для нового Folder API (требуется полная регенерация).

### Решение — dual-mode

Пишем ручной API-клиент, сохраняем legacy view, добавляем новый ID-based view.

### Шаг 0: Бэкенд — `GET /folders/:id/assets`

Репозиторий `getAssetIds()` уже есть. Нужен эндпоинт.

- `server/src/controllers/folder.controller.ts` — `@Get(':id/assets')`
- `server/src/services/folder.service.ts` — `getAssets(auth, id)`

### Шаг 1: Ручной API-клиент

**Новый файл:** `web/src/lib/api/folder-api.ts`

- TypeScript типы (зеркало `server/src/dtos/folder.dto.ts`)
- Fetch-функции для всех эндпоинтов
- Использует `defaults.fetch` из `@immich/sdk`
- Помечен как временный — заменяется при регенерации SDK

### Шаг 2: Folder events

**Изменить:** `web/src/lib/managers/event-manager.svelte.ts`

Добавить: `FolderCreate`, `FolderUpdate`, `FolderDelete`, `FolderShare`, `FolderAddAssets`

### Шаг 3: Folder service

**Новый файл:** `web/src/lib/services/folder.service.ts`

По шаблону `album.service.ts`:
- `handleCreateFolder`, `handleUpdateFolder`, `handleDeleteFolder`, `handleMoveFolder`
- `handleAddFolderUsers`, `handleRemoveFolderUser`
- eventManager.emit() + toast уведомления

### Шаг 4: Folder store расширение

**Изменить:** `web/src/lib/stores/folders.svelte.ts`

- Оставить legacy path-based методы
- Добавить: `currentFolder`, `rootFolders`, `childFolders`, `breadcrumbs`, `folderAssets`
- Подписка на folder events для инвалидации кеша

### Шаг 5: Роутинг

**Изменить:** `web/src/lib/route.ts`
- `viewFolder: ({ id }) => /folders/${id}`

**Новые файлы:**
- `web/src/routes/(user)/folders/[folderId=id]/[[photos=photos]]/[[assetId=id]]/+page.ts`
- `web/src/routes/(user)/folders/[folderId=id]/[[photos=photos]]/[[assetId=id]]/+page.svelte`

### Шаг 6: Компоненты

- `web/src/lib/components/folders/FolderBreadcrumbs.svelte` — breadcrumbs по API
- `web/src/lib/components/folders/FolderGrid.svelte` — сетка дочерних папок
- `web/src/lib/modals/FolderCreateModal.svelte` — модалка создания

### Шаг 7: Кнопка "Create Folder" на legacy странице

**Изменить:** существующую `/folders` страницу — кнопка создания → модалка → редирект

### Ключевые решения

- **НЕ трогаем `TreeNode`** — он используется тегами
- **Dual-mode store** — legacy path-based + API-based
- **Sidebar оставляем** path-based (MVP)
- Ручной API-клиент → SDK при регенерации

---

## 4. Расширение shared links (Done)

Уже было в Immich: пароль, дата истечения, allowDownload, allowUpload, showExif, slug.

### Добавлено

| Фича | Реализация |
|------|------------|
| Счётчик просмотров | `viewCount` (integer, default 0) — инкремент при каждом `getMine()` |
| Лимит переходов | `visitLimit` (integer, nullable) — `null` = без лимита |
| Одноразовая ссылка | Частный случай: `visitLimit = 1` |
| Enforcement | `isValidSharedLink()` в auth.service.ts проверяет `viewCount >= visitLimit` |

### Файлы

- `server/src/schema/migrations/1777898106689-AddSharedLinkViewCount.ts` — миграция
- `server/src/schema/tables/shared-link.table.ts` — новые колонки viewCount, visitLimit
- `server/src/database.ts` — обновлены типы AuthSharedLink и SharedLink
- `server/src/dtos/shared-link.dto.ts` — visitLimit в create/edit DTO, viewCount+visitLimit в response
- `server/src/repositories/shared-link.repository.ts` — `incrementViewCount()`, authBuilder выбирает новые поля
- `server/src/services/auth.service.ts` — `isValidSharedLink()` проверяет visitLimit
- `server/src/services/shared-link.service.ts` — `getMine()` инкрементирует viewCount, create/update передают visitLimit

### Что отложено (post-MVP)

- Запрет репостинга (UI-only, без кнопки "поделиться")
- IP-ограничения
- Водяные знаки
- Shared links для папок (SharedLinkType.Folder + folderId)

---

## 5–7. Следующие этапы (Planned)

### 5. Аудит-лог
- Таблица audit_log: userId, action, resourceType, resourceId, timestamp, metadata
- Логирование всех действий с папками, ассетами, правами

### 6. In-app уведомления
- Уведомления о шаринге, изменении прав, комментариях
- WebSocket или polling для realtime

### 7. Русская локализация
- i18n ключи для всех новых строк
- Перевод UI элементов папок и ACL

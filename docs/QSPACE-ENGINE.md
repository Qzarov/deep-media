# Immich as the Q Space media engine

Q Space keeps the user's originals in plain folders on a home node. A sync agent owns those folders: it creates, moves and
deletes files. Immich only indexes them as an **external library**, mounted **read-only**, and provides thumbnails,
previews, EXIF, faces, CLIP search and video transcoding. The Q Space hub reads the results from the same database.

Upstream Immich assumes it may write to an external library and that a path is the identity of an asset. On a staging
server (Immich 2.7.5, library mounted `:ro`) that caused three problems:

| Upstream behaviour | Effect with a read-only folder owned by the agent |
| --- | --- |
| Emptying the trash unlinks the original and its `.xmp` | `EROFS` on unlink. The asset row is gone anyway, and the next scan imports the file again with a **new id** (faces, albums, favorites lost). |
| Editing description, rating, date, GPS or tags writes an `.xmp` sidecar next to the original | The write fails (the error is only logged). A sidecar row pointing to a missing file is created and the properties are unlocked, so the next metadata extraction **overwrites the edits**. |
| A moved or renamed file is a new asset | The old asset goes offline and a new one is created with a new id. |
| A scan always crawls every import path | The agent knows exactly which folder changed, but cannot ask for that folder only. |

This fork changes these points. Everything else is upstream behaviour.

## 1. No writes or deletes inside an external library

- `AssetService.handleAssetDeletion` never queues the original or the sidecar of an external asset (`isExternal`) for
  deletion. Generated files (thumbnails, previews, full size, edited versions, encoded video) are still removed; they live
  in Immich's own media location.
- `MetadataService.handleSidecarWrite` skips external assets (`JobStatus.Skipped`). Edits stay in the database only
  (`asset_exif`); the edited properties **stay locked**, so a later metadata extraction does not overwrite them with the
  values from the original. In Q Space the hub is the source of truth for edits.
- `AssetService.copy` does not unlink or create a sidecar for an external target asset.
- Reading stays as is: an `.xmp` that the user put next to an original is still discovered (`SidecarCheck`) and read.
- The read-only mount stays as the second lock.

### Trash: tombstones keep the id

Permanently deleting an external asset (empty trash, automatic trash cleanup, force delete) while its file is **still on
disk** keeps the asset row as a **tombstone** instead of removing it (`LibraryRepository.tombstoneAsset`):

- `status = 'deleted'`, `deletedAt` stays set (or is set now). The id, EXIF, album membership, tags and favorite remain.
- Generated data is removed: `asset_file` rows and their files, faces, CLIP embedding, OCR, job status.
- The next scan does not import the file again (`filterNewExternalAssetPaths` sees the row), and `LibrarySyncAssets`
  leaves a tombstone alone even when the file's mtime changes, so no thumbnails or faces are generated again.
- Tombstones without generated files are excluded from the deletion queues (`AssetDeleteCheck`, `AssetEmptyTrash`), so
  they are not processed again and again (`isExternalTombstone` in `utils/database.ts`).
- Tombstones are hidden everywhere: timeline, search, map, memories and all "queue missing" jobs filter on `deletedAt`.
- Moving the file (section 2) moves the tombstone with it, so a moved deleted file stays deleted.
- When the file disappears from disk, the scan marks the tombstone offline. After the trash period it is removed for
  real (offline assets are deleted with `deleteOnDisk = false`). A file that appears later at that path is a new asset.
- Restoring a tombstone is not exposed through the API. The hub decides what is deleted; deleting the file is the job of
  the sync agent, not of Immich.

Rows are still removed normally when the asset is offline (its file is gone) or when the whole library is deleted.

Readers of the shared database (the Q Space hub) must treat `status = 'deleted'` as deleted.

## 2. Assets moved on disk: `POST /libraries/:id/assets/move`

The agent reports moves and renames after it has performed them. The asset keeps its id, faces, embeddings, albums,
favorites, tags and edits; `originalPath`, `originalFileName` and the path checksum (`sha1("path:" + originalPath)`) are
updated. Generated files do not change (they are keyed by the asset id). A `SidecarCheck` is queued for every moved
asset, so a user `.xmp` next to the new path is picked up.

Permission: `library.update`, and the caller must be an admin or the owner of the library.

Batch of items (each item has `assetId` **or** `fromPath`):

```http
POST /api/libraries/5f0c…/assets/move
Content-Type: application/json

{
  "items": [
    { "fromPath": "/mnt/agent/Фото 2025/IMG_0001.jpg", "toPath": "/mnt/agent/Фото 2025/Отпуск/IMG_0001.jpg" },
    { "assetId": "0b5e3c1e-…", "toPath": "/mnt/agent/Архив/IMG_0002.jpg" }
  ]
}
```

Whole folder (every asset whose path is below `fromPrefix`):

```http
POST /api/libraries/5f0c…/assets/move
Content-Type: application/json

{ "fromPrefix": "/mnt/agent/Фото 2025", "toPrefix": "/mnt/agent/Архив/2025" }
```

Response (`200`), one result per item in request order (in prefix mode one per asset found):

```json
{
  "moved": 1,
  "failed": 1,
  "items": [
    { "assetId": "…", "fromPath": "/mnt/agent/Фото 2025/IMG_0001.jpg", "toPath": "/mnt/agent/Фото 2025/Отпуск/IMG_0001.jpg", "success": true },
    { "assetId": "0b5e3c1e-…", "toPath": "/mnt/agent/Архив/IMG_0002.jpg", "success": false, "error": "conflict", "message": "toPath is already used by asset 7d…" }
  ]
}
```

Rules:

- An item fails on its own; the other items are still applied. Items are applied one after another in request order,
  so a swap (`a → b`, `b → a`) cannot be done in one request.
- `not_found`: the asset is not an external asset of this library.
- `invalid_path`: `toPath` is not absolute, not inside the import paths, matches an exclusion pattern, or is not a
  supported media file.
- `not_on_disk`: `toPath` is not a file on disk (the agent must move the file first).
- `conflict`: another online asset already has `toPath`. This happens when a scan ran after the move but before the
  signal; send the move before asking for a scan. An **offline** asset at `toPath` is a stale row: it is deleted (with its
  generated files) in the same transaction and the moved asset takes its place.
- An offline asset that is moved comes back online. If it was in the trash only because it went offline, it leaves the
  trash; if a user trashed it, it stays in the trash. A tombstone stays a tombstone.
- Paths are compared exactly as the crawler stores them (`path.normalize`, no Unicode normalization).

## 3. Scan of selected folders: `POST /libraries/:id/scan`

The endpoint accepts an optional body. Without a body (or with `{}`) it scans the whole library, as upstream does.

```http
POST /api/libraries/5f0c…/scan
Content-Type: application/json

{ "paths": ["/mnt/agent/Фото 2025/Отпуск", "/mnt/agent/Входящие/IMG_0100.jpg"] }
```

- Each path must be absolute and inside one of the import paths (`400` otherwise). Paths inside other requested paths
  are dropped. A path does not have to exist: scanning a removed folder marks its assets offline.
- New files: only the given folders are crawled (`storageRepository.walk({ pathsToCrawl })`); a path to a single file
  imports that file if it is a supported, not hidden and not excluded media file.
- Existing assets: only the assets whose `originalPath` is a given path or lies below it (`starts_with`, separator aware)
  are checked for offline, online and changed files. The library wide import path / exclusion check
  (`detectOfflineExternalAssets`) runs only for full scans.
- A partial scan does not update `library.refreshedAt`.
- Permission is unchanged: `library.update`, admin only.

For Q Space turn off the nightly scan and the watcher in the system config (`library.scan.enabled = false`,
`library.watch.enabled = false`) and let the agent call this endpoint.

## Files

- `server/src/services/asset.service.ts`, `server/src/services/metadata.service.ts`: section 1.
- `server/src/services/library.service.ts`, `server/src/controllers/library.controller.ts`,
  `server/src/dtos/library.dto.ts`, `server/src/repositories/library.repository.ts`: sections 1–3.
- `server/src/repositories/asset-job.repository.ts`, `server/src/repositories/trash.repository.ts`,
  `server/src/utils/database.ts`: tombstones are not queued for deletion again.
- Tests: `server/src/services/qspace-engine.spec.ts`, `server/src/controllers/library.controller.spec.ts`,
  `server/test/medium/specs/services/qspace-engine.spec.ts`.

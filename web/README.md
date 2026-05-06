# Deep Photos Web

The web application uses SvelteKit. It is developed as part of the monorepo and is deployed through the server build.

Current fork-specific work includes folder navigation, Folder API integration, and ACL-aware UI flows.

Useful entry points:

- `web/src/lib/api/folder-api.ts`
- `web/src/lib/services/folder.service.ts`
- `web/src/lib/stores/folders.svelte.ts`
- `web/src/routes/(user)/folders`

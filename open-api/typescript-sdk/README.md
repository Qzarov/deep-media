# Deep Photos TypeScript SDK

The generated TypeScript SDK is still published and imported under the upstream `@immich/sdk` package name during the fork migration.

Use this package for typed API access from web and tooling code. Regenerate it through the OpenAPI workflow when backend DTOs or endpoints change.

```typescript
import { getAllAlbums, getMyUser, init } from '@immich/sdk';

init({ baseUrl: '<DEEP_PHOTOS_API_URL>', apiKey: '<API_KEY>' });

const user = await getMyUser();
const albums = await getAllAlbums({});
```

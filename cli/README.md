# Deep Photos CLI

Command-line tools for the Deep Photos monorepo.

The CLI still inherits upstream package and command names during the fork migration. Build the server and OpenAPI client before building the CLI:

```bash
pnpm install
pnpm run build
```

From `open-api/`, regenerate the client when API contracts change:

```bash
./bin/generate-open-api.sh
```

From this directory:

```bash
pnpm install
pnpm run build
node dist/index.js
```

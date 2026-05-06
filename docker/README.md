# Deep Photos Docker

Docker Compose files are inherited from the upstream monorepo while the fork is being migrated.

Use `docker-compose.prod.yml` or `make prod` to build and run the current Deep Photos code from this repository.

Do not use `docker-compose.yml` to validate fork-specific changes: it still points at upstream `ghcr.io/immich-app/...` images.

See `../docs/DEPLOYMENT.md` for the full run and deployment guide.

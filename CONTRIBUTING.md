# Contributing to Deep Photos

Deep Photos is currently a private fork under active product migration. Keep pull requests focused and describe the product impact clearly.

## Guidelines

- Prefer existing monorepo patterns over new abstractions.
- Keep changes scoped to the requested feature or fix.
- Update the technical specification or implementation plan when product behavior changes.
- Add tests when touching backend permissions, sharing, search, or user-facing workflows.

## Project Context

Start with:

- [Technical specification](docs/ТЗ_Облачное_хранилище.md)
- [Folders, ACL, and frontend plan](docs/PLAN_folders_acl.md)

The repository still contains upstream Immich technical names in package IDs, SDK imports, generated mobile code, and service names. Treat those as implementation details until a dedicated rename pass is scheduled.

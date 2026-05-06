# Deep Photos

Deep Photos is a fork of Immich focused on cloud photo and video storage with hierarchical folders, granular ACL, advanced indexing, and collaboration workflows.

## Project Documents

- [Technical specification](docs/ТЗ_Облачное_хранилище.md)
- [Folders, ACL, and frontend plan](docs/PLAN_folders_acl.md)

## Current Scope

Implemented MVP work:

- hierarchical folders on the backend;
- folder ACL with role inheritance, explicit deny rules, temporal access, and download restrictions;
- web integration for the new Folder API;
- shared link visit counters and visit limits.

Planned next:

- audit log for folder, asset, and permission actions;
- in-app notifications for sharing, permission changes, and collaboration events;
- Russian localization for the new product flows.

## Upstream

This codebase is based on Immich 2.7.5. Core package names and some technical namespaces still use upstream names while the fork is being migrated.

## Development

Use the package manager declared in [package.json](package.json). Local setup is inherited from the Immich monorepo until a Deep Photos-specific developer guide is written.

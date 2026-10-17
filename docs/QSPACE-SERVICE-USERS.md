# Q Space: service users and headless Immich

In Q Space, users exist only in the Q Space hub. Nobody signs in to Immich directly. Each hub user has an
Immich user with the **same UUID**. The hub calls the Immich API on that user's behalf with a shared service
token, and the Immich web client is switched off.

This fork adds three small server features for that setup. All of them are off unless their env variables are set.

| Env variable           | Default | Effect                                                                                  |
| ---------------------- | ------- | --------------------------------------------------------------------------------------- |
| `QSPACE_SERVICE_TOKEN` | unset   | Enables service access on behalf of a user. Unset or empty means disabled.              |
| `IMMICH_DISABLE_WEB`   | `false` | `true` stops the server from serving the web client (`/build/www` and SSR). API stays. |

## 1. Service access on behalf of a user

A request is a **service request** when `QSPACE_SERVICE_TOKEN` is set and the request carries an
`X-Qspace-User` header. It must also carry the token:

```
Authorization: Bearer <QSPACE_SERVICE_TOKEN>
X-Qspace-User: <uuid of the Immich user>
```

- The request is then handled as that user, with the full rights of that user, like a session. No API-key
  permission scoping applies. Admin-only routes still require that the user is an admin.
- The `X-Qspace-User` header is the switch. If it is present, the request is **only** checked as a service
  request: a missing or wrong token returns `401` and never falls back to session, cookie or API-key auth.
  Without the header, authentication works exactly as in upstream Immich.
- The token is compared in constant time (SHA-256 digests compared with `timingSafeEqual`).
- `X-Qspace-User` must be a valid UUID. The user must exist, must not be deleted (`deletedAt` is null), and its
  status must be `active`. Otherwise the server returns `401`. Immich has no separate "blocked" state, so a user
  being removed (`removing`) or deleted (`deleted`) counts as blocked.
- WebSockets (`/api/socket.io`) use the same check, so the hub can subscribe to events as a user by sending the
  same two headers in the handshake.
- Logging: a rejected token is logged at `warn` level and a rejected user at `warn` level with the user id. A
  successful service request is logged at `verbose` level with the user id. The token is never logged.

### Why `Authorization: Bearer` and a separate user header

The token travels in the standard `Authorization` header, so proxies and HTTP clients treat it as a credential
(redaction, no caching). Immich already reads a Bearer value as a session token. That is why the
`X-Qspace-User` header decides which check runs, and a service request never falls through to session lookup.

### Network

There is no IP allow-list in the server. Immich's auth layer only sees headers, not the client address. Keep
the Immich port on the internal network between the hub and Immich, and do not publish it. If Immich ever sits
behind a public reverse proxy, strip `X-Qspace-User` and `Authorization` from outside requests there.

### Example

```bash
curl -s http://immich:2283/api/users/me \
  -H "Authorization: Bearer $QSPACE_SERVICE_TOKEN" \
  -H "X-Qspace-User: 6f1c3a52-8d4e-4b7a-9c21-0e5d7f3b9a14"
```

## 2. Creating a user with a given id

`POST /api/admin/users` accepts an optional `id` (UUID). That lets the hub create the Immich user with the same id
as the hub user.

- `id` is accepted **only** in a service request. With a normal admin session or API key, a body with `id`
  returns `400`. Without `id`, the endpoint behaves exactly as before.
- The route is admin-only, so the service request must act as an existing Immich **admin**: set `X-Qspace-User`
  to the admin's UUID. The hub must know that UUID, from its config or because the admin was itself created
  with the hub owner's id.
- If a user with that id already exists, the server returns `400` (`User id is not available`). This includes
  soft-deleted users. Users are created one at a time, and there is no bulk upsert.
- An id that is not a valid UUID returns `400` from validation.

```bash
curl -s -X POST http://immich:2283/api/admin/users \
  -H "Authorization: Bearer $QSPACE_SERVICE_TOKEN" \
  -H "X-Qspace-User: $IMMICH_ADMIN_UUID" \
  -H 'Content-Type: application/json' \
  -d '{"id":"6f1c3a52-8d4e-4b7a-9c21-0e5d7f3b9a14","email":"anna@example.com","name":"Anna","password":"<random>"}'
```

If OAuth is disabled, Immich requires a password. The hub can send a long random one, because nobody signs in
to Immich.

## 3. Running without the web client

With `IMMICH_DISABLE_WEB=true`, the server does not register the static file handler for the web build or the
SSR fallback that returns `index.html` for non-API paths. Other paths return Nest's 404. `/api/*` and
`/.well-known/immich` keep working. Without the variable, the web client is served as before.

# ZhongMap on Cloudflare

Live at https://zhongmap.com (custom domain, DNS on Cloudflare; the old https://zhongmap.seanmichaelbateman.workers.dev still works). Workers free plan + D1 database `zhongmap`.
Replaces the Synology NAS server (`synology-scripts/server-current.js`).

- `src/index.js` – the API (`/api/*`). Free plan = 10 ms CPU per request, so big read-only data is not loaded by the Worker.
- `public/app` – the web app: `npx expo export --platform web` in the app folder, then copy `dist` here (git-ignored).
- `public/data` – dictionary, Daily Sentences candidates, per-character sentences, compound lists, split into small files
  (git-ignored). Built by `node scripts/build-cloudflare-data.mjs <sentence-corpus.json> <word-meanings.json> <characters.json>`
  from the app folder; the first two come from `scripts/build-sentence-corpus.mjs`.
- `schema.sql` – D1 tables. New database: `npx wrangler d1 execute zhongmap --remote --file=schema.sql`.

## Deploy

```bash
npx wrangler deploy
```

## Copy data from the NAS (wipes and replaces D1's user data)

```bash
node scripts/migrate-nas-to-d1.mjs Z:/chinese-word-map/database/chinese-app.db
```

## Tests

Local: `npx wrangler d1 execute zhongmap --local --file=schema.sql`, add the bcrypt test user
(`INSERT INTO users (id, username, password_hash) VALUES (900, 'oldbcrypt', '$2a$10$EEFuO83w.4JN3N0xyR9lO.j/8YSNbtdD80LZb4QzMbMznevtFzYam')`
via `npx wrangler d1 execute zhongmap --local --command ...`), run `npx wrangler dev --port 8787 --local`, then `node --test test/api.test.mjs`.

Live (throwaway account, removed afterwards, never touches shared data): `node scripts/smoke-live.mjs`.

## Notes

- Passwords from the NAS are bcrypt (~100 ms CPU); they're re-saved as PBKDF2 on first login.
- Google Translate doesn't answer Cloudflare's servers, so the PhrasePump extension translates from the browser;
  the server's `/api/pp/translate*` only work if Google lets them through.
- `buckets.js` numbering is copied into the extension's `background.js` — change both together.

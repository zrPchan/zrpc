# Sand Study — Push demo server

This is a small demo server to help test Web Push for the Sand Study project.

Features:
- Serves the static project files from the parent directory for convenience
- Endpoints:
  - `GET /vapidPublicKey` — returns the VAPID public key (if configured)
  - `POST /api/register-subscription` — register a subscription JSON from the client
  - `POST /api/unregister-subscription` — remove a subscription
  - `POST /api/send` — sends the provided payload to all saved subscriptions

Setup:
1. Install dependencies:

```powershell
cd server
npm install
```

2. Generate VAPID keys (if you don't have any):

```powershell
npx web-push generate-vapid-keys --json > vapid.json
```

Place the generated `vapid.json` into the `server/` directory (it has `publicKey` and `privateKey`).

3. Start the server:

```powershell
npm start
```

4. In the web app (`index.html`), click "Push 登録" and allow notifications. The client will try to fetch `/vapidPublicKey` automatically. If not found, paste the public key manually.

5. To test sending a push from the server, POST to `/api/send` with JSON body, or use the server's UI (not provided) — example using curl:

```powershell
curl -X POST http://localhost:3000/api/send -H "Content-Type: application/json" -d "{ \"title\": \"テスト\", \"body\": \"Push テスト\" }"
```

Notes:
- This demo stores subscriptions in `server/subscriptions.json`.
- For production use, store subscriptions in a database and secure endpoints.
- iOS behavior:
  - Web Push support is available in recent iOS versions (16.4+). Test on target devices.
  - Notification sound is controlled by iOS; web cannot attach arbitrary custom sounds.

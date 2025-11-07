Vercel + Deta quick deploy

This project contains a small PWA and demo server logic. The `api/` folder provides Vercel-compatible serverless endpoints that use Deta Base to persist push subscriptions.

Required environment variables (set in Vercel dashboard > Project Settings > Environment Variables):

- DETA_PROJECT_KEY : your Deta project key
- VAPID_PUBLIC_KEY : your Web Push VAPID public key
- VAPID_PRIVATE_KEY : your Web Push VAPID private key
- VAPID_SUBJECT : (optional) mailto: or URL used in VAPID claims
- ADMIN_API_TOKEN : secret token to protect admin endpoints (send / list-subscriptions). Provide a strong random string and pass it as `Authorization: Bearer <token>` or `x-api-key: <token>` when calling admin endpoints.

Quick steps:

1. Generate VAPID keys (if you don't have them):

   node -e "const webpush=require('web-push');console.log(JSON.stringify(webpush.generateVAPIDKeys()))"

   Save the keys somewhere safe and copy them to Vercel env vars.

2. Create a Deta project: https://deta.sh/ and get the Project Key.

3. Set the above env vars in your Vercel project.

4. Push this repo to GitHub and import it in Vercel (or connect directly to your Git provider). Vercel will deploy the site and the API endpoints will be available under `https://<your-deploy>/api/*`.

Notes:

- The client should fetch the public key from `/api/vapidPublicKey` when subscribing.
- Admin actions (send) are available at `/api/send` (POST). For production, protect any admin UI/endpoints (authentication).
- This is a minimal conversion for demo / testing; consider adding authentication and using a proper datastore if you expect many subscriptions.


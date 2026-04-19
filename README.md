# HumanizeAI

A production-ready AI text humanizer with working Stripe subscriptions, built with Next.js 14 and the Anthropic API.

Paste AI text → pick a tone → get human-sounding writing in seconds. Free users get 5 humanizations/day and 500 chars per request. Pro ($12/mo) gets unlimited everything.

---

## Features

- 🎨 **Polished dark UI** — hero, interactive tool, examples, pricing, testimonials
- 🔐 **Secure API integration** — Anthropic API key stays server-side
- 💳 **Real Stripe subscriptions** — checkout, webhook, cancellation handling all working
- 🎯 **Conversion-optimized** — upgrade modal triggers after the 2nd free use (the sweet spot)
- 🚦 **Smart rate limiting** — hybrid Upstash Redis + in-memory fallback, Pro users skip limits
- 🍪 **HMAC-signed Pro cookies** — no auth system needed for MVP; works purely off Stripe's session data
- 📱 **Fully responsive** — stacks cleanly on mobile

---

## Quick start (local dev)

```bash
# 1. Install dependencies
npm install

# 2. Set up environment
cp .env.example .env.local

# 3. Fill in at minimum:
#    - ANTHROPIC_API_KEY (required — from console.anthropic.com)
#    - APP_SECRET (required — generate with the command below)
#      node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 4. Run dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The humanizer works without Stripe — users just can't upgrade. See below to enable payments.

---

## Setting up Stripe (one-time, ~15 min)

### 1. Create your Stripe product

- Go to [dashboard.stripe.com/products](https://dashboard.stripe.com/products) (use **test mode** toggle first)
- Click **+ Add product**
  - Name: `HumanizeAI Pro`
  - Pricing: Recurring, $12.00 USD, Monthly
- Save it. On the product page, copy the **Price ID** (starts with `price_...`) → this is your `STRIPE_PRO_PRICE_ID`

### 2. Get your API keys

- [dashboard.stripe.com/apikeys](https://dashboard.stripe.com/apikeys)
- Copy the **Secret key** (starts with `sk_test_...`) → `STRIPE_SECRET_KEY`

### 3. Set up the webhook

The webhook tells your app when subscriptions start, renew, or cancel.

**For local testing:**
```bash
# Install Stripe CLI — https://stripe.com/docs/stripe-cli
stripe login
stripe listen --forward-to localhost:3000/api/webhook
# This prints a webhook secret (whsec_...) → STRIPE_WEBHOOK_SECRET
```

**For production:**
- [dashboard.stripe.com/webhooks](https://dashboard.stripe.com/webhooks) → **+ Add endpoint**
- URL: `https://yourdomain.com/api/webhook`
- Events to send:
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
- After creating, click the endpoint → copy the **Signing secret** → `STRIPE_WEBHOOK_SECRET`

### 4. Fill in `.env.local`

```bash
ANTHROPIC_API_KEY=sk-ant-...
APP_SECRET=<your-random-hex-string>
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRO_PRICE_ID=price_...
```

### 5. Test the flow

- `npm run dev`
- Humanize some text twice — the upgrade modal should appear after the 2nd use
- Click Upgrade → redirected to Stripe Checkout
- Use test card `4242 4242 4242 4242`, any future date, any CVC
- After checkout → redirected to `/success` → cookie is set → humanizer now shows "Pro — unlimited"

When you're ready to accept real money, flip the Stripe dashboard toggle from Test → Live and swap the `sk_test_` / `whsec_` / `price_` values for their live equivalents.

---

## Deploying to Vercel

1. Push this repo to GitHub.
2. Go to [vercel.com/new](https://vercel.com/new), import the repo.
3. In **Environment Variables**, add all the values from `.env.local`.
4. Also set `NEXT_PUBLIC_APP_URL` to your live URL (e.g., `https://humanize-ai.vercel.app`).
5. Deploy.
6. After deploy, go to Stripe → Webhooks → add endpoint pointing to `https://yourdomain.com/api/webhook`, grab the new signing secret, update `STRIPE_WEBHOOK_SECRET` in Vercel env, redeploy.

---

## Production rate limiting (Upstash)

The default in-memory rate limiter works but resets on every deploy and doesn't sync across serverless instances. For real traffic, add Upstash Redis (free tier = 10k commands/day):

1. Create a free Redis DB at [upstash.com](https://upstash.com).
2. Copy the **REST URL** and **REST Token**.
3. Add both to Vercel's env vars:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`

The rate limiter auto-detects Upstash and uses it. Redis also stores subscription status, so if a customer cancels their subscription, they lose Pro access immediately (otherwise they'd keep it until the cookie expires 35 days later).

---

## Project structure

```
.
├── app/
│   ├── api/
│   │   ├── humanize/route.js       # Main endpoint — checks Pro, rate limits, calls Anthropic
│   │   ├── checkout/route.js       # Creates Stripe Checkout sessions
│   │   ├── webhook/route.js        # Stripe → updates subscription status in Redis
│   │   ├── verify-session/route.js # Confirms payment, issues Pro cookie
│   │   └── me/route.js             # Client-side Pro status check
│   ├── success/page.jsx            # Post-checkout success page
│   ├── cancel/page.jsx             # Post-checkout cancel page
│   ├── globals.css
│   ├── layout.jsx
│   └── page.jsx                    # Main landing page + tool + upgrade modal
├── lib/
│   ├── ratelimit.js                # Hybrid Redis/in-memory limiter
│   └── pro.js                      # HMAC token signing + Pro detection
├── .env.example
├── jsconfig.json
├── next.config.js
└── package.json
```

---

## How the conversion flow works

1. User lands, tries humanizer → works, they see quality output.
2. User hits humanize again (2nd use) → upgrade modal appears 1.2s after the output renders. This timing is deliberate — they've just seen it work twice, momentum is highest, and they haven't hit the daily limit yet (which feels punitive rather than aspirational).
3. Modal can be dismissed → stored in localStorage, won't show again for 24 hours.
4. If user runs out of free daily uses → inline upgrade button on the error message + inline "go unlimited" link under the remaining-uses counter.
5. If user pastes >500 chars → warning banner with inline upgrade link.
6. Clicking any upgrade path → POST `/api/checkout` → Stripe Checkout → success page → Pro cookie set → future requests skip all limits + UI shows "Pro" badge everywhere.

The modal timing is the single biggest conversion lever. Test different thresholds (2nd vs 3rd use) once you have real traffic data.

---

## Configuration

| Variable                    | Required | Purpose                                      |
| --------------------------- | -------- | -------------------------------------------- |
| `ANTHROPIC_API_KEY`         | Yes      | Your Anthropic API key                       |
| `APP_SECRET`                | Yes      | Random hex string for signing Pro tokens     |
| `STRIPE_SECRET_KEY`         | For $    | Stripe secret key                            |
| `STRIPE_WEBHOOK_SECRET`     | For $    | Stripe webhook signing secret                |
| `STRIPE_PRO_PRICE_ID`       | For $    | Your Pro subscription Price ID               |
| `NEXT_PUBLIC_APP_URL`       | Prod     | Your live URL (for Stripe redirects)         |
| `UPSTASH_REDIS_REST_URL`    | Scale    | Enables Redis-backed rate limit + sub state  |
| `UPSTASH_REDIS_REST_TOKEN`  | Scale    | Paired with the URL above                    |
| `FREE_DAILY_LIMIT`          | Optional | Default `5`                                  |
| `FREE_CHAR_LIMIT`           | Optional | Default `500`                                |

---

## Cost math

At Haiku pricing with ~500-char inputs:
- **Per humanization:** ~$0.003
- **Free tier (5/day):** ~$0.015/user/day = ~$0.45/user/month
- **Pro (realistic 10 uses/day):** ~$0.90/month in costs vs. $12 revenue = 92% margin

Stripe takes 2.9% + 30¢ per transaction. On $12/mo that's ~$0.65, leaving ~$10.45 gross per Pro subscriber.

---

## Security notes

- API key and Stripe secrets are server-side only (never exposed to client).
- Pro tokens use HMAC-SHA256 with constant-time comparison.
- Webhook signatures are verified on every Stripe event.
- Cookies are `httpOnly`, `secure` (prod), `sameSite=lax`.
- Rate limit runs before any expensive operation.
- `APP_SECRET` rotation invalidates all active Pro cookies.

---

## Next steps

1. **Real auth** — Clerk or Supabase Auth. Right now, Pro status is tied to a cookie, so users can't access Pro from a different device without re-verifying. Adding auth solves this and unlocks per-user analytics.
2. **Usage logging** — store every humanization in Postgres (Supabase free). Critical for abuse detection, feature decisions, and support requests.
3. **SEO landing pages** — 20+ pages targeting "humanize AI for [X]" long-tail keywords. This is how Quillbot won the niche.
4. **Chrome extension** — "Humanize" button injected into any text field. Massive distribution channel.
5. **AI detection scoring** — integrate GPTZero's API, show a score after humanization.
6. **Annual plan** — add a Stripe Price for `$99/year` (~30% off), offer on the upgrade modal. Roughly 40% of SaaS buyers pick annual when offered.

---

## License

MIT — do whatever you want with it.

# CrediMail Form Worker

A production-ready Cloudflare Worker that receives POST form submissions and forwards them to `info@credimail.co.za` via email using the **Resend** email service. Includes built-in spam prevention, rate limiting, and a responsive HTML form.

## Features

✅ **Form Submission Handling**
- Accepts JSON, `application/x-www-form-urlencoded`, and `multipart/form-data`
- Robust input validation (name, email, message)

✅ **Spam Prevention**
- Honeypot field detection
- Time-based submission trap (minimum 3 seconds)
- Rate limiting (3 submissions per IP per 10 minutes)
- Content filtering (URL count, blacklisted keywords)

✅ **Email Forwarding**
- Sends formatted HTML emails via Resend API
- Includes submission timestamp and IP for audit trails
- Configurable sender and recipient

✅ **CORS Support**
- Configurable allowed origins
- Preflight `OPTIONS` request handling

✅ **Responsive HTML Form**
- Mobile-friendly design
- Real-time validation feedback
- Loading states and error messages
- No external dependencies

---

## Prerequisites

- **Node.js** (v16 or later) and **npm**
- **Cloudflare account** (free tier supported)
- **Resend account** (free tier provides 3,000 emails/month)
  - Sign up at https://resend.com

---

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Create KV Namespace

Create a Cloudflare Workers KV namespace for rate limiting:

```bash
npx wrangler kv namespace create RATE_LIMIT_KV
```

This will output an ID and preview ID. Update `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "RATE_LIMIT_KV"
id = "YOUR_KV_NAMESPACE_ID"
preview_id = "YOUR_KV_PREVIEW_ID"
```

### 3. Add Resend API Key

Store your Resend API key as a Worker secret:

```bash
npx wrangler secret put RESEND_API_KEY
```

When prompted, paste your Resend API key (available in your Resend dashboard).

### 4. Configure Allowed Origin (Optional)

In `wrangler.toml`, update the `ALLOWED_ORIGIN` variable to match your website domain:

```toml
[vars]
ALLOWED_ORIGIN = "https://credimail.pages.dev"
```

Or use a custom domain:

```toml
[vars]
ALLOWED_ORIGIN = "https://credimail.com"
```

---

## Local Development

Run the Worker locally:

```bash
npm run dev
```

This starts a local server (default: `http://localhost:8787`).

### Test the Worker

**Health check:**
```bash
curl http://localhost:8787/
```

**Submit a form (JSON):**
```bash
curl -X POST http://localhost:8787/submit \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Doe",
    "email": "john@example.com",
    "message": "Hello, this is a test message from your contact form."
  }'
```

**Test with form-urlencoded:**
```bash
curl -X POST http://localhost:8787/submit \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "name=Jane%20Doe&email=jane@example.com&message=This%20is%20a%20test."
```

---

## Deployment

### Deploy to Cloudflare Workers

```bash
npm run deploy
```

The Worker will be deployed to your Cloudflare account. You'll receive a unique URL (e.g., `https://credimail-form-worker.mygithu932.workers.dev`).

### Verify Deployment

```bash
curl https://your-deployed-worker.workers.dev/
```

You should receive:
```json
{"status":"ok"}
```

---

## Connecting to Cloudflare Pages

### Option 1: Use the Worker URL Directly

1. Deploy this Worker.
2. Copy the Worker's public URL.
3. In `public/form.html`, replace `WORKER_URL`:

```javascript
const WORKER_URL = 'https://your-deployed-worker.workers.dev/submit';
```

4. Deploy your Pages site.

### Option 2: Route through Pages

If your Pages site has a custom domain (e.g., `credimail.com`):

1. Go to your Cloudflare account → **Workers & Pages** → **Overview**.
2. Select this Worker and create a **route**:
   - Route: `https://credimail.com/api/submit`
   - Worker: `credimail-form-worker`

3. In `public/form.html`, use:

```javascript
const WORKER_URL = 'https://credimail.com/api/submit';
```

---

## Environment Variables & Secrets

| Name                  | Type   | Required | Description                                    |
|-----------------------|--------|----------|------------------------------------------------|
| `RESEND_API_KEY`      | Secret | ✅ Yes   | API key from Resend (https://resend.com)       |
| `RATE_LIMIT_KV`       | KV     | ✅ Yes   | Workers KV namespace for rate limiting        |
| `ALLOWED_ORIGIN`      | Var    | ⚠️  Maybe | CORS allowed origin (default: `*` if not set)  |

### Setting Secrets

```bash
# Set Resend API key
npx wrangler secret put RESEND_API_KEY

# List all secrets
npx wrangler secret list
```

---

## Configuration

### Validation Rules

Modify in `src/index.js` → `VALIDATION_RULES`:

```javascript
const VALIDATION_RULES = {
  name: {
    minLength: 2,
    maxLength: 100,
    pattern: /^[a-zA-Z0-9\s]+$/,
    errorMsg: '...'
  },
  email: {
    maxLength: 254,
    pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    errorMsg: '...'
  },
  message: {
    minLength: 10,
    maxLength: 5000,
    errorMsg: '...'
  }
};
```

### Spam Detection

**Honeypot**: Add/remove fields in `public/form.html`:
```html
<input type="text" name="website" class="honeypot" tabindex="-1" />
```

**Blacklisted Keywords** (modify in `src/index.js`):
```javascript
const SPAM_KEYWORDS = [
  'viagra',
  'casino',
  // Add more as needed
];
```

**Rate Limit** (change in `src/index.js`):
```javascript
const RATE_LIMIT_MAX = 3;              // Max submissions
const RATE_LIMIT_WINDOW = 10 * 60;     // Window in seconds (10 min)
```

**Time Trap** (minimum seconds before submission):
```javascript
const SPAM_TIME_TRAP_MIN_SECONDS = 3;  // Adjust as needed
```

---

## Custom Domain

### Option 1: Custom Domain on Worker

1. In Cloudflare **Workers & Pages** → Select this Worker → **Settings** → **Triggers**.
2. Add a custom domain under **Routes**.
3. Example: `form.credimail.co.za` → `credimail-form-worker`

### Option 2: Subdomain Route

1. Create a DNS record: `form.credimail.co.za` (CNAME to Cloudflare).
2. In Cloudflare dashboard → **Workers & Pages** → Add a route.
3. Route: `https://form.credimail.co.za/*` → Worker: `credimail-form-worker`

---

## Testing

### Unit Tests (Manual)

**Test spam detection:**
```bash
curl -X POST http://localhost:8787/submit \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test User",
    "email": "test@example.com",
    "message": "Check out this free bitcoin giveaway! http://spam1.com http://spam2.com http://spam3.com http://spam4.com"
  }'
```

**Expected response:** `403 Spam detected.`

**Test rate limiting:**
```bash
for i in {1..5}; do
  curl -X POST http://localhost:8787/submit \
    -H "Content-Type: application/json" \
    -d '{"name":"User","email":"user@test.com","message":"Test message number '$i'."}'
  echo "\nRequest $i sent\n"
done
```

**Expected:** Requests 4+ return `429 Too many submissions.`

---

## Troubleshooting

### "RESEND_API_KEY not configured"

```bash
npx wrangler secret put RESEND_API_KEY
```

Ensure you've added your Resend API key.

### "Rate limiting not working"

Verify that the KV namespace ID is correct in `wrangler.toml`:

```bash
npx wrangler kv namespace list
```

### "CORS errors in browser"

1. Check that `ALLOWED_ORIGIN` in `wrangler.toml` matches your site's domain.
2. Redeploy after updating:
   ```bash
   npm run deploy
   ```

### "Form never receives emails"

1. Check that Resend API key is valid (test at https://resend.com).
2. Verify recipient email: `info@credimail.co.za` (in `src/index.js`).
3. Enable Resend logs in your dashboard.

---

## API Reference

### `GET /`

Health check endpoint.

**Response:**
```json
{"status":"ok"}
```

---

### `POST /submit`

Form submission endpoint.

**Request (JSON):**
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "message": "Hello, I have a question...",
  "website": "",
  "_timestamp": 1694000000000
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Thank you! Your message has been sent."
}
```

**Validation Error (400):**
```json
{
  "success": false,
  "errors": {
    "name": "Name is required and must be 2–100 characters...",
    "email": "A valid email address is required.",
    "message": "Message must be between 10 and 5000 characters."
  }
}
```

**Spam Detected (403):**
```json
{
  "success": false,
  "error": "Spam detected."
}
```

**Rate Limited (429):**
```json
{
  "success": false,
  "error": "Too many submissions. Please try again later."
}
```

**Server Error (500):**
```json
{
  "success": false,
  "error": "Failed to send message. Please try again later."
}
```

---

## Architecture

```
┌─────────────────┐
│  HTML Form      │
│ (public/form.html)
└────────┬────────┘
         │
      fetch()
         │
         ▼
┌─────────────────────────┐
│  Cloudflare Worker      │ ◄─── CORS validation
│  (src/index.js)         │ ◄─── Input validation
└────────┬────────────────┘ ◄─── Spam detection
         │                  ◄─── Rate limiting (KV)
         │
         ├─► Honeypot check
         ├─► Time trap check
         ├─► Rate limit check (Workers KV)
         └─► Content filter
         │
         ▼
┌─────────────────────────┐
│  Resend API             │
│ (api.resend.com)        │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│  Email Sent to          │
│  info@credimail.co.za   │
└─────────────────────────┘
```

---

## Security Best Practices

✅ **Input Validation**: All form fields are validated server-side.
✅ **Rate Limiting**: Prevents abuse using KV-backed IP tracking.
✅ **Spam Detection**: Honeypot, time trap, content filtering, and URL limits.
✅ **CORS**: Restricted to configured domain only.
✅ **Secrets**: API keys stored securely via Wrangler secrets.
✅ **Audit Trail**: Submission timestamp and IP logged in email.
✅ **No Logging**: User data is never logged or exposed in responses.

---

## License

MIT

---

## Support

For issues or questions:

1. Check the [Troubleshooting](#troubleshooting) section.
2. Review [Cloudflare Workers docs](https://developers.cloudflare.com/workers/).
3. Review [Resend docs](https://resend.com/docs).
4. Open an issue on this repository.

---

**Made with ❤️ for CrediMail**

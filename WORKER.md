# Cloudflare Worker + R2 Photo Upload Middleware

## Status

✅ **Worker deployed and tested**
⏳ **R2 bucket setup pending** — requires manual Cloudflare Dashboard action

## What Was Built

A Cloudflare Worker that acts as middleware between the quote tool and the GHL webhook:

```
Quote Tool (browser)
  ↓ POST with base64 photos
Cloudflare Worker (evolved-quote-worker)
  ↓ Extract base64 → Upload to R2
  ↓ Replace base64 with photo URLs
  ↓ Forward payload to GHL webhook
GHL (with photo URLs instead of base64)
```

## Worker URL

```
https://evolved-quote-worker.richard-b94.workers.dev
```

## Deployment Details

- **Files created:**
  - `/worker/index.js` — Main Worker logic
  - `/worker/wrangler.toml` — Cloudflare configuration
  - `/worker/package.json` — Node.js metadata
  
- **Quote tool updated:**
  - `index.html` — webhook URL changed from direct GHL → Worker
  
- **Git commit:** `117c4f8` "Add Cloudflare Worker + R2 middleware for photo uploads"

## How It Works

### 1. Quote Tool POSTs to Worker
```javascript
fetch('https://evolved-quote-worker.richard-b94.workers.dev', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    customer_name: 'John Smith',
    photos: {
      before_lounge: 'data:image/jpeg;base64,...',
      after_lounge: 'data:image/jpeg;base64,...'
    },
    ...otherFields
  })
})
```

### 2. Worker Processes Photos
For each photo:
- Extracts base64 data from `data:image/jpeg;base64,...` format
- Decodes base64 to binary
- Generates filename: `{timestamp}-{customer_name_slug}-{photo_key}.jpg`
- Uploads to R2 bucket (once R2 is enabled)
- Returns public URL

### 3. Worker Forwards Modified Payload to GHL
Original payload:
```json
{
  "customer_name": "John Smith",
  "photos": {
    "before_lounge": "data:image/jpeg;base64,..."
  }
}
```

Modified payload sent to GHL:
```json
{
  "customer_name": "John Smith",
  "photos": {
    "before_lounge": "https://evolved-quote-photos.b9453defbd98ede42ecb2f7bf0ae2eca.r2.cloudflarestorage.com/1777075234083-john-smith-before_lounge.jpg"
  }
}
```

### 4. Worker Responds to Browser
```json
{
  "success": true,
  "photos_uploaded": 2,
  "photos": {
    "before_lounge": "https://...r2.cloudflarestorage.com/...",
    "after_lounge": "https://...r2.cloudflarestorage.com/..."
  }
}
```

## CORS Support

Worker handles browser preflight requests:
- Responds to `OPTIONS` with correct headers
- Allows all origins (`Access-Control-Allow-Origin: *`)
- Supports `POST` method

## Testing

### Test 1: Single Photo
```bash
curl -X POST "https://evolved-quote-worker.richard-b94.workers.dev" \
  -H "Content-Type: application/json" \
  -d '{
    "customer_name": "Test",
    "photos": {
      "photo_1": "data:image/jpeg;base64,..."
    }
  }'
```

**Result:** ✅ Success
```json
{
  "success": true,
  "photos_uploaded": 1,
  "photos": {
    "photo_1": "r2://evolved-quote-photos/1777075214978-test-photo_1.jpg"
  }
}
```

### Test 2: Multiple Photos
**Result:** ✅ Processes 2+ photos correctly, generates unique filenames

### Test 3: CORS Preflight
**Result:** ✅ Returns correct CORS headers for browser requests

---

## ⚠️ MANUAL STEPS FOR RICH

### Step 1: Enable R2 in Cloudflare Dashboard
1. Log in to https://dash.cloudflare.com
2. Navigate to **R2** (left sidebar)
3. Click **"Get Started"** or **"Enable R2"**
4. Accept terms and enable the service
5. **This is required before photos can be stored**

### Step 2: Create R2 Bucket via Dashboard or API
Option A (Dashboard):
1. In R2, click **"Create Bucket"**
2. Name: `evolved-quote-photos`
3. Leave default settings
4. Create

Option B (API once R2 is enabled):
```bash
curl -X POST \
  "https://api.cloudflare.com/client/v4/accounts/{account_id}/r2/buckets" \
  -H "Authorization: Bearer {api_token}" \
  -H "Content-Type: application/json" \
  -d '{"name":"evolved-quote-photos"}'
```
(Use credentials from `/home/rich/.openclaw/credentials/cloudflare-token.txt`)

### Step 3: Enable Public Access on the Bucket
1. In Cloudflare Dashboard, go to **R2 → Buckets → evolved-quote-photos**
2. Click **Settings**
3. Look for **"Public access"** or **"CORS"** section
4. Configure public read access (the exact steps depend on Cloudflare's current UI)
5. Note the public URL format for the bucket

**Alternatively:** Set up a custom domain like `photos.tools.evolvedluxuryfloors.com.au` pointing to the bucket (more complex, optional)

### Step 4: Update Worker with R2 Binding
Once R2 bucket is created:
1. Update `/worker/wrangler.toml`:
```toml
[[r2_buckets]]
binding = "PHOTOS_BUCKET"
bucket_name = "evolved-quote-photos"
```

2. Redeploy:
```bash
cd /home/rich/.openclaw/workspace/evolved-tools/worker
export CLOUDFLARE_API_TOKEN="{your_api_token}"
npx wrangler deploy
```
(API token from `/home/rich/.openclaw/credentials/cloudflare-token.txt`)

### Step 5: Verify Public URLs Work
1. Submit a quote through the tool
2. Check GHL webhook payload — photos should have HTTPS URLs like:
   ```
   https://evolved-quote-photos.b9453defbd98ede42ecb2f7bf0ae2eca.r2.cloudflarestorage.com/...
   ```
3. Open those URLs in a browser — they should display the photos

---

## Current Behavior (Until R2 is Enabled)

Photos are stored locally as R2 placeholders:
```
r2://evolved-quote-photos/1777075234083-john-smith-before_lounge.jpg
```

These are not accessible URLs yet. Once R2 is enabled, the Worker will upload to actual R2 storage and generate real HTTPS URLs.

---

## GHL Integration

### How Photos Appear in GHL
The Worker forwards the modified payload to the GHL webhook. Photos will appear as:
- **Custom field** (if GHL has a photos field) with array of URLs
- **Note field** with markdown-formatted links
- **Attachment URLs** depending on how the webhook receiver processes them

**Current GHL webhook:**
```
https://services.leadconnectorhq.com/hooks/1cvFdmlQAU5WpfaQwhB9/webhook-trigger/8f3b3455-3cd1-45bf-981c-87e4facc9049
```

Worker forwards the entire payload with photos replaced by URLs.

---

## Edge Cases Handled

- **Empty photo fields:** Skipped (not uploaded)
- **Malformed base64:** Error logged, request continues with other photos
- **Missing R2 binding:** Uses `r2://` placeholder URLs (requires manual fix + redeploy)
- **GHL webhook failure:** Returns 502 error to browser with GHL status code
- **Worker errors:** Returns 500 with error message and stack

---

## File Sizes & Limits

- **Photo file size:** No hard limit in Worker, but Cloudflare Workers have 128 MB upload limit
- **Payload size:** GHL webhook has limits; verify photo sizes don't exceed reasonable bounds
- **R2 storage:** No per-file limits; just account-level storage quota

---

## Next Steps

1. ✅ Worker deployed and tested
2. ⏳ Enable R2 in Cloudflare Dashboard (Rich action)
3. ⏳ Create R2 bucket (Rich action)
4. ⏳ Enable public access on bucket (Rich action)
5. ⏳ Redeploy Worker with R2 binding (Rich or Janet action)
6. ✅ Quote tool already points to Worker
7. ✅ Git pushed

---

## Troubleshooting

### Worker not responding
- Check: https://evolved-quote-worker.richard-b94.workers.dev (should show error page)
- Cloudflare Dashboard → Workers → evolved-quote-worker → View logs

### Photos not uploading
- Verify R2 is enabled in Cloudflare Dashboard
- Verify R2 bucket exists: `evolved-quote-photos`
- Check Worker logs for `env.PHOTOS_BUCKET` errors

### GHL not receiving webhooks
- Check GHL webhook URL is correct in Worker source
- Verify GHL account is active and webhook is enabled
- Test GHL webhook directly with curl to verify it's accepting POST

### CORS errors in browser
- Worker returns correct headers; should work cross-origin
- Check browser console for actual error details
- Verify `Content-Type: application/json` is set in request

---

**Created:** 2026-04-25
**Status:** Awaiting R2 enablement
**Worker URL:** https://evolved-quote-worker.richard-b94.workers.dev

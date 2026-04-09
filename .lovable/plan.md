

## Plan: Create "saipos-data-proxy" Edge Function

A new edge function that proxies requests to the Saipos Data API, allowing external projects to use this project's `SAIPOS_API_TOKEN`.

### What will be built

**File: `supabase/functions/saipos-data-proxy/index.ts`**

- CORS preflight handler (OPTIONS)
- POST handler that:
  1. Extracts `url` from request body
  2. Validates URL starts with `https://data.saipos.io/` — rejects otherwise (400)
  3. Fetches the URL with `Authorization: Bearer <SAIPOS_API_TOKEN>`
  4. Returns the Saipos response as JSON
- No JWT verification needed (public proxy, URL validation is the security layer)
- CORS headers on all responses

### Security

- URL whitelist: only `https://data.saipos.io/` prefix allowed
- Token never exposed to callers — stays server-side


---
name: domain-availability-checker
description: Batch-check domain availability with the domain-tool API, using low-pressure polling and clear result handling.
---

# Domain Availability Checker Skill

Use this skill when the user wants to find, generate, filter, or recommend available domain names.

This project exposes a batch domain availability API. The API checks DNS first and falls back to WHOIS-style lookup for domains that have no DNS records.

## API

Base URL is the running domain-tool site. In the browser-hosted app, use relative URLs.

- `POST /api/check`
- Content-Type: `application/json`
- Maximum request size: 60 domains per request

Basic request:

```json
{
  "domains": ["apple.ai", "banana.co", "testxyz12345.com"]
}
```

Typical response:

```json
[
  {"status":"success","result":"available","domain":"testxyz12345.com"},
  {"status":"success","result":"unavailable","domain":"apple.ai"},
  {"status":"success","result":"timeout","domain":"banana.co"}
]
```

## Result meanings

- `available`: the domain appears available for registration.
- `unavailable`: the domain appears registered or otherwise unavailable.
- `wait`: the upstream lookup is still processing. This appears only when `allowWait: true` is used.
- `timeout`: the domain did not settle in this request window. Do not treat it as registered; list it separately as needing a later retry.

## Low-pressure batch strategy

When checking many domains:

1. Normalize candidates to lowercase fully-qualified domain names.
2. Validate domains before calling the API. A valid domain contains at least one dot, labels are 1-63 chars, labels start/end with letters or digits, and only letters, digits, and hyphens are allowed.
3. Prefer 25 domains per batch for large lists, even though the API accepts up to 60.
4. Run batches serially unless the user explicitly asks for faster but riskier querying.
5. Wait about 1.8 seconds between large batches.
6. If a response contains `timeout`, retry those domains later instead of immediately hammering the endpoint.

## Advanced polling contract

For tools or scripts that need to distinguish `wait` from `timeout`:

1. Call `GET /api/session` once before the batch and keep the returned `cookie`.
2. Create a stable `session` string for that batch.
3. Initial request: send `domains`, `session`, `cookie`, and `allowWait: true`.
4. For domains still returning `wait`, poll with the same `session` and `cookie`, plus `isPoll: true` and `allowWait: true`.
5. Use exponential backoff between polls: about 2s, 3.5s, 5s, 6.5s.
6. Stop after a small fixed number of rounds, then report remaining `wait` domains as unresolved/timeouts.

Example polling payload:

```json
{
  "domains": ["testxyz12345.com"],
  "session": "stable_batch_session_001",
  "cookie": "WHMCS...; ipaddress=...",
  "allowWait": true,
  "isPoll": true
}
```

## Agent behavior

When the user asks for domain recommendations:

- Generate candidates from the user's constraints first.
- Query candidates in safe batches.
- Present `available` domains first.
- Give short reasons for high-value recommendations, such as brevity, memorability, pronunciation, keyword match, number pattern, or brand fit.
- Put `timeout` or unresolved domains in a separate "needs retry" section.
- Never claim a `timeout` domain is registered or unavailable.
- Do not repeatedly retry in a tight loop; this API intentionally uses a low-pressure strategy to avoid upstream rate limits.

## Example cURL

```bash
curl -X POST https://YOUR_DOMAIN/api/check \
  -H "Content-Type: application/json" \
  -d '{"domains":["apple.ai","google.com","testxyz12345.com"]}'
```

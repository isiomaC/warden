# Webhook approvals

Use a signed webhook approval channel when Warden confirmations should be
reviewed by an internal application, on-call system, ticket workflow, or a
custom approval UI.

Warden never sends an approval decision to your service. It sends a signed
approval request and polls your service for a signed decision. Your service is
responsible for authenticating its operators and recording their decisions.

## Before you begin

You need:

- a Warden hook server connected to an agent integration that supports
  `CONFIRM` decisions;
- an HTTPS receiver reachable from the machine running `warden start`;
- a high-entropy shared secret, stored outside `warden.config.yml`; and
- an authenticated operator workflow in the receiver.

Configure one interactive approval channel per hook-server process. Do not
configure Telegram and webhook channels together: Telegram takes precedence
when both are present. A missing, malformed, mismatched, unsigned, denied, or
late response always denies the requested tool call.

## 1. Configure Warden

Generate a secret and put it in the environment of the process that runs
Warden and in the receiver's secret store. For example:

```bash
export WARDEN_APPROVAL_WEBHOOK_SECRET="$(openssl rand -hex 32)"
```

Add the webhook channel and a policy that explicitly selects it to
`warden.config.yml`:

```yaml
version: "2"

meta:
  environment: "production"
  sessionApprovalRequired: false

approvalChannels:
  webhook:
    requestUrl: "https://approvals.example.com/warden/requests"
    statusUrl: "https://approvals.example.com/warden/status"
    sharedSecret: "${WARDEN_APPROVAL_WEBHOOK_SECRET}"

policies:
  - id: "confirm-production-deploy"
    description: "A production deployment needs an authenticated human decision"
    match:
      tools: ["deploy_production"]
      environment: ["production"]
    action: CONFIRM
    channel: webhook
```

`requestUrl`, `statusUrl`, and `sharedSecret` must all resolve to non-empty
values when Warden starts. Warden uses the default local stdout prompt when no
approval channel is configured. A policy that specifies `channel: webhook`
will deny rather than fall back if the webhook channel is unavailable.

Validate and start the server from the directory containing the configuration:

```bash
warden config-validate
warden start
```

Successful startup prints `Using signed webhook approval channel`.

## 2. Implement the receiver contract

Warden makes two calls for every confirmation. The initial request is sent
asynchronously, so a status poll can arrive before your receiver has stored the
request. Return a signed `pending` response in that case.

### Approval request

Warden sends:

```http
POST /warden/requests HTTP/1.1
Content-Type: application/json
X-Warden-Approval-Signature: <hex HMAC-SHA-256 of the raw body>

{"requestId":"approval_...","tool":"deploy_production","reason":"Policy: confirm-production-deploy — ...","input":{"target":"api"},"environment":"production","sessionId":"session_...","taskId":"task_..."}
```

Verify the signature against the **raw request bytes** before parsing JSON:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

function sign(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

function hasValidSignature(secret: string, value: string, received: string | undefined): boolean {
  const expected = sign(secret, value);
  return received !== undefined
    && received.length === expected.length
    && timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}
```

If valid, store the request as `pending`, keyed by `requestId`, and return a
2xx response. Do not treat delivery as approval. Reject an invalid signature
with a non-2xx response and do not create a request.

The `input` field is already redacted by Warden. Treat it as security-sensitive
metadata anyway: do not expose it to unauthenticated users or send it to an
untrusted notification service.

### Status poll

Warden polls the status URL approximately every two seconds for up to 60
seconds. It sends:

```http
GET /warden/status HTTP/1.1
Accept: application/json
X-Warden-Approval-Request-Id: approval_...
X-Warden-Approval-Signature: <hex HMAC-SHA-256 of requestId>
```

Verify both headers. Return the same request ID and one of `pending`,
`approved`, or `denied`. Every response, including `pending`, must be signed:

```json
{
  "requestId": "approval_...",
  "status": "approved",
  "signature": "<hex HMAC-SHA-256 of approval_...:approved>"
}
```

The signature input is exactly `${requestId}:${status}`. Warden only permits
the action for `approved`; it denies `denied`, invalid JSON, a different request
ID, an invalid signature, an HTTP failure, and timeout.

## 3. Build the operator workflow

Your approval UI, chat workflow, or ticket automation should:

1. Authenticate the operator independently of Warden's shared secret.
2. Display the tool, policy reason, redacted input, environment, and expiry.
3. Let an authorized operator record exactly one `approved` or `denied`
   decision for the request ID.
4. Record the request, operator identity, decision, and timestamps in durable
   storage.
5. Return the stored status through the signed polling endpoint.

The shared secret authenticates Warden-to-receiver traffic; it does **not**
authenticate a browser user. Never put it in a browser, mobile application,
chat callback payload, or client-side configuration.

Use an atomic state transition from `pending` to a final decision. Reject a
second decision, decisions after expiry, and requests that do not belong to the
current approval context. Keep the decision record long enough to investigate
an audit event, but expire pending records no later than Warden's 60-second
confirmation window.

## 4. Reference status handler

The following framework-neutral shape shows the server-side logic. `load` and
`savePending` must use your durable store; `requireOperator` must use your
application's session, SSO, or equivalent authentication.

```ts
async function receiveApprovalRequest(rawBody: string, receivedSignature?: string) {
  if (!hasValidSignature(process.env.WARDEN_APPROVAL_WEBHOOK_SECRET!, rawBody, receivedSignature)) {
    return { status: 401, body: { error: "invalid Warden signature" } };
  }

  const request = JSON.parse(rawBody) as {
    requestId: string;
    tool: string;
    reason: string;
    input: unknown;
    environment?: string;
    sessionId?: string;
    taskId?: string;
  };
  await savePending({ ...request, expiresAt: Date.now() + 60_000 });
  return { status: 202, body: { received: true } };
}

async function readApprovalStatus(requestId: string, receivedSignature?: string) {
  const secret = process.env.WARDEN_APPROVAL_WEBHOOK_SECRET!;
  if (!hasValidSignature(secret, requestId, receivedSignature)) {
    return { status: 401, body: { error: "invalid Warden signature" } };
  }

  const record = await load(requestId);
  const status = record?.status ?? "pending";
  return {
    status: 200,
    body: {
      requestId,
      status,
      signature: sign(secret, `${requestId}:${status}`),
    },
  };
}

async function decide(requestId: string, status: "approved" | "denied", operator: Request) {
  await requireOperator(operator);
  return transitionPendingRequestOnce(requestId, status, { decidedAt: Date.now() });
}
```

## 5. Verify before use

Run the configuration check first:

```bash
warden config-validate
```

For receiver tests, use a test-only secret and assert all of these outcomes:

| Case | Expected Warden result |
| --- | --- |
| Valid signed `approved` response with matching request ID | Allow |
| Valid signed `denied` response | Deny |
| Missing or invalid request signature | Receiver rejects request; Warden denies on timeout |
| Invalid status signature | Deny |
| Status response for another request ID | Deny |
| Receiver unavailable or response delayed past 60 seconds | Deny |
| Second operator decision | Receiver rejects it; original final decision remains |

Use a temporary HTTPS tunnel only for development validation. In production,
use a stable HTTPS endpoint with normal monitoring, secret rotation, access
control, and durable storage. Do not use a generic webhook-inspection service:
it would receive approval details and the HMAC-bearing requests.

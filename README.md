# chat-api (prototype)

Prototype 1:1 **conversation chat** (client ↔ therapist) with **files**.

- Node.js + Express
- MongoDB (local dev, or **Amazon DocumentDB** in production via `MONGO_URI` from AWS Secrets Manager / Unicare Terraform)
- Socket.IO realtime
- Uploads stored locally in `uploads/`

## Production (Unicare / AWS App Runner)

Unicare Terraform provisions **Amazon DocumentDB** and stores **`MONGO_URI`** in Secrets Manager; App Runner injects it (with **`MONGO_TLS_CA_FILE`** for TLS). See the **`unicare-zone`** repo (`infra/documentdb`, `infra/chat-api`). CI pushes the image to **ECR** `unicare/chat-api` in **`eu-central-1`** (see `deploy-ecr.yml`).

### GitHub Actions → ECR (OIDC)

If the workflow fails with **“Credentials could not be loaded”**:

1. **Set the role ARN** — In GitHub: **Settings → Secrets and variables → Actions**. Under **Variables** (or **Secrets**), add **`AWS_DEPLOY_ROLE_ARN`** = the value of Terraform output **`github_actions_ecr_role_arn`** from `unicare_zone/infra/github-actions` (for example `arn:aws:iam::ACCOUNT:role/github-actions-unicare-chat-api-ecr`). An **empty** value causes that error.
2. **Repo must match Terraform** — `unicare_zone/projects.yaml` must use **`github_org` / `github_repo`** that match this repository (e.g. `alonzojoe` / `chat-api`). Re-apply **`infra/github-actions`** after changing them.
3. **OIDC permission** — The workflow sets top-level **`permissions: id-token: write`**. Do not override this in org-level workflow policies to **`read-all`** only, or OIDC tokens will not be issued.

## Folder structure

```
chat-api/
  src/
    config/
      env.js
      db.js
    routes/
      conversations.js
      chat.js
    services/
      conversationService.js
      chatService.js
    sockets/
      index.js
    utils/
      actor.js
    app.js
    server.js
  uploads/
  .env.example
  package.json
```

## 1) Setup DB (MongoDB local)

1. Install MongoDB Community (Homebrew):
   ```bash
   brew tap mongodb/brew
   brew install mongodb-community@7.0
   brew services start mongodb-community@7.0
   ```
2. Default DB name used: `chat_db` (see `MONGO_URI` in `.env`)

> Note: conversations only store `clientId` and `therapistId`. Use your main DB to resolve names for display.

## 2) Configure env

```bash
cp .env.example .env
```

## 3) Run

```bash
npm run dev
```

Seed demo data (optional):

```bash
npm run seed:mongo
# or wipe then seed
npm run seed:mongo -- --wipe
```

Health:
- `GET http://localhost:4000/health`

## 4) REST endpoints (prototype)

Because this is a prototype (no auth middleware yet), we pass `role` and `actorId` in query/body.

> Note: `conversationId` is the thread id (string) and is used to link messages. `actorId` is also a string.
> The therapist sidebar should use **List conversations** (below) to show all chats.

### Schema

**conversations**
```json
{
  "_id": "ObjectId",
  "clientId": "string",
  "therapistId": "string",
  "createdAt": "Date",
  "updatedAt": "Date"
}
```

**messages**
```json
{
  "_id": "ObjectId",
  "conversationId": "string",
  "senderRole": "patient|therapist",
  "senderId": "string",
  "body": "string|null",
  "fileUrl": "string|null",
  "fileName": "string|null",
  "fileType": "string|null",
  "seenAt": "Date|null",
  "createdAt": "Date",
  "updatedAt": "Date"
}
```

> Note → Names are no longer stored in `conversations`. Resolve names from your main DB using `clientId`/`therapistId`.

### Migration (remove old name fields)

If your existing DB has `clientName` / `therapistName`, run:

```bash
npm run migrate:remove-names
```

Or in Mongo shell:

```js
db.conversations.updateMany({}, { $unset: { clientName: "", therapistName: "" } })
```

### Endpoints table (with samples)

| Method | Path | Required params | Sample request | Sample response |
| --- | --- | --- | --- | --- |
| GET | `/health` | none | `GET /health` | `{ "ok": true }` |
| GET | `/api/conversations` | **query:** `role`, `actorId` | `GET /api/conversations?role=therapist&actorId=therapist_10` | `{ "conversations": [ { "conversationId": "65c1e6...", "clientId": "patient_1", "therapistId": "therapist_10", "lastMessage": "Hi doc", "lastMessageAt": "2026-02-12 12:10:00", "unreadCount": 2 } ] }` |
| POST | `/api/conversations` | **body:** `clientId`, `therapistId` | `{ "clientId": "patient_1", "therapistId": "therapist_10" }` | `{ "ok": true, "id": "65c1e6...", "existing": false }` |
| GET | `/api/messages` | **query:** `conversationId`, `role`, `actorId` | `GET /api/messages?conversationId=65c1e6...&role=therapist&actorId=therapist_10` | `{ "messages": [ { "id": "66a1...", "conversationId": "65c1e6...", "senderRole": "patient", "senderId": "patient_1", "body": "Hello doc", "fileUrl": null, "fileName": null, "fileType": null, "createdAt": "2026-02-12 12:07:10", "seenAt": null } ] }` |
| POST | `/api/message` | **body:** `conversationId`, `role`, `actorId`, `body` | `{ "conversationId": "65c1e6...", "role": "patient", "actorId": "patient_1", "body": "Hello doc" }` | `{ "message": { "id": "66a1...", "conversationId": "65c1e6...", "senderRole": "patient", "senderId": "patient_1", "body": "Hello doc", "createdAt": "2026-02-12 12:07:10", "seenAt": null } }` |
| POST | `/api/upload` | **form:** `conversationId`, `role`, `actorId`, `file` | `multipart/form-data` | `{ "message": { "id": "66a2...", "conversationId": "65c1e6...", "senderRole": "patient", "senderId": "patient_1", "fileUrl": "/uploads/1700000000-abc.jpg", "fileName": "scan.jpg", "fileType": "image/jpeg", "createdAt": "2026-02-12 12:08:00", "seenAt": null }, "publicUrl": "http://localhost:4000/uploads/1700000000-abc.jpg" }` |
| POST | `/api/read` | **body:** `conversationId`, `role`, `actorId` | `{ "conversationId": "65c1e6...", "role": "therapist", "actorId": "therapist_10", "lastReadMessageId": "66a1..." }` | `{ "ok": true, "reads": { "conversationId": "65c1e6...", "unreadCount": 0, "lastSeenAt": "2026-02-12 12:09:00", "updatedCount": 2 } }` |
| GET | `/api/read` | **query:** `conversationId`, `role`, `actorId` | `GET /api/read?conversationId=65c1e6...&role=therapist&actorId=therapist_10` | `{ "reads": { "conversationId": "65c1e6...", "unreadCount": 1, "lastSeenAt": "2026-02-12 12:09:00" } }` |

### Examples

#### List conversations (sidebar)

Therapist:

```bash
curl "http://localhost:4000/api/conversations?role=therapist&actorId=therapist_10"
```

Patient:

```bash
curl "http://localhost:4000/api/conversations?role=patient&actorId=patient_1"
```

#### Create conversation

```bash
curl -X POST http://localhost:4000/api/conversations \
  -H 'Content-Type: application/json' \
  -d '{
    "clientId":"patient_1",
    "therapistId":"therapist_10"
  }'
```

#### Load messages

```bash
curl "http://localhost:4000/api/messages?conversationId=<conversationId>&role=therapist&actorId=therapist_10"
```

#### Send message

```bash
curl -X POST http://localhost:4000/api/message \
  -H 'Content-Type: application/json' \
  -d '{"conversationId":"<conversationId>","role":"patient","actorId":"patient_1","body":"Hello doc"}'
```

#### Upload file

```bash
curl -X POST http://localhost:4000/api/upload \
  -F conversationId=<conversationId> \
  -F role=patient \
  -F actorId=patient_1 \
  -F file=@/path/to/image.jpg
```

#### Mark messages as read

```bash
curl -X POST http://localhost:4000/api/read \
  -H 'Content-Type: application/json' \
  -d '{"conversationId":"<conversationId>","role":"therapist","actorId":"therapist_10","lastReadMessageId":"<messageId>"}'
```

#### Get read summary

```bash
curl "http://localhost:4000/api/read?conversationId=<conversationId>&role=therapist&actorId=therapist_10"
```

## 5) Socket.IO events

Client emits:
- `join` `{ conversationId, role, actorId }`
- `join:actor` `{ role, actorId }`

Server emits:
- `joined` `{ conversationId }`
- `actor:joined` `{ role, actorId }`
- `message:new` `{ message }`
- `read:updated` `{ conversationId, reads }`
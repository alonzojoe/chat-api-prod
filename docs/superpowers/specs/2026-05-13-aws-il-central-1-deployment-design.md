# Design — chat-api deployment to AWS Israel (il-central-1)

**Date:** 2026-05-13
**Owner:** alonzojoe
**Status:** In progress — DocumentDB cluster is provisioning. ECS service not yet created.
**Resume point:** Step 6e — locate the DocumentDB-managed Secrets Manager secret, build the full `MONGO_URI` secret, then move to Step 7 (create ECS Express Mode service).

---

## Goal

Deploy the `chat-api` Node.js service to AWS in **Israel (Tel Aviv) `il-central-1`** with:

- An HTTPS URL of the form `https://chat-api-<hash>.ecs.il-central-1.on.aws` (no custom domain, no ACM cert work).
- Billing entirely on AWS (no MongoDB Atlas).
- GitHub Actions CI that builds the image and pushes it to ECR in `il-central-1`, and (still pending) triggers a rolling deploy of the ECS service.
- Full functionality on first deploy — DocumentDB included (we reversed the earlier "skip DB" decision once the user saw the free trial covers month one).

## Why ECS Express Mode (not EC2, not App Runner)

- App Runner is closed to new customers (re:Invent 2025); existing customers are being migrated to **Amazon ECS Express Mode**.
- ECS Express Mode is the service that produces `*.ecs.<region>.on.aws` URLs with AWS-managed TLS.
- It runs on Fargate under the hood — pay per task vCPU/memory, no idle EC2 cost.
- Available in every region with ECS + Fargate, including `il-central-1`.
- The user's original "EC2" request was a name confusion — the `*.on.aws` URL they wanted was specifically the ECS Express Mode endpoint format.

## Architecture

```
Internet (HTTPS 443)
        │
        ▼
ECS Express Mode service (Fargate, default VPC)
        │   - Public URL: https://chat-api-XXXX.ecs.il-central-1.on.aws
        │   - TLS terminated by AWS
        │   - Forwards to container :4000
        │   - SG: ecs-chat-api-prod-sg (sg-09d8496923a2b2119)
        ▼
chat-api container (pulled from ECR, port 4000)
        │
        └─► DocumentDB cluster
             - chat-api-prod-docdb (engine 5.0.0)
             - 1 primary + 1 replica (db.t3.medium)
             - SG: docdb-chat-api-prod-sg (sg-071f13d553cbe51f8) — inbound 27017 from ECS SG only
             - Auth managed in AWS Secrets Manager (DocumentDB auto-created secret)
             - TLS required (CA bundle baked into Docker image at /app/rds-global-bundle.pem)

S3 uploads — deferred. Container uses ephemeral local /uploads dir for now.
```

## Components

| AWS service | Purpose | Identifier |
|---|---|---|
| Account | All resources | `054211126937` |
| Region | All resources | `il-central-1` (Tel Aviv) |
| ECR repo | Docker image registry | `chat-api-prod` → `054211126937.dkr.ecr.il-central-1.amazonaws.com/chat-api-prod` |
| IAM OIDC role | GH Actions assumes via OIDC | `arn:aws:iam::054211126937:role/github-actions-chat-api-prod` |
| GitHub repo | Source + CI | `alonzojoe/chat-api-prod` |
| GH Actions Variable | Pipeline reads OIDC role ARN | `AWS_DEPLOY_ROLE_ARN` (set as repo Variable, not Secret) |
| ECS task SG | Outbound only | `ecs-chat-api-prod-sg` / `sg-09d8496923a2b2119` |
| DocumentDB SG | Inbound 27017 from ECS SG | `docdb-chat-api-prod-sg` / `sg-071f13d553cbe51f8` |
| DocumentDB cluster | Mongo-compatible DB | `chat-api-prod-docdb` (5.0.0, db.t3.medium, 1 primary + 1 replica) |
| DocumentDB-managed secret | Auto-created by DocumentDB; holds `{username, password, host, port, dbClusterIdentifier}` | TBD — find under Secrets Manager once cluster reaches Available |
| MONGO_URI secret (to be created) | Full connection string the ECS task will inject | TBD — Step 6e |
| ECS Express Mode service | The running service + the public URL | TBD — Step 7 |
| CloudWatch Logs | Container stdout/stderr | Auto-created by ECS |

## Cost

| Item | Cost at full uptime | Notes |
|---|---|---|
| DocumentDB (2× db.t3.medium) | ~$114/mo | **First 30 days free** under the DocumentDB free trial for new customers (750h of db.t3.medium per account) |
| DocumentDB storage | $0.10/GB/mo | <$1/mo at start |
| DocumentDB backups | $0.021/GB/mo | 1-day retention |
| ECS Fargate (0.25 vCPU / 0.5 GB) | ~$9/mo | Always-on |
| ECR storage | $0.10/GB/mo | <$1/mo |
| Secrets Manager (2 secrets) | $0.80/mo | $0.40 per secret |
| Data transfer | ~$0–$5/mo | First 100GB/mo out is free |
| **Total** | **~$125/mo at full uptime, ~$10/mo for the first 30 days** | |

## Container config

The existing [`Dockerfile`](../../Dockerfile) is unchanged.

- `node:20-alpine`, ESM, port 4000.
- Bakes in RDS/DocumentDB TLS bundle at `/app/rds-global-bundle.pem`.
- [`src/config/db.js`](../../src/config/db.js) already supports `MONGO_TLS_CA_FILE`.
- [`src/server.js`](../../src/server.js) listens before connecting to Mongo, so `/health` works during cold start.

### ECS task definition

| Setting | Value |
|---|---|
| CPU / memory | 0.25 vCPU / 0.5 GB (`256 / 512`) |
| Container port | 4000 |
| Health check path | `/health` |
| Log driver | `awslogs` (CloudWatch) |
| VPC | default |
| Security group | `ecs-chat-api-prod-sg` (sg-09d8496923a2b2119) |

### Env vars

| Var | Source | Value |
|---|---|---|
| `PORT` | static | `4000` |
| `NODE_ENV` | static | `production` |
| `ENABLE_CORS` | static | `true` |
| `CORS_ORIGIN` | static | `*` (tighten later to the frontend's origin) |
| `RATE_LIMIT_WINDOW_MS` | static | `900000` |
| `RATE_LIMIT_MAX` | static | `300` |
| `USE_S3` | static | `false` (deferred; local /uploads dir is ephemeral on Fargate) |
| `MONGO_URI` | **Secrets Manager** | Full connection string — see Step 6e |
| `MONGO_TLS_CA_FILE` | static | `/app/rds-global-bundle.pem` |
| `AUTH_KEY` | (optional Secrets Manager) | Skip for now; can add later |

**Connection string template** (will live inside the `MONGO_URI` secret):

```
mongodb://chatapi:<password>@chat-api-prod-docdb.cluster-XXXXXXXX.il-central-1.docdb.amazonaws.com:27017/chat_db?tls=true&replicaSet=rs0&readPreference=secondaryPreferred&retryWrites=false
```

Two non-obvious bits:
- `retryWrites=false` — DocumentDB doesn't support retryable writes.
- `tls=true` in URI + `MONGO_TLS_CA_FILE` env var both needed (Mongoose wants the CA file path separately).

## CI/CD

### Done

- Workflow [`deploy-ecr.yml`](../../.github/workflows/deploy-ecr.yml) updated for `il-central-1` and `chat-api-prod` (commit `bb5d08f` on develop, merged to main via PR #1).
- Test + build-and-push jobs both green on first run; image landed in ECR.

### Pending

- Add an ECS service-update step (after build-and-push) so deploys roll out automatically. The workflow currently only pushes the image — it does not trigger an ECS deploy.
- Add inline IAM policy to `github-actions-chat-api-prod` role granting `ecs:UpdateService`, `ecs:DescribeServices`, `ecs:DescribeTaskDefinition`, `ecs:RegisterTaskDefinition`, and `iam:PassRole` (scoped to the task execution role).

## Progress log

- ✅ **Step 1** — ECR repository `chat-api-prod` created in `il-central-1`.
- ✅ **Step 2** — IAM OIDC role `github-actions-chat-api-prod` created. Trust scoped to `repo:alonzojoe/chat-api-prod:*` (`StringLike`). Has `AmazonEC2ContainerRegistryPowerUser` attached. **ECS permissions not yet added.**
- ✅ **Step 3** — `AWS_DEPLOY_ROLE_ARN` repository Variable set on GitHub.
- ✅ **Step 4** — Workflow `deploy-ecr.yml` updated (region + repo name).
- ✅ **Step 5** — Commit pushed via PR develop → main. CI ran successfully. Image pushed to ECR.
- ✅ **Step 6a** — Security group `ecs-chat-api-prod-sg` (sg-09d8496923a2b2119) created in default VPC, no inbound rules, default outbound.
- ✅ **Step 6b** — Security group `docdb-chat-api-prod-sg` (sg-071f13d553cbe51f8) created in default VPC, inbound 27017 from sg-09d8496923a2b2119.
- ✅ **Step 6c** — DocumentDB cluster `chat-api-prod-docdb` create initiated. Engine 5.0.0, db.t3.medium, 1 primary + 1 replica, auth managed in Secrets Manager, attached to docdb-chat-api-prod-sg, port 27017, default VPC + auto-created subnet group, backup retention 1 day, **deletion protection enabled**, log exports off.
- ⏳ **Step 6d** — Waiting for cluster to reach **Available** status. Started ~10–15 min before pause.
- ⏸ **Step 6e** — Resume here: locate the DocumentDB-managed secret in Secrets Manager (its name will look like `rds!cluster-XXX...` or similar). Note its ARN and the `host` value from the secret JSON. Then create a second secret named `chat-api-prod/mongo-uri` containing the full connection string (template above).
- ⏸ **Step 7** — Create ECS Express Mode service in default VPC, using SG `sg-09d8496923a2b2119`, image from ECR, env vars from the table above, `MONGO_URI` injected from the new Secrets Manager secret.
- ⏸ **Step 8** — Verify `https://chat-api-<hash>.ecs.il-central-1.on.aws/health` returns `{"ok":true}` and CloudWatch Logs show a successful Mongoose connection.
- ⏸ **Step 9** — Add `ecs:UpdateService` / `RegisterTaskDefinition` / `PassRole` inline policy to the OIDC role; extend `deploy-ecr.yml` with a final step that rolls the service.

## Decisions made along the way

- **Compute:** ECS Express Mode in `il-central-1` (not EC2, not App Runner — see "Why ECS Express Mode" above).
- **Domain:** None. Use the AWS-provisioned `*.on.aws` hostname directly. HTTPS is automatic via AWS-managed wildcard cert.
- **DB hosting:** DocumentDB (not Atlas — user wants the bill on AWS).
- **DB replicas:** 1 primary + 1 replica (the console's minimum for new clusters). Gives real HA. ~$114/mo.
- **DB free trial:** New-account DocumentDB free trial covers first 30 days (~$0 for month one).
- **Password management:** DocumentDB auto-managed in AWS Secrets Manager (cleaner than self-managed; rotation off by default).
- **Deletion protection:** Enabled (corrected mid-session — initial advice was wrong).
- **Provisioning approach:** AWS Console, click-by-click. No Terraform yet — we may convert to IaC later once the click-through is documented.
- **S3 uploads:** Deferred. Code path is already wired behind `USE_S3=true` (see [`src/routes/chat.js:21-50`](../../src/routes/chat.js#L21-L50)); just needs a bucket + IAM later.

## Risks / open questions

- **MONGO_URI rotation drift** — DocumentDB-managed Secrets Manager auto-rotation is OFF by default, but if it's ever enabled the manually-created `chat-api-prod/mongo-uri` secret will drift. Mitigation: either keep rotation off, or replace the manual URI secret with a small AWS Lambda that derives MONGO_URI from the rotated credentials. Defer until rotation is actually needed.
- **OIDC role ECS permissions** — currently only has ECR push. Step 9 must add ECS service update perms before the workflow can deploy.
- **Workflow ECS deploy step** — not yet added; first deploy will be done from the AWS Console. Subsequent deploys should automate via the workflow.

## Out of scope (now)

- Custom domain / TLS cert.
- Auto-scaling, multi-AZ instance count beyond 1+1.
- Observability beyond CloudWatch Logs.
- S3 uploads (deferred).
- Terraform / CDK / IaC.
- Frontend / client app — only the API is being deployed.

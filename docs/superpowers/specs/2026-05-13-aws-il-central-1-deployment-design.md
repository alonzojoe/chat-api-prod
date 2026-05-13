# Design — chat-api deployment to AWS Israel (il-central-1)

**Date:** 2026-05-13
**Owner:** alonzojoe
**Status:** Approved sections 1–3; Section 4 (CI/CD) and infra creation in progress.

## Goal

Deploy the `chat-api` Node.js service to AWS in the **Israel (Tel Aviv) `il-central-1`** region with:

- An HTTPS URL of the form `https://chat-api-<hash>.ecs.il-central-1.on.aws` (no custom domain, no ACM cert work).
- Billing entirely on AWS (no MongoDB Atlas).
- GitHub Actions CI that builds the image and pushes it to ECR in `il-central-1`, then triggers a rolling deploy of the ECS service.
- Phase 1 ships **without** DocumentDB. The service answers `/health` but DB-backed endpoints fail until Phase 2.

## Why ECS Express Mode (not EC2, not App Runner)

- App Runner is closed to new customers (re:Invent 2025) and is being migrated to **Amazon ECS Express Mode**.
- ECS Express Mode is the service that produces `*.ecs.<region>.on.aws` URLs with AWS-managed TLS.
- It is available in every region with ECS + Fargate, including `il-central-1`.
- No EC2 instance to manage, no ALB/ACM/Route 53 wiring, no domain purchase.
- Runs on Fargate under the hood — pay per task vCPU/memory, no idle EC2 cost.

EC2 was the user's first guess, but the URL pattern they wanted (`*.on.aws`) is exclusive to ECS Express Mode / managed-endpoint services.

## Architecture

```
Internet (HTTPS 443)
        │
        ▼
ECS Express Mode service (Fargate)
        │   - Public URL: https://chat-api-XXXX.ecs.il-central-1.on.aws
        │   - TLS terminated by AWS
        │   - Forwards to container :4000
        ▼
chat-api container (pulled from ECR)
        │
        ├─► [Phase 2] DocumentDB cluster (private subnet, TLS)
        │
        └─► [Phase 2] S3 uploads bucket
```

**Components (Phase 1):**

| AWS service | Purpose |
|---|---|
| ECR (`il-central-1`) | Docker image registry. Repo name: `chat-api-prod`. URI: `054211126937.dkr.ecr.il-central-1.amazonaws.com/chat-api-prod`. |
| ECS Express Mode | Run the container, expose HTTPS URL. |
| IAM (OIDC role for GitHub) | Lets GH Actions push images and update the ECS service without long-lived keys. |
| CloudWatch Logs | Container stdout/stderr (default ECS log driver). |
| GitHub Actions (existing `deploy-ecr.yml`) | Build → push → deploy on every push to `main`. |

**Components deferred to Phase 2:**

- Amazon DocumentDB cluster (`db.t3.medium`, single instance) — ~$57/mo.
- AWS Secrets Manager (`MONGO_URI`, optional `AUTH_KEY`).
- VPC security groups locking DocumentDB to the ECS task SG.
- S3 bucket + IAM task role for uploads.

## Container config (Phase 1)

The existing [`Dockerfile`](../../Dockerfile) is unchanged. It:

- Uses `node:20-alpine`.
- Bakes in the RDS/DocumentDB TLS bundle at `/app/rds-global-bundle.pem` (used in Phase 2).
- Exposes port 4000.

**ECS task definition:**

| Setting | Value |
|---|---|
| CPU / memory | 0.25 vCPU / 0.5 GB |
| Container port | 4000 |
| Health check path | `/health` |
| Log driver | `awslogs` (CloudWatch) |

**Env vars (Phase 1, no Mongo, no S3):**

| Var | Value |
|---|---|
| `PORT` | `4000` |
| `NODE_ENV` | `production` |
| `ENABLE_CORS` | `true` |
| `CORS_ORIGIN` | `*` (tighten later) |
| `RATE_LIMIT_WINDOW_MS` | `900000` |
| `RATE_LIMIT_MAX` | `300` |
| `USE_S3` | `false` (Phase 2 → `true`) |

Anything Mongo- or S3-related is intentionally omitted in Phase 1. The app starts, binds to `:4000`, answers `/health`, then attempts to connect to Mongo and exits when it can't. **For Phase 1 we'll either set a placeholder MONGO_URI or comment out the connectDb call** — TBD during implementation, see open question below.

## CI/CD (Phase 1)

The existing [`.github/workflows/deploy-ecr.yml`](../../.github/workflows/deploy-ecr.yml) needs three changes:

1. `AWS_REGION: eu-central-1` → `il-central-1`.
2. `ECR_REPOSITORY: unicare/chat-api` → `chat-api-prod` (no `unicare/` prefix; this is your own account).
3. Add a final job/step that updates the ECS service to use the new image (force a rolling deploy).

The OIDC role ARN secret name (`AWS_DEPLOY_ROLE_ARN`) stays the same. The role itself needs to be recreated in AWS account `054211126937` with a trust policy matching `repo:alonzojoe/chat-api-prod:*`.

## Provisioning approach

**AWS Console, click-by-click**, guided step-by-step. Each AWS resource will be created in `il-central-1` exclusively. No Terraform or CDK in Phase 1 (the user wants the console experience). If we ever need to recreate this, we'll convert the operational record into Terraform at that point.

## Order of operations

1. ECR repository (`chat-api`) in `il-central-1`.
2. IAM role for GitHub OIDC (trust `repo:alonzojoe/chat-api:*`, perms: ECR push + ECS update).
3. GitHub repo: add `AWS_DEPLOY_ROLE_ARN` as a Variable.
4. Update `deploy-ecr.yml` (region, repo name, ECS deploy step).
5. First push to `main` — image lands in ECR. (Requires repo to be a git repo again — `.git` was deleted earlier this session and needs to be re-initialized.)
6. Create ECS Express Mode service from the image. Service health-checks `/health`.
7. Verify `https://chat-api-<hash>.ecs.il-central-1.on.aws/health` returns `{"ok":true}`.
8. Hand off — Phase 2 (DocumentDB, Secrets, S3) starts as a separate spec.

## Risks / open questions

- **The repo no longer has a `.git` directory** (the user asked me to remove it earlier in the session). It needs to be re-initialized and connected to a GitHub remote before any push-driven CI can run. Confirm the GitHub repo URL/owner before the first push.
- **The app calls `process.exit(1)` if Mongo connection fails** ([src/server.js:28-29](../../src/server.js#L28-L29)). With no DocumentDB in Phase 1, the task will boot, answer `/health`, and then crash a few seconds later when `connectDb()` rejects. ECS will restart it, and it will crash again — a tight crashloop. **Options:**
  1. Set `MONGO_URI` to an unreachable placeholder and accept the crashloop (the URL still works during the boot window — ugly).
  2. Temporarily comment out the `connectDb()` call for Phase 1 (clean, but requires a code change).
  3. Skip Phase 1 deployment and just bring up DocumentDB at the same time (defeats the user's "skip DocumentDB for now" preference).

  **Recommendation:** Option 2 — small, reversible code change, no crashloop. Decide during implementation.
- **GitHub Actions OIDC trust policy** — must match the exact `repo:<owner>/<name>:*` claim of the new repo. If the user creates a new GitHub repo (different name/owner from the original), the role's trust policy must reflect that.

## Out of scope

- Custom domain / TLS cert.
- Auto-scaling, multi-AZ, replicas.
- Observability beyond CloudWatch Logs (no APM, no metrics dashboards yet).
- Phase 2: DocumentDB, Secrets Manager, S3, security groups.

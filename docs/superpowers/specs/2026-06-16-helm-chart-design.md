# Helm Chart Design — jina-reader

**Date:** 2026-06-16
**Status:** Approved

## Overview

Deploy the jina-reader project to Kubernetes via a single Helm chart. The project runs three independent stand-alone servers from the same Docker image, differentiated only by their entry-point command. The chart replaces the original subdomain routing (`r.domain.com`, `s.domain.com`) with subfolder routing (`/crawl`, `/search`, `/serp`) on a single host.

## Chart Structure

```
helm-charts/
└── jina-reader/
    ├── Chart.yaml
    ├── values.yaml
    ├── values/
    │   ├── values-staging.yaml
    │   └── values-production.yaml
    └── templates/
        ├── _helpers.tpl
        ├── NOTES.txt
        ├── deployment-crawl.yaml
        ├── deployment-search.yaml
        ├── deployment-serp.yaml
        ├── service-crawl.yaml
        ├── service-search.yaml
        ├── service-serp.yaml
        ├── ingress.yaml
        ├── hpa-crawl.yaml
        ├── hpa-search.yaml
        ├── hpa-serp.yaml
        ├── serviceaccount.yaml
        └── external-secrets/
            ├── env-secrets.yaml
            └── cloudflare-secrets.yaml
```

Pattern: one chart, three explicit Deployment files (mirrors AdminCMS `cms` / `cms-video-server` style). No Helm range loops — each service is self-contained and independently tunable.

## Services

| Deployment | Entry point | Ingress path | Internal port |
|---|---|---|---|
| `jina-reader-crawl` | `build/stand-alone/crawl.js` | `/crawl` | 8080 |
| `jina-reader-search` | `build/stand-alone/search.js` | `/search` | 8080 |
| `jina-reader-serp` | `build/stand-alone/serp.js` | `/serp` | 8080 |

All three use `ENV PORT=8080` from the Dockerfile. The `CMD` in the Dockerfile defaults to `crawl.js`; search and serp override it via `command:` in their Deployment spec.

## Ingress & Path Routing

One Ingress resource, one host, three path rules. nginx strips the path prefix before forwarding using the `rewrite-target` annotation:

```yaml
annotations:
  nginx.ingress.kubernetes.io/rewrite-target: /$2
  nginx.ingress.kubernetes.io/use-regex: "true"

paths:
  - path: /crawl(/|$)(.*)          → jina-reader-crawl:80
  - path: /search(/|$)(.*)         → jina-reader-search:80
  - path: /serp(/|$)(.*)           → jina-reader-serp:80
```

Result: `GET /crawl/https://example.com` arrives at the crawl service as `GET /https://example.com`. The apps are unaware of the prefix.

One TLS entry covers all three paths (single host, single Cloudflare cert secret pulled via External Secrets).

Timeout annotations (`proxy-read-timeout`, `proxy-send-timeout`, `proxy-connect-timeout`, `send_timeout`) are set at the Ingress level. Crawl is the slowest service — its limits set the ceiling for all three backends.

## Values Structure

`values.yaml` has a shared `image:` block and three per-service sections:

```yaml
image:
  repository: <ecr-or-registry-url>
  pullPolicy: Always
  tag: latest

externalSecrets:
  clusterSecretStoreName: ""
  env:
    enabled: true
    targetSecretName: ""
    externalEnvSecretName: ""
  cloudflare:
    enabled: true
    targetSecretName: ""
    externalTlsCrtSecret: cloudflare-ca-crt
    externalTlsKeySecret: cloudflare-ca-pk

envSecretName: ""

ingress:
  enabled: true
  className: nginx
  host: ""
  annotations: {}
  tls:
    secretName: ""

crawl:
  replicaCount: 1
  command: ["build/stand-alone/crawl.js"]
  extraContainerEnv: []
  resources: {}
  autoscaling:
    enabled: false
    minReplicas: 1
    maxReplicas: 4
    targetCPUUtilizationPercentage: 80

search:
  replicaCount: 1
  command: ["build/stand-alone/search.js"]
  extraContainerEnv: []
  resources: {}
  autoscaling:
    enabled: false
    minReplicas: 1
    maxReplicas: 4
    targetCPUUtilizationPercentage: 80

serp:
  replicaCount: 1
  command: ["build/stand-alone/serp.js"]
  extraContainerEnv: []
  resources: {}
  autoscaling:
    enabled: false
    minReplicas: 1
    maxReplicas: 4
    targetCPUUtilizationPercentage: 80

serviceAccount:
  create: false
  annotations: {}
  name: ""
```

Environment-specific `values/values-production.yaml` fills in image repo, AWS secret names, host, resource limits, replica counts, and HPA settings.

## Secrets

Two External Secrets, identical pattern to AdminCMS:

1. **env-secrets** — pulls the app's runtime config from AWS Secrets Manager → k8s Secret → mounted via `envFrom.secretRef` on all three Deployments. All three services share the same secret (they share the same env config surface).
2. **cloudflare-secrets** — pulls `cloudflare-ca-crt` and `cloudflare-ca-pk` from AWS Secrets Manager, assembled into a k8s TLS secret referenced by the Ingress.

Both toggled via `externalSecrets.env.enabled` and `externalSecrets.cloudflare.enabled`.

## Health Probes

The app has no dedicated `/health` endpoint. The stand-alone servers respond with HTTP 200 to `GET /` (the index page served by `getIndex`). All three Deployments use:

```yaml
livenessProbe:
  httpGet:
    path: /
    port: 8080
  initialDelaySeconds: 30
  periodSeconds: 10
  failureThreshold: 10
  timeoutSeconds: 15

readinessProbe:
  httpGet:
    path: /
    port: 8080
  initialDelaySeconds: 10
  periodSeconds: 5
  failureThreshold: 6
  timeoutSeconds: 5
```

`initialDelaySeconds: 30` accounts for DI graph warm-up (`serviceReady()`) and the `NODE_COMPILE_CACHE` warm step that runs at container start.

## Assumptions & Open Items

- All three services share the same AWS Secrets Manager secret key. If they need separate secrets, add `crawl.envSecretName`, `search.envSecretName`, `serp.envSecretName` to values.
- The `serp` service path may conflict with the `SearcherHost`'s internal `/search` route after prefix-stripping — the ingress paths are distinct so there is no conflict at the routing level.
- No `podAntiAffinity` is templated by default; add it to production values if needed (see AdminCMS pattern).
- Static assets in `public/` are served at `/` by each stand-alone server. After prefix-stripping they resolve correctly (e.g. `/crawl/favicon.ico` → `/favicon.ico`).

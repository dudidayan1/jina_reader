# Helm Chart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a single Helm chart that deploys three jina-reader services (crawl, search, serp) to Kubernetes, routed via nginx subfolder paths `/crawl`, `/search`, `/serp` with path-prefix rewriting.

**Architecture:** One chart, three explicit Deployment files sharing the same Docker image, differentiated by `args:`. One Ingress with `rewrite-target` strips the path prefix before forwarding to each ClusterIP Service. External Secrets pulls app config and Cloudflare TLS from AWS Secrets Manager, mirroring the AdminCMS pattern.

**Tech Stack:** Helm 3, Kubernetes ≥1.19, nginx ingress controller, external-secrets operator (v1beta1), AWS Secrets Manager, Cloudflare TLS.

**Reference:** `/Users/dudidayan/WebstormProjects/Admin-CMS/helm-charts/cms/` — follow this pattern closely.
**Spec:** `docs/superpowers/specs/2026-06-16-helm-chart-design.md`

---

## File Map

| File | Purpose |
|---|---|
| `helm-charts/jina-reader/Chart.yaml` | Chart metadata |
| `helm-charts/jina-reader/values.yaml` | Default values for all three services |
| `helm-charts/jina-reader/values/values-staging.yaml` | Staging env overrides |
| `helm-charts/jina-reader/values/values-production.yaml` | Production env overrides |
| `helm-charts/jina-reader/templates/_helpers.tpl` | Named templates: fullname, component names, labels |
| `helm-charts/jina-reader/templates/NOTES.txt` | Post-install usage notes |
| `helm-charts/jina-reader/templates/serviceaccount.yaml` | Optional ServiceAccount |
| `helm-charts/jina-reader/templates/deployment-crawl.yaml` | Crawl Deployment |
| `helm-charts/jina-reader/templates/service-crawl.yaml` | Crawl ClusterIP Service |
| `helm-charts/jina-reader/templates/hpa-crawl.yaml` | Crawl HPA |
| `helm-charts/jina-reader/templates/deployment-search.yaml` | Search Deployment |
| `helm-charts/jina-reader/templates/service-search.yaml` | Search ClusterIP Service |
| `helm-charts/jina-reader/templates/hpa-search.yaml` | Search HPA |
| `helm-charts/jina-reader/templates/deployment-serp.yaml` | Serp Deployment |
| `helm-charts/jina-reader/templates/service-serp.yaml` | Serp ClusterIP Service |
| `helm-charts/jina-reader/templates/hpa-serp.yaml` | Serp HPA |
| `helm-charts/jina-reader/templates/ingress.yaml` | Single Ingress, three path rules with rewrite |
| `helm-charts/jina-reader/templates/external-secrets/env-secrets.yaml` | ExternalSecret for app env |
| `helm-charts/jina-reader/templates/external-secrets/cloudflare-secrets.yaml` | ExternalSecret for TLS cert |

---

## Task 1: Chart scaffolding — Chart.yaml, values.yaml, _helpers.tpl, NOTES.txt, serviceaccount.yaml

**Files:**
- Create: `helm-charts/jina-reader/Chart.yaml`
- Create: `helm-charts/jina-reader/values.yaml`
- Create: `helm-charts/jina-reader/templates/_helpers.tpl`
- Create: `helm-charts/jina-reader/templates/NOTES.txt`
- Create: `helm-charts/jina-reader/templates/serviceaccount.yaml`

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p helm-charts/jina-reader/templates/external-secrets
mkdir -p helm-charts/jina-reader/values
```

- [ ] **Step 2: Create Chart.yaml**

```yaml
# helm-charts/jina-reader/Chart.yaml
apiVersion: v2
name: jina-reader
description: Helm chart for jina-reader crawl, search, and serp services
type: application
version: 0.1.0
appVersion: "latest"
```

- [ ] **Step 3: Create values.yaml**

```yaml
# helm-charts/jina-reader/values.yaml
image:
  repository: ""
  pullPolicy: Always
  tag: "latest"

imagePullSecrets: []
nameOverride: ""
fullnameOverride: ""

externalSecrets:
  clusterSecretStoreName: ""
  env:
    enabled: false
    targetSecretName: ""
    externalEnvSecretName: ""
  cloudflare:
    enabled: false
    targetSecretName: ""
    externalTlsCrtSecret: cloudflare-ca-crt
    externalTlsKeySecret: cloudflare-ca-pk

envSecretName: ""

ingress:
  enabled: true
  className: nginx
  host: ""
  annotations:
    nginx.ingress.kubernetes.io/send_timeout: "600"
    nginx.ingress.kubernetes.io/proxy-connect-timeout: "600"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "600"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "600"
    nginx.ingress.kubernetes.io/proxy-body-size: 16m
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
  tls:
    secretName: ""

# Shared probes — all three containers respond to GET / with 200 after DI graph init.
# initialDelaySeconds: 30 covers serviceReady() + NODE_COMPILE_CACHE warm step.
livenessProbe:
  httpGet:
    path: /
    port: http
  initialDelaySeconds: 30
  periodSeconds: 10
  failureThreshold: 10
  timeoutSeconds: 15

readinessProbe:
  httpGet:
    path: /
    port: http
  initialDelaySeconds: 10
  periodSeconds: 5
  failureThreshold: 6
  timeoutSeconds: 5

crawl:
  replicaCount: 1
  args:
    - build/stand-alone/crawl.js
  extraContainerEnv: []
  resources: {}
  autoscaling:
    enabled: false
    minReplicas: 1
    maxReplicas: 4
    targetCPUUtilizationPercentage: 80

search:
  replicaCount: 1
  args:
    - build/stand-alone/search.js
  extraContainerEnv: []
  resources: {}
  autoscaling:
    enabled: false
    minReplicas: 1
    maxReplicas: 4
    targetCPUUtilizationPercentage: 80

serp:
  replicaCount: 1
  args:
    - build/stand-alone/serp.js
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

podAnnotations: {}
podSecurityContext: {}
securityContext: {}
nodeSelector: {}
tolerations: []
affinity: {}
```

- [ ] **Step 4: Create _helpers.tpl**

The helpers define per-component name and label functions using Helm's `list` + `index` pattern to pass multiple arguments to a named template.

```
{{/*
helm-charts/jina-reader/templates/_helpers.tpl
*/}}

{{- define "jina-reader.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "jina-reader.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{- define "jina-reader.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
componentFullname: call as (include "jina-reader.componentFullname" (list . "crawl"))
*/}}
{{- define "jina-reader.componentFullname" -}}
{{- $root := index . 0 -}}
{{- $component := index . 1 -}}
{{- printf "%s-%s" (include "jina-reader.fullname" $root) $component | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Shared labels (no component-specific selector labels here).
*/}}
{{- define "jina-reader.labels" -}}
helm.sh/chart: {{ include "jina-reader.chart" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: {{ include "jina-reader.name" . }}
{{- end }}

{{/*
componentLabels: call as (include "jina-reader.componentLabels" (list . "crawl"))
Includes shared labels + component-specific name/instance/component.
*/}}
{{- define "jina-reader.componentLabels" -}}
{{- $root := index . 0 -}}
{{- $component := index . 1 -}}
{{ include "jina-reader.labels" $root }}
app.kubernetes.io/name: {{ include "jina-reader.componentFullname" (list $root $component) }}
app.kubernetes.io/instance: {{ $root.Release.Name }}
app.kubernetes.io/component: {{ $component }}
{{- end }}

{{/*
componentSelectorLabels: minimal stable labels for matchLabels / Service selector.
call as (include "jina-reader.componentSelectorLabels" (list . "crawl"))
*/}}
{{- define "jina-reader.componentSelectorLabels" -}}
{{- $root := index . 0 -}}
{{- $component := index . 1 -}}
app.kubernetes.io/name: {{ include "jina-reader.componentFullname" (list $root $component) }}
app.kubernetes.io/instance: {{ $root.Release.Name }}
{{- end }}

{{- define "jina-reader.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "jina-reader.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}
```

- [ ] **Step 5: Create NOTES.txt**

```
{{/*
helm-charts/jina-reader/templates/NOTES.txt
*/}}
jina-reader deployed successfully.

{{- if .Values.ingress.enabled }}
Services are available at:
  https://{{ .Values.ingress.host }}/crawl   — URL → Markdown (r.jina.ai equivalent)
  https://{{ .Values.ingress.host }}/search  — Search query → crawled Markdown
  https://{{ .Values.ingress.host }}/serp    — Search query → raw SERP results
{{- end }}
```

- [ ] **Step 6: Create serviceaccount.yaml**

```yaml
{{/*
helm-charts/jina-reader/templates/serviceaccount.yaml
*/}}
{{- if .Values.serviceAccount.create -}}
apiVersion: v1
kind: ServiceAccount
metadata:
  name: {{ include "jina-reader.serviceAccountName" . }}
  labels:
    {{- include "jina-reader.labels" . | nindent 4 }}
  {{- with .Values.serviceAccount.annotations }}
  annotations:
    {{- toYaml . | nindent 4 }}
  {{- end }}
{{- end }}
```

- [ ] **Step 7: Lint**

```bash
helm lint helm-charts/jina-reader/
```

Expected: `1 chart(s) linted, 0 chart(s) failed`

- [ ] **Step 8: Commit**

```bash
git add helm-charts/jina-reader/Chart.yaml \
        helm-charts/jina-reader/values.yaml \
        helm-charts/jina-reader/templates/_helpers.tpl \
        helm-charts/jina-reader/templates/NOTES.txt \
        helm-charts/jina-reader/templates/serviceaccount.yaml
git commit -m "feat(helm): scaffold jina-reader chart with helpers and values"
```

---

## Task 2: Crawl service — Deployment, Service, HPA

**Files:**
- Create: `helm-charts/jina-reader/templates/deployment-crawl.yaml`
- Create: `helm-charts/jina-reader/templates/service-crawl.yaml`
- Create: `helm-charts/jina-reader/templates/hpa-crawl.yaml`

- [ ] **Step 1: Create deployment-crawl.yaml**

The Dockerfile ENTRYPOINT is `["node"]`; `args:` overrides `CMD` to select the entry point file, keeping `node` as the executable.

```yaml
{{/*
helm-charts/jina-reader/templates/deployment-crawl.yaml
*/}}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "jina-reader.componentFullname" (list . "crawl") }}
  labels:
    {{- include "jina-reader.componentLabels" (list . "crawl") | nindent 4 }}
spec:
  {{- if not .Values.crawl.autoscaling.enabled }}
  replicas: {{ .Values.crawl.replicaCount }}
  {{- end }}
  selector:
    matchLabels:
      {{- include "jina-reader.componentSelectorLabels" (list . "crawl") | nindent 6 }}
  template:
    metadata:
      {{- with .Values.podAnnotations }}
      annotations:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      labels:
        {{- include "jina-reader.componentLabels" (list . "crawl") | nindent 8 }}
    spec:
      {{- with .Values.imagePullSecrets }}
      imagePullSecrets:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      serviceAccountName: {{ include "jina-reader.serviceAccountName" . }}
      securityContext:
        {{- toYaml .Values.podSecurityContext | nindent 8 }}
      containers:
        - name: crawl
          securityContext:
            {{- toYaml .Values.securityContext | nindent 12 }}
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag | default .Chart.AppVersion }}"
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          args:
            {{- toYaml .Values.crawl.args | nindent 12 }}
          {{- if .Values.envSecretName }}
          envFrom:
            - secretRef:
                name: {{ .Values.envSecretName }}
          {{- end }}
          {{- if .Values.crawl.extraContainerEnv }}
          env:
            {{- toYaml .Values.crawl.extraContainerEnv | nindent 12 }}
          {{- end }}
          ports:
            - name: http
              containerPort: 8080
              protocol: TCP
          livenessProbe:
            {{- toYaml .Values.livenessProbe | nindent 12 }}
          readinessProbe:
            {{- toYaml .Values.readinessProbe | nindent 12 }}
          resources:
            {{- toYaml .Values.crawl.resources | nindent 12 }}
      {{- with .Values.nodeSelector }}
      nodeSelector:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with .Values.affinity }}
      affinity:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with .Values.tolerations }}
      tolerations:
        {{- toYaml . | nindent 8 }}
      {{- end }}
```

- [ ] **Step 2: Create service-crawl.yaml**

```yaml
{{/*
helm-charts/jina-reader/templates/service-crawl.yaml
*/}}
apiVersion: v1
kind: Service
metadata:
  name: {{ include "jina-reader.componentFullname" (list . "crawl") }}
  labels:
    {{- include "jina-reader.componentLabels" (list . "crawl") | nindent 4 }}
spec:
  type: ClusterIP
  ports:
    - port: 80
      targetPort: http
      protocol: TCP
      name: http
  selector:
    {{- include "jina-reader.componentSelectorLabels" (list . "crawl") | nindent 4 }}
```

- [ ] **Step 3: Create hpa-crawl.yaml**

```yaml
{{/*
helm-charts/jina-reader/templates/hpa-crawl.yaml
*/}}
{{- if .Values.crawl.autoscaling.enabled }}
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: {{ include "jina-reader.componentFullname" (list . "crawl") }}
  labels:
    {{- include "jina-reader.componentLabels" (list . "crawl") | nindent 4 }}
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: {{ include "jina-reader.componentFullname" (list . "crawl") }}
  minReplicas: {{ .Values.crawl.autoscaling.minReplicas }}
  maxReplicas: {{ .Values.crawl.autoscaling.maxReplicas }}
  metrics:
    {{- if .Values.crawl.autoscaling.targetCPUUtilizationPercentage }}
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: {{ .Values.crawl.autoscaling.targetCPUUtilizationPercentage }}
    {{- end }}
    {{- if .Values.crawl.autoscaling.targetMemoryUtilizationPercentage }}
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: {{ .Values.crawl.autoscaling.targetMemoryUtilizationPercentage }}
    {{- end }}
{{- end }}
```

- [ ] **Step 4: Lint and dry-run**

```bash
helm lint helm-charts/jina-reader/
helm template jina-reader helm-charts/jina-reader/ | grep -A 5 "kind: Deployment"
```

Expected: lint passes, output shows one Deployment named `jina-reader-crawl`.

- [ ] **Step 5: Commit**

```bash
git add helm-charts/jina-reader/templates/deployment-crawl.yaml \
        helm-charts/jina-reader/templates/service-crawl.yaml \
        helm-charts/jina-reader/templates/hpa-crawl.yaml
git commit -m "feat(helm): add crawl deployment, service, and HPA"
```

---

## Task 3: Search service — Deployment, Service, HPA

**Files:**
- Create: `helm-charts/jina-reader/templates/deployment-search.yaml`
- Create: `helm-charts/jina-reader/templates/service-search.yaml`
- Create: `helm-charts/jina-reader/templates/hpa-search.yaml`

- [ ] **Step 1: Create deployment-search.yaml**

```yaml
{{/*
helm-charts/jina-reader/templates/deployment-search.yaml
*/}}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "jina-reader.componentFullname" (list . "search") }}
  labels:
    {{- include "jina-reader.componentLabels" (list . "search") | nindent 4 }}
spec:
  {{- if not .Values.search.autoscaling.enabled }}
  replicas: {{ .Values.search.replicaCount }}
  {{- end }}
  selector:
    matchLabels:
      {{- include "jina-reader.componentSelectorLabels" (list . "search") | nindent 6 }}
  template:
    metadata:
      {{- with .Values.podAnnotations }}
      annotations:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      labels:
        {{- include "jina-reader.componentLabels" (list . "search") | nindent 8 }}
    spec:
      {{- with .Values.imagePullSecrets }}
      imagePullSecrets:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      serviceAccountName: {{ include "jina-reader.serviceAccountName" . }}
      securityContext:
        {{- toYaml .Values.podSecurityContext | nindent 8 }}
      containers:
        - name: search
          securityContext:
            {{- toYaml .Values.securityContext | nindent 12 }}
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag | default .Chart.AppVersion }}"
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          args:
            {{- toYaml .Values.search.args | nindent 12 }}
          {{- if .Values.envSecretName }}
          envFrom:
            - secretRef:
                name: {{ .Values.envSecretName }}
          {{- end }}
          {{- if .Values.search.extraContainerEnv }}
          env:
            {{- toYaml .Values.search.extraContainerEnv | nindent 12 }}
          {{- end }}
          ports:
            - name: http
              containerPort: 8080
              protocol: TCP
          livenessProbe:
            {{- toYaml .Values.livenessProbe | nindent 12 }}
          readinessProbe:
            {{- toYaml .Values.readinessProbe | nindent 12 }}
          resources:
            {{- toYaml .Values.search.resources | nindent 12 }}
      {{- with .Values.nodeSelector }}
      nodeSelector:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with .Values.affinity }}
      affinity:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with .Values.tolerations }}
      tolerations:
        {{- toYaml . | nindent 8 }}
      {{- end }}
```

- [ ] **Step 2: Create service-search.yaml**

```yaml
{{/*
helm-charts/jina-reader/templates/service-search.yaml
*/}}
apiVersion: v1
kind: Service
metadata:
  name: {{ include "jina-reader.componentFullname" (list . "search") }}
  labels:
    {{- include "jina-reader.componentLabels" (list . "search") | nindent 4 }}
spec:
  type: ClusterIP
  ports:
    - port: 80
      targetPort: http
      protocol: TCP
      name: http
  selector:
    {{- include "jina-reader.componentSelectorLabels" (list . "search") | nindent 4 }}
```

- [ ] **Step 3: Create hpa-search.yaml**

```yaml
{{/*
helm-charts/jina-reader/templates/hpa-search.yaml
*/}}
{{- if .Values.search.autoscaling.enabled }}
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: {{ include "jina-reader.componentFullname" (list . "search") }}
  labels:
    {{- include "jina-reader.componentLabels" (list . "search") | nindent 4 }}
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: {{ include "jina-reader.componentFullname" (list . "search") }}
  minReplicas: {{ .Values.search.autoscaling.minReplicas }}
  maxReplicas: {{ .Values.search.autoscaling.maxReplicas }}
  metrics:
    {{- if .Values.search.autoscaling.targetCPUUtilizationPercentage }}
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: {{ .Values.search.autoscaling.targetCPUUtilizationPercentage }}
    {{- end }}
    {{- if .Values.search.autoscaling.targetMemoryUtilizationPercentage }}
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: {{ .Values.search.autoscaling.targetMemoryUtilizationPercentage }}
    {{- end }}
{{- end }}
```

- [ ] **Step 4: Lint and verify three Deployments exist**

```bash
helm lint helm-charts/jina-reader/
helm template jina-reader helm-charts/jina-reader/ | grep "^  name:" | grep -E "crawl|search"
```

Expected: lines `name: jina-reader-crawl` and `name: jina-reader-search` appear.

- [ ] **Step 5: Commit**

```bash
git add helm-charts/jina-reader/templates/deployment-search.yaml \
        helm-charts/jina-reader/templates/service-search.yaml \
        helm-charts/jina-reader/templates/hpa-search.yaml
git commit -m "feat(helm): add search deployment, service, and HPA"
```

---

## Task 4: Serp service — Deployment, Service, HPA

**Files:**
- Create: `helm-charts/jina-reader/templates/deployment-serp.yaml`
- Create: `helm-charts/jina-reader/templates/service-serp.yaml`
- Create: `helm-charts/jina-reader/templates/hpa-serp.yaml`

- [ ] **Step 1: Create deployment-serp.yaml**

```yaml
{{/*
helm-charts/jina-reader/templates/deployment-serp.yaml
*/}}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "jina-reader.componentFullname" (list . "serp") }}
  labels:
    {{- include "jina-reader.componentLabels" (list . "serp") | nindent 4 }}
spec:
  {{- if not .Values.serp.autoscaling.enabled }}
  replicas: {{ .Values.serp.replicaCount }}
  {{- end }}
  selector:
    matchLabels:
      {{- include "jina-reader.componentSelectorLabels" (list . "serp") | nindent 6 }}
  template:
    metadata:
      {{- with .Values.podAnnotations }}
      annotations:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      labels:
        {{- include "jina-reader.componentLabels" (list . "serp") | nindent 8 }}
    spec:
      {{- with .Values.imagePullSecrets }}
      imagePullSecrets:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      serviceAccountName: {{ include "jina-reader.serviceAccountName" . }}
      securityContext:
        {{- toYaml .Values.podSecurityContext | nindent 8 }}
      containers:
        - name: serp
          securityContext:
            {{- toYaml .Values.securityContext | nindent 12 }}
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag | default .Chart.AppVersion }}"
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          args:
            {{- toYaml .Values.serp.args | nindent 12 }}
          {{- if .Values.envSecretName }}
          envFrom:
            - secretRef:
                name: {{ .Values.envSecretName }}
          {{- end }}
          {{- if .Values.serp.extraContainerEnv }}
          env:
            {{- toYaml .Values.serp.extraContainerEnv | nindent 12 }}
          {{- end }}
          ports:
            - name: http
              containerPort: 8080
              protocol: TCP
          livenessProbe:
            {{- toYaml .Values.livenessProbe | nindent 12 }}
          readinessProbe:
            {{- toYaml .Values.readinessProbe | nindent 12 }}
          resources:
            {{- toYaml .Values.serp.resources | nindent 12 }}
      {{- with .Values.nodeSelector }}
      nodeSelector:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with .Values.affinity }}
      affinity:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with .Values.tolerations }}
      tolerations:
        {{- toYaml . | nindent 8 }}
      {{- end }}
```

- [ ] **Step 2: Create service-serp.yaml**

```yaml
{{/*
helm-charts/jina-reader/templates/service-serp.yaml
*/}}
apiVersion: v1
kind: Service
metadata:
  name: {{ include "jina-reader.componentFullname" (list . "serp") }}
  labels:
    {{- include "jina-reader.componentLabels" (list . "serp") | nindent 4 }}
spec:
  type: ClusterIP
  ports:
    - port: 80
      targetPort: http
      protocol: TCP
      name: http
  selector:
    {{- include "jina-reader.componentSelectorLabels" (list . "serp") | nindent 4 }}
```

- [ ] **Step 3: Create hpa-serp.yaml**

```yaml
{{/*
helm-charts/jina-reader/templates/hpa-serp.yaml
*/}}
{{- if .Values.serp.autoscaling.enabled }}
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: {{ include "jina-reader.componentFullname" (list . "serp") }}
  labels:
    {{- include "jina-reader.componentLabels" (list . "serp") | nindent 4 }}
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: {{ include "jina-reader.componentFullname" (list . "serp") }}
  minReplicas: {{ .Values.serp.autoscaling.minReplicas }}
  maxReplicas: {{ .Values.serp.autoscaling.maxReplicas }}
  metrics:
    {{- if .Values.serp.autoscaling.targetCPUUtilizationPercentage }}
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: {{ .Values.serp.autoscaling.targetCPUUtilizationPercentage }}
    {{- end }}
    {{- if .Values.serp.autoscaling.targetMemoryUtilizationPercentage }}
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: {{ .Values.serp.autoscaling.targetMemoryUtilizationPercentage }}
    {{- end }}
{{- end }}
```

- [ ] **Step 4: Lint and verify all three Deployments**

```bash
helm lint helm-charts/jina-reader/
helm template jina-reader helm-charts/jina-reader/ | grep "kind:"
```

Expected: three `kind: Deployment` and three `kind: Service` lines in output.

- [ ] **Step 5: Commit**

```bash
git add helm-charts/jina-reader/templates/deployment-serp.yaml \
        helm-charts/jina-reader/templates/service-serp.yaml \
        helm-charts/jina-reader/templates/hpa-serp.yaml
git commit -m "feat(helm): add serp deployment, service, and HPA"
```

---

## Task 5: Ingress with path-prefix rewriting

**Files:**
- Create: `helm-charts/jina-reader/templates/ingress.yaml`

- [ ] **Step 1: Create ingress.yaml**

`rewrite-target: /$2` with `use-regex: "true"` strips the prefix: `/crawl/foo` → `/foo`. The `(/|$)(.*)` capture groups handle both `/crawl` (no trailing slash) and `/crawl/path`.

```yaml
{{/*
helm-charts/jina-reader/templates/ingress.yaml
*/}}
{{- if .Values.ingress.enabled -}}
{{- if semverCompare ">=1.19-0" .Capabilities.KubeVersion.GitVersion -}}
apiVersion: networking.k8s.io/v1
{{- else if semverCompare ">=1.14-0" .Capabilities.KubeVersion.GitVersion -}}
apiVersion: networking.k8s.io/v1beta1
{{- else -}}
apiVersion: extensions/v1beta1
{{- end }}
kind: Ingress
metadata:
  name: {{ include "jina-reader.fullname" . }}
  labels:
    {{- include "jina-reader.labels" . | nindent 4 }}
  annotations:
    nginx.ingress.kubernetes.io/rewrite-target: /$2
    nginx.ingress.kubernetes.io/use-regex: "true"
    {{- with .Values.ingress.annotations }}
    {{- toYaml . | nindent 4 }}
    {{- end }}
spec:
  {{- if and .Values.ingress.className (semverCompare ">=1.18-0" .Capabilities.KubeVersion.GitVersion) }}
  ingressClassName: {{ .Values.ingress.className }}
  {{- end }}
  {{- if .Values.ingress.tls.secretName }}
  tls:
    - hosts:
        - {{ .Values.ingress.host | quote }}
      secretName: {{ .Values.ingress.tls.secretName }}
  {{- end }}
  rules:
    - host: {{ .Values.ingress.host | quote }}
      http:
        paths:
          - path: /crawl(/|$)(.*)
            {{- if semverCompare ">=1.18-0" .Capabilities.KubeVersion.GitVersion }}
            pathType: ImplementationSpecific
            {{- end }}
            backend:
              {{- if semverCompare ">=1.19-0" .Capabilities.KubeVersion.GitVersion }}
              service:
                name: {{ include "jina-reader.componentFullname" (list . "crawl") }}
                port:
                  number: 80
              {{- else }}
              serviceName: {{ include "jina-reader.componentFullname" (list . "crawl") }}
              servicePort: 80
              {{- end }}
          - path: /search(/|$)(.*)
            {{- if semverCompare ">=1.18-0" .Capabilities.KubeVersion.GitVersion }}
            pathType: ImplementationSpecific
            {{- end }}
            backend:
              {{- if semverCompare ">=1.19-0" .Capabilities.KubeVersion.GitVersion }}
              service:
                name: {{ include "jina-reader.componentFullname" (list . "search") }}
                port:
                  number: 80
              {{- else }}
              serviceName: {{ include "jina-reader.componentFullname" (list . "search") }}
              servicePort: 80
              {{- end }}
          - path: /serp(/|$)(.*)
            {{- if semverCompare ">=1.18-0" .Capabilities.KubeVersion.GitVersion }}
            pathType: ImplementationSpecific
            {{- end }}
            backend:
              {{- if semverCompare ">=1.19-0" .Capabilities.KubeVersion.GitVersion }}
              service:
                name: {{ include "jina-reader.componentFullname" (list . "serp") }}
                port:
                  number: 80
              {{- else }}
              serviceName: {{ include "jina-reader.componentFullname" (list . "serp") }}
              servicePort: 80
              {{- end }}
{{- end }}
```

- [ ] **Step 2: Lint and verify Ingress output**

```bash
helm lint helm-charts/jina-reader/
helm template jina-reader helm-charts/jina-reader/ \
  --set ingress.host=reader.example.com \
  --set ingress.tls.secretName=reader-tls | grep -A 40 "kind: Ingress"
```

Expected: Ingress with three path rules, `rewrite-target: /$2`, and `use-regex: "true"` in annotations.

- [ ] **Step 3: Commit**

```bash
git add helm-charts/jina-reader/templates/ingress.yaml
git commit -m "feat(helm): add ingress with nginx path-prefix rewrite for /crawl /search /serp"
```

---

## Task 6: External Secrets

**Files:**
- Create: `helm-charts/jina-reader/templates/external-secrets/env-secrets.yaml`
- Create: `helm-charts/jina-reader/templates/external-secrets/cloudflare-secrets.yaml`

- [ ] **Step 1: Create env-secrets.yaml**

Pulls the app runtime config from AWS Secrets Manager as a flat JSON object and creates a k8s Secret. All three Deployments share this one Secret via `envFrom.secretRef`.

```yaml
{{/*
helm-charts/jina-reader/templates/external-secrets/env-secrets.yaml
*/}}
{{- if .Values.externalSecrets.env.enabled }}
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: {{ .Values.externalSecrets.env.targetSecretName }}-es
spec:
  refreshInterval: 5h
  secretStoreRef:
    name: {{ .Values.externalSecrets.clusterSecretStoreName }}
    kind: ClusterSecretStore
  target:
    name: {{ .Values.externalSecrets.env.targetSecretName }}
    creationPolicy: Owner
  dataFrom:
  - extract:
      key: {{ .Values.externalSecrets.env.externalEnvSecretName }}
{{- end }}
```

- [ ] **Step 2: Create cloudflare-secrets.yaml**

Pulls the Cloudflare CA cert and key from AWS Secrets Manager and assembles them into a k8s TLS Secret referenced by the Ingress.

```yaml
{{/*
helm-charts/jina-reader/templates/external-secrets/cloudflare-secrets.yaml
*/}}
{{- if .Values.externalSecrets.cloudflare.enabled }}
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: {{ .Values.externalSecrets.cloudflare.targetSecretName }}-es
spec:
  refreshInterval: 5h
  secretStoreRef:
    name: {{ .Values.externalSecrets.clusterSecretStoreName }}
    kind: ClusterSecretStore
  target:
    name: {{ .Values.externalSecrets.cloudflare.targetSecretName }}
    creationPolicy: Owner
    template:
      data:
        tls.crt: {{ printf "'{{ .crt }}'" }}
        tls.key: {{ printf "'{{ .key }}'" }}
  data:
  - secretKey: crt
    remoteRef:
      key: {{ .Values.externalSecrets.cloudflare.externalTlsCrtSecret }}
  - secretKey: key
    remoteRef:
      key: {{ .Values.externalSecrets.cloudflare.externalTlsKeySecret }}
{{- end }}
```

- [ ] **Step 3: Lint and verify ExternalSecrets render when enabled**

```bash
helm lint helm-charts/jina-reader/
helm template jina-reader helm-charts/jina-reader/ \
  --set externalSecrets.env.enabled=true \
  --set externalSecrets.cloudflare.enabled=true \
  --set externalSecrets.clusterSecretStoreName=asm-eu-west-1 \
  --set externalSecrets.env.targetSecretName=jina-reader-staging \
  --set externalSecrets.env.externalEnvSecretName=jina-reader-staging \
  --set externalSecrets.cloudflare.targetSecretName=jina-reader-cloudflare-tls \
  | grep "kind:"
```

Expected: output includes two `kind: ExternalSecret` lines alongside Deployments, Services, and Ingress.

- [ ] **Step 4: Commit**

```bash
git add helm-charts/jina-reader/templates/external-secrets/env-secrets.yaml \
        helm-charts/jina-reader/templates/external-secrets/cloudflare-secrets.yaml
git commit -m "feat(helm): add ExternalSecret templates for env config and Cloudflare TLS"
```

---

## Task 7: Environment values files

**Files:**
- Create: `helm-charts/jina-reader/values/values-staging.yaml`
- Create: `helm-charts/jina-reader/values/values-production.yaml`

Fill in the placeholders below with your actual AWS account ID, ECR repo name, secret names, and hostname before using.

- [ ] **Step 1: Create values-staging.yaml**

```yaml
# helm-charts/jina-reader/values/values-staging.yaml
image:
  repository: <AWS_ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/<ECR_REPO_NAME>-staging
  pullPolicy: Always
  tag: latest

fullnameOverride: "jina-reader"

externalSecrets:
  clusterSecretStoreName: asm-<REGION>
  env:
    enabled: true
    targetSecretName: jina-reader-staging
    externalEnvSecretName: jina-reader-staging
  cloudflare:
    enabled: true
    targetSecretName: jina-reader-cloudflare-tls
    externalTlsCrtSecret: cloudflare-ca-crt
    externalTlsKeySecret: cloudflare-ca-pk

envSecretName: jina-reader-staging

ingress:
  enabled: true
  className: nginx
  host: <YOUR_STAGING_HOST>
  annotations:
    nginx.ingress.kubernetes.io/send_timeout: "600"
    nginx.ingress.kubernetes.io/proxy-connect-timeout: "600"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "600"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "600"
    nginx.ingress.kubernetes.io/proxy-body-size: 16m
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
  tls:
    secretName: jina-reader-cloudflare-tls

crawl:
  replicaCount: 1
  args:
    - build/stand-alone/crawl.js
  extraContainerEnv:
    - name: NODE_ENV
      value: staging
  resources:
    limits:
      memory: 6Gi
    requests:
      cpu: "1"
      memory: 6Gi
  autoscaling:
    enabled: false
    minReplicas: 1
    maxReplicas: 2
    targetCPUUtilizationPercentage: 80

search:
  replicaCount: 1
  args:
    - build/stand-alone/search.js
  extraContainerEnv:
    - name: NODE_ENV
      value: staging
  resources:
    limits:
      memory: 4Gi
    requests:
      cpu: "1"
      memory: 4Gi
  autoscaling:
    enabled: false
    minReplicas: 1
    maxReplicas: 2
    targetCPUUtilizationPercentage: 80

serp:
  replicaCount: 1
  args:
    - build/stand-alone/serp.js
  extraContainerEnv:
    - name: NODE_ENV
      value: staging
  resources:
    limits:
      memory: 1Gi
    requests:
      cpu: 500m
      memory: 1Gi
  autoscaling:
    enabled: false
    minReplicas: 1
    maxReplicas: 2
    targetCPUUtilizationPercentage: 80

serviceAccount:
  create: false
  annotations: {}
  name: ""

podAnnotations: {}
podSecurityContext: {}
securityContext: {}
nodeSelector: {}
tolerations: []
affinity: {}
```

- [ ] **Step 2: Create values-production.yaml**

```yaml
# helm-charts/jina-reader/values/values-production.yaml
image:
  repository: <AWS_ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/<ECR_REPO_NAME>
  pullPolicy: Always
  tag: latest

fullnameOverride: "jina-reader"

externalSecrets:
  clusterSecretStoreName: asm-<REGION>
  env:
    enabled: true
    targetSecretName: jina-reader-production
    externalEnvSecretName: jina-reader-production
  cloudflare:
    enabled: true
    targetSecretName: jina-reader-cloudflare-tls
    externalTlsCrtSecret: cloudflare-ca-crt
    externalTlsKeySecret: cloudflare-ca-pk

envSecretName: jina-reader-production

ingress:
  enabled: true
  className: nginx
  host: <YOUR_PRODUCTION_HOST>
  annotations:
    nginx.ingress.kubernetes.io/send_timeout: "600"
    nginx.ingress.kubernetes.io/proxy-connect-timeout: "600"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "600"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "600"
    nginx.ingress.kubernetes.io/proxy-body-size: 16m
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
  tls:
    secretName: jina-reader-cloudflare-tls

crawl:
  replicaCount: 2
  args:
    - build/stand-alone/crawl.js
  extraContainerEnv:
    - name: NODE_ENV
      value: production
  resources:
    limits:
      memory: 8Gi
    requests:
      cpu: "1"
      memory: 8Gi
  autoscaling:
    enabled: true
    minReplicas: 2
    maxReplicas: 6
    targetCPUUtilizationPercentage: 80

search:
  replicaCount: 2
  args:
    - build/stand-alone/search.js
  extraContainerEnv:
    - name: NODE_ENV
      value: production
  resources:
    limits:
      memory: 6Gi
    requests:
      cpu: "1"
      memory: 6Gi
  autoscaling:
    enabled: true
    minReplicas: 2
    maxReplicas: 4
    targetCPUUtilizationPercentage: 80

serp:
  replicaCount: 1
  args:
    - build/stand-alone/serp.js
  extraContainerEnv:
    - name: NODE_ENV
      value: production
  resources:
    limits:
      memory: 2Gi
    requests:
      cpu: 500m
      memory: 2Gi
  autoscaling:
    enabled: true
    minReplicas: 1
    maxReplicas: 4
    targetCPUUtilizationPercentage: 80

serviceAccount:
  create: false
  annotations: {}
  name: ""

podAnnotations: {}
podSecurityContext: {}
securityContext: {}
nodeSelector: {}
tolerations: []
affinity:
  podAntiAffinity:
    requiredDuringSchedulingIgnoredDuringExecution:
      - labelSelector:
          matchExpressions:
            - key: app.kubernetes.io/part-of
              operator: In
              values:
                - jina-reader
        topologyKey: kubernetes.io/hostname
```

- [ ] **Step 3: Commit**

```bash
git add helm-charts/jina-reader/values/values-staging.yaml \
        helm-charts/jina-reader/values/values-production.yaml
git commit -m "feat(helm): add staging and production values files"
```

---

## Task 8: Full lint and template validation

- [ ] **Step 1: Lint the complete chart**

```bash
helm lint helm-charts/jina-reader/
```

Expected: `1 chart(s) linted, 0 chart(s) failed`

- [ ] **Step 2: Dry-run render with staging values**

```bash
helm template jina-reader helm-charts/jina-reader/ \
  -f helm-charts/jina-reader/values/values-staging.yaml \
  --set ingress.host=reader-staging.example.com \
  --set externalSecrets.cloudflare.targetSecretName=jina-reader-cloudflare-tls
```

Verify manually in the output:
- Three `kind: Deployment` resources with names `jina-reader-crawl`, `jina-reader-search`, `jina-reader-serp`
- Each Deployment has `args: [build/stand-alone/<name>.js]` (not `command:`)
- Three `kind: Service` resources, each `type: ClusterIP`, `port: 80 → targetPort: http`
- One `kind: Ingress` with `rewrite-target: /$2`, three path rules `/crawl(/|$)(.*)`, `/search(/|$)(.*)`, `/serp(/|$)(.*)`
- Two `kind: ExternalSecret` resources

- [ ] **Step 3: Verify args (not command) in rendered Deployment**

```bash
helm template jina-reader helm-charts/jina-reader/ \
  -f helm-charts/jina-reader/values/values-staging.yaml | grep -A 2 "args:"
```

Expected output (three blocks, one per service):
```
          args:
            - build/stand-alone/crawl.js
          ...
          args:
            - build/stand-alone/search.js
          ...
          args:
            - build/stand-alone/serp.js
```

No `command:` key should appear in the output.

- [ ] **Step 4: Final commit**

```bash
git add helm-charts/
git commit -m "feat(helm): complete jina-reader helm chart with crawl, search, and serp services"
```

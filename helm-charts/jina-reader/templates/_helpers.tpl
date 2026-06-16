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

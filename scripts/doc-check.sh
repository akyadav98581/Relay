#!/usr/bin/env bash
cd "$(dirname "$0")/.." || exit 1
ok=1
need() { grep -qiE "$2" "$1" || { echo "missing in $1: $2"; ok=0; }; }
[ -f render.yaml ] || { echo "no render.yaml"; ok=0; }
need render.yaml 'healthCheckPath'
need render.yaml 'DATABASE_URL'
need render.yaml 'JWT_SECRET'
need render.yaml 'MIN_SCHEDULE_MINUTES'
need README.md '^## .*run it'
need README.md '^## .*how it works'
need README.md 'SKIP LOCKED'
need README.md 'worker thread'
need README.md 'SSRF'
need README.md 'crash'
need README.md '^## .*deploy'
need README.md 'neon'
need README.md '^## .*limit'
need README.md 'one instance'
[ $ok -eq 1 ] && echo DOC_OK
[ $ok -eq 1 ]

#!/bin/sh
# HTML → Figma: запуск локального обработчика на macOS / Linux (нужен Node.js 20+).
cd "$(dirname "$0")" || exit 1
NODE=node
[ -x ./runtime/node ] && NODE=./runtime/node
exec "$NODE" processor/processor.cjs "$@"

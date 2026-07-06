#!/bin/sh
set -eu

node dist/src/config/init_db.js
exec "$@"

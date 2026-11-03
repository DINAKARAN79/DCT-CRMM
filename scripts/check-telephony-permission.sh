#!/bin/sh
set -eu

exec node scripts/telephony-db-sql.mjs check

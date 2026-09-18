#!/bin/sh
set -eu
if systemctl is-active --quiet coop-bench-api-proxy.service; then
    systemctl reload coop-bench-api-proxy.service
fi

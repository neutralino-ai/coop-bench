#!/bin/sh
set -eu
# Add as a distinct certbot deploy hook; never replace the legacy reload hook.
if systemctl is-active --quiet coop-bench-v09-proxy.service; then
    systemctl reload coop-bench-v09-proxy.service
fi

#!/bin/bash
set -euo pipefail
: "${APPLE_API_KEY_P8:?Missing App Store Connect key}"
: "${APPLE_API_KEY_ID:?Missing key ID}"
: "${APPLE_API_ISSUER:?Missing issuer}"
sign_dir=$(mktemp -d "$RUNNER_TEMP/coop-upload.XXXXXX")
trap 'rm -rf "$sign_dir"' EXIT
umask 077
printf '%s' "$APPLE_API_KEY_P8" > "$sign_dir/AuthKey_${APPLE_API_KEY_ID}.p8"
export API_PRIVATE_KEYS_DIR="$sign_dir"
files=(artifacts/ios-export/*.ipa)
[ "${#files[@]}" -eq 1 ] && [ -f "${files[0]}" ]
xcrun altool --validate-app --type ios --file "${files[0]}" --apiKey "$APPLE_API_KEY_ID" --apiIssuer "$APPLE_API_ISSUER"
xcrun altool --upload-app --type ios --file "${files[0]}" --apiKey "$APPLE_API_KEY_ID" --apiIssuer "$APPLE_API_ISSUER"

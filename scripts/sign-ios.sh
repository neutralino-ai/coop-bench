#!/bin/bash
set -euo pipefail
[ "${GITHUB_EVENT_NAME:-}" != pull_request ]
: "${IOS_DISTRIBUTION_P12:?Missing distribution certificate}"
: "${IOS_DISTRIBUTION_PASSWORD:?Missing distribution password}"
: "${IOS_APP_STORE_PROFILE:?Missing App Store profile}"
: "${APPLE_TEAM_ID:?Missing team}"
umask 077
sign_dir=$(mktemp -d "$RUNNER_TEMP/coop-ios-sign.XXXXXX")
export SIGN_DIR="$sign_dir"
keychain="$sign_dir/signing.keychain-db"
profile_path=''
cleanup() {
  security delete-keychain "$keychain" >/dev/null 2>&1 || true
  if [ -n "$profile_path" ]; then rm -f "$profile_path"; fi
  rm -rf "$sign_dir"
}
trap cleanup EXIT
python3 - <<'PY'
import os,base64,pathlib
p=pathlib.Path(os.environ['SIGN_DIR'])
for secret,name in [('IOS_DISTRIBUTION_P12','distribution.p12'),('IOS_APP_STORE_PROFILE','profile.mobileprovision')]:
    (p/name).write_bytes(base64.b64decode(os.environ[secret].strip(),validate=True))
PY
keychain_password=$(openssl rand -hex 32)
echo "::add-mask::$keychain_password"
security create-keychain -p "$keychain_password" "$keychain"
security set-keychain-settings -lut 21600 "$keychain"
security unlock-keychain -p "$keychain_password" "$keychain"
security import "$sign_dir/distribution.p12" -k "$keychain" -P "$IOS_DISTRIBUTION_PASSWORD" -T /usr/bin/codesign -T /usr/bin/security
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$keychain_password" "$keychain" >/dev/null
security list-keychains -d user -s "$keychain" "$HOME/Library/Keychains/login.keychain-db"
security find-identity -v -p codesigning "$keychain"
security cms -D -i "$sign_dir/profile.mobileprovision" > "$sign_dir/profile.plist"
python3 - <<'PY'
import os,plistlib,pathlib,datetime
p=pathlib.Path(os.environ['SIGN_DIR']);profile=plistlib.loads((p/'profile.plist').read_bytes())
team=os.environ['APPLE_TEAM_ID']; e=profile['Entitlements']
assert profile['TeamIdentifier']==[team], 'Wrong profile team'
assert e['application-identifier']==team+'.org.coopbench.ios', 'Wrong bundle'
assert e.get('get-task-allow') is False, 'Development profile rejected'
assert not profile.get('ProvisionedDevices') and not profile.get('ProvisionsAllDevices'), 'App Store profile required'
assert profile['ExpirationDate']>datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
(p/'uuid').write_text(profile['UUID'])
opts={'method':'app-store-connect','destination':'export','signingStyle':'manual','teamID':team,'signingCertificate':'Apple Distribution','provisioningProfiles':{'org.coopbench.ios':profile['UUID']},'manageAppVersionAndBuildNumber':False,'uploadSymbols':True}
(p/'ExportOptions.plist').write_bytes(plistlib.dumps(opts))
PY
uuid=$(cat "$sign_dir/uuid")
profile_dir="$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"
mkdir -p "$profile_dir"
profile_path="$profile_dir/$uuid.mobileprovision"
cp "$sign_dir/profile.mobileprovision" "$profile_path"
build_number="${GITHUB_RUN_NUMBER}.${GITHUB_RUN_ATTEMPT}"
xcodebuild archive -project ios/CoopBench.xcodeproj -scheme CoopBench -configuration Release -destination 'generic/platform=iOS' -archivePath artifacts/ios-archive/CoopBench.xcarchive DEVELOPMENT_TEAM="$APPLE_TEAM_ID" CODE_SIGN_STYLE=Manual CODE_SIGN_IDENTITY='Apple Distribution' PROVISIONING_PROFILE_SPECIFIER="$uuid" CURRENT_PROJECT_VERSION="$build_number" OTHER_CODE_SIGN_FLAGS="--keychain $keychain"
xcodebuild -exportArchive -archivePath artifacts/ios-archive/CoopBench.xcarchive -exportPath artifacts/ios-export -exportOptionsPlist "$sign_dir/ExportOptions.plist"
ipa_files=(artifacts/ios-export/*.ipa)
[ "${#ipa_files[@]}" -eq 1 ] && [ -f "${ipa_files[0]}" ]
mkdir "$sign_dir/exported"
unzip -q "${ipa_files[0]}" -d "$sign_dir/exported"
app="$sign_dir/exported/Payload/CoopBench.app"
codesign --verify --deep --strict "$app"
codesign -d --entitlements :- "$app" > "$sign_dir/app-entitlements.plist"
python3 - <<'PY'
import os,plistlib,pathlib,json
p=pathlib.Path(os.environ['SIGN_DIR']);e=plistlib.loads((p/'app-entitlements.plist').read_bytes())
assert e['application-identifier']==os.environ['APPLE_TEAM_ID']+'.org.coopbench.ios'
assert not e.get('get-task-allow',False)
info=plistlib.loads((p/'exported/Payload/CoopBench.app/Info.plist').read_bytes())
out=pathlib.Path('artifacts/apple-signing');out.mkdir(parents=True,exist_ok=True)
(out/'ios-verification.json').write_text(json.dumps({'ok':True,'bundleId':info['CFBundleIdentifier'],'version':info['CFBundleShortVersionString'],'build':info['CFBundleVersion'],'team':os.environ['APPLE_TEAM_ID']}))
PY

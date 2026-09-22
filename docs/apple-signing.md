# Apple signing and TestFlight

The Remote clients workflow keeps Windows, macOS Intel, macOS Apple Silicon and
iOS acceptance together. Tags require Apple signing; a manual run can enable
`apple_signing` to validate a candidate without publishing a GitHub release.
Pull requests and ordinary iOS CI runs do not receive signing materials in build
steps. A missing signing secret fails the signed build; it does not fall back to
an unsigned release.

Repository Actions Secrets:

- `MAC_DEVELOPER_ID_P12`, `MAC_DEVELOPER_ID_PASSWORD`: base64 encrypted PKCS#12
  and its password, containing a Developer ID Application certificate.
- `IOS_DISTRIBUTION_P12`, `IOS_DISTRIBUTION_PASSWORD`: equivalent Apple
  Distribution certificate and private key.
- `IOS_APP_STORE_PROFILE`: base64 App Store distribution provisioning profile
  for `org.coopbench.ios`, containing the iOS certificate above.
- `APPLE_TEAM_ID`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, `APPLE_API_KEY_P8`:
  team and App Store Connect API authentication; P8 is the original PEM text.

Private keys are used only in temporary runner directories/keychains, cleaned
after signing, and excluded from artifact uploads. Public signed applications
contain certificates and signatures, not these private keys. Only trusted
maintainers should edit/run workflows with access to repository secrets.

macOS packages use hardened runtime and Developer ID signing. electron-builder
notarizes and staples each app; the workflow also notarizes and staples each
DMG. Final ZIP contents and DMGs must pass signature, stapling and Gatekeeper
checks. Both actual packaged clients still run the existing mock API acceptance.
GitHub Releases and the existing credential-free updater remain the desktop
distribution route.

iOS runs native and simulator acceptance before creating a manually signed
archive and App Store IPA. The build number uses the parent run number and
attempt to allow repeat uploads. Only after all four platforms pass does a
separate job validate and upload the IPA to App Store Connect. Upload completion
is distinct from Apple processing, beta review, tester availability and physical
iPhone acceptance. App Store IPAs cannot be installed by downloading them from
GitHub; use TestFlight. Releases continue to include the matching Xcode source
project ZIP.

The iOS client uses Apple's HTTPS/Keychain services and CryptoKit SHA-256, with
no custom encryption protocol. `ITSAppUsesNonExemptEncryption` is false for this
implementation; reassess when changing its cryptography.

Actual signing/notarization evidence is uploaded as `apple-signing-*` artifacts.
No physical Mac or iPhone installation is implied by CI results.

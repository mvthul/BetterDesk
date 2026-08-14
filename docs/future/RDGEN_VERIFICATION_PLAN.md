# RDGen Parameter Verification Plan

This plan comprehensively cross-checks every single input field available on the BetterDesk Generator UI to ensure they correctly propagate through the `rdgen-master` GitHub Action workflows and properly patch the underlying `rustdesk/rustdesk` source code.

## User Review Required
Please review the verification matrix below. We have identified several `sed` commands in `rdgen-master` workflows that are either broken or fragile (like the `rs-ny.rustdesk.com` bug reported in issue #277). 

If you approve this plan, I will proceed to execute the verification and apply fixes by updating the workflow files in the `rdgen-master` repository and testing them.

---

## 1. Version & Naming Parameters

- [ ] **Rustdesk Version (`version`)**
  - *Mechanism*: Used in `actions/checkout@v4` to pull `refs/tags/${{ env.VERSION }}`.
  - *Verification needed*: Ensure workflow gracefully handles versions that don't exist as tags in the upstream repo.
- [ ] **Custom Application Name (`appname`)**
  - *Mechanism*: 7x `sed` commands replacing `ProductName`, `description`, and `OriginalFilename` in `Cargo.toml` and `src/main.rs`.
  - *Verification needed*: Validate strings still exist in target `rustdesk/Cargo.toml`.
- [ ] **Name of the configuration (`filename`)**
  - *Mechanism*: Dictates the final `.exe` / `.deb` / `.apk` artifact name.
  - *Verification needed*: Verify output file correctly reflects the filename without spaces/special characters.
- [ ] **Company Name (`compname`)**
  - *Mechanism*: `sed` replacements for `Purslane Ltd` / `Purslane Tech Pte. Ltd.` in Dart files and Cargo files.
  - *Verification needed*: Verify the replaced strings still exist in target files.

---

## 2. Server & API Parameters

> [!WARNING]
> **Issue Identified**: The Custom Server replacement is currently broken if the upstream RustDesk repository utilizes multiple domains (like `rs-sg.rustdesk.com` and `rs-cn.rustdesk.com`), causing the client to ignore the custom server. 

- [ ] **Custom Server Host (`server`)**
  - *Mechanism*: `sed -i -e 's|rs-ny.rustdesk.com|${{ env.server }}|' ./libs/hbb_common/src/config.rs`
  - *Verification needed*: Apply the patch suggested in GitHub Issue #277 to replace *all* known default servers (`rs-sg`, `rs-cn`, `rs-ny`).
- [ ] **Custom Server Key (`key`)**
  - *Mechanism*: `sed` replacement of the default base64 public key in `config.rs`.
  - *Verification needed*: Verify `OeVuKk5nlHiXp+APNn0Y3pC1Iwpwn44JGqrQCsWqmBw=` exists in all target branches.
- [ ] **Custom Server API (`apiServer`)**
  - *Mechanism*: `sed` replacement of `https://admin.rustdesk.com`.
  - *Verification needed*: Verify the string exists in `src/common.rs`.

---

## 3. URLs & Links

- [ ] **Custom URL for links (`urlLink`)**
  - *Mechanism*: Replaces `https://rustdesk.com` in `build.py`, `common.dart`, `desktop_setting_page.dart`, etc.
  - *Verification needed*: Verify exact string matches in target files.
- [ ] **Custom URL for downloading updates (`downloadLink`)**
  - *Mechanism*: Replaces `https://rustdesk.com/download` in `desktop_home_page.dart` and `connection_page.dart`.
  - *Verification needed*: Verify exact string matches in target files.

---

## 4. Features & Overrides (custom.txt)

> [!WARNING]
> **Issue Identified**: Settings such as `allow-websocket=Y`, `disable-installation`, `direct-ip`, etc. are injected into `custom.txt`. However, they are ignored if `allowCustom.py` fails to successfully patch the RustDesk source code to read `custom.txt` at compilation time. 

- [ ] **Disable Installation (`disable-installation=Y`)**
- [ ] **Disable Settings (`disable-settings=Y`)**
- [ ] **Password Approve Mode (`access-mode`)**
- [ ] **Deny LAN discovery (`deny-lan=Y`)**
- [ ] **Enable direct IP access (`direct-ip=Y`)**
- [ ] **Permissions (Keyboard, File Transfer, etc.) (`enable-keyboard=Y`, etc.)**
- [ ] **Theme (`allow-darktheme`)**
- [ ] **Default / Override manual (`allow-websocket=Y`, etc.)**
  - *Mechanism for all above*: BetterDesk compiles these into a base64 string, sends it to `rdgen`, which decodes it and writes it to `custom.txt`. A python script `allowCustom.py` is downloaded to patch the rustdesk source to parse this file.
  - *Verification needed*: Review and test `allowCustom.py` in `rdgen-master` to ensure it successfully modifies the RustDesk config pipeline. If `allow-websocket` is ignored, it implies `custom.txt` is not being parsed correctly at runtime by the compiled client.

---

## 5. Visuals & UI Modifications

- [ ] **Custom App Icon / Logo / Privacy Screen**
  - *Mechanism*: Images are pulled via `wget` using `uuid` and converted using `imagemagick` to `.ico`, `.png` sizes.
  - *Verification needed*: Ensure BetterDesk server is reachable from the GitHub Action runner.
- [ ] **Fix connection delay (`delayFix`)**
  - *Mechanism*: `sed -i -e 's|!key.is_empty()|false|' ./src/client.rs`
  - *Verification needed*: Verify `!key.is_empty()` exists in `src/client.rs`.
- [ ] **Display an X for offline devices (`xOffline`)**
  - *Mechanism*: Uses `git apply xoffline.diff`.
  - *Verification needed*: Check if `xoffline.diff` applies cleanly to the chosen RustDesk version.
- [ ] **Remove notification for new versions (`removeNewVersionNotif`)**
  - *Mechanism*: `sed` replacements in `desktop_home_page.dart` and `src/common.rs`.
  - *Verification needed*: Verify exact string matches in target files.
- [ ] **Remove wallpaper during incoming sessions (`removeWallpaper`)**
  - *Mechanism*: `hidecm.diff`.
  - *Verification needed*: Check if `hidecm.diff` applies cleanly to the chosen RustDesk version.

## Next Steps upon Approval
1. Update all `.yml` workflows in `rdgen-master` to include the `rs-sg` and `rs-cn` server patches.
2. Review and patch `allowCustom.py` so that `custom.txt` attributes like `allow-websocket=Y` are properly respected by the RustDesk binary.
3. Validate `.diff` files apply cleanly to current versions.

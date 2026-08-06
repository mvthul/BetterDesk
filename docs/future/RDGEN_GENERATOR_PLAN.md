# Native rdgen RustDesk Client Generator Integration Plan

## Overview

This document details the architectural design and implementation plan to natively integrate **rdgen** (RustDesk client generator) into the **BetterDesk** console (`web-nodejs`). 

By replacing the standalone Python/Django server (`rdgen` running on port 8000) with native Express routes and services inside `web-nodejs`, BetterDesk provides a seamless, 1-to-1 RustDesk custom client builder directly from the BetterDesk Console, eliminating external service dependencies while leveraging GitHub Actions workflows for automated cross-platform client compilation.

> [!IMPORTANT]
> **Upstream `rdgen` Strict Compatibility Principle**: BetterDesk maintains **100% strict 1-to-1 function and API payload compatibility** with the upstream `bryangerlach/rdgen` repository. BetterDesk acts as a drop-in replacement for Django `rdgen` views without altering workflow inputs, secret format, or runner callback endpoints. If `bryangerlach/rdgen` releases upstream updates (new workflows, patches, or inputs), operators can pull/sync upstream changes directly into their forked repository without breaking BetterDesk integration.

---

## Key Architecture & Components

```
+-------------------------------------------------------------------------------+
|                             BetterDesk Web Console                            |
|                            (web-nodejs / Express)                             |
|                                                                               |
|  +---------------------------+             +-------------------------------+  |
|  |  Frontend Partial         |             |  Settings UI                  |  |
|  |  generator_rdgen_partial  |             |  GitHub credentials & Secrets |  |
|  +-------------+-------------+             +---------------+---------------+  |
|                |                                           |                  |
|                v                                           v                  |
|  +-------------------------------------------------------------------------+  |
|  | Express Generator Routes (/api/generator/rdgen/*)                       |  |
|  | - POST /generate : Form validation, AES-ZIP creation, GitHub Dispatch    |  |
|  | - GET /status/:uuid : Workflow progress & status polling                |  |
|  | - GET /get_zip & GET /get_png : Public artifact endpoints for Runner     |  |
|  | - POST /save_custom_client & POST /update_github_run : Runner callbacks   |  |
|  | - POST /cleanup_secrets : Secret zip cleanup after build                  |  |
|  | - GET /download : Client download delivery                             |  |
|  +-------------------------------------+-----------------------------------+  |
|                                        |                                      |
+----------------------------------------|--------------------------------------+
                                         |
                        1. Dispatch Workflow (POST)
                        2. Serves secrets zip & PNGs
                        3. Receives built client binary
                                         |
                                         v
+-------------------------------------------------------------------------------+
|                             GitHub Actions Runner                             |
|                          (Forked rdgen Repository)                            |
|                                                                               |
|  - Downloads AES-encrypted secrets.json & PNG assets                          |
|  - Applies RustDesk patches (delayFix, xOffline, hidecm, branding)            |
|  - Compiles Client (Windows 64/32, Linux AppImage, Android APK, macOS DMG)     |
|  - Uploads compiled client back to BetterDesk save_custom_client endpoint    |
+-------------------------------------------------------------------------------+
```

---

## Technical Details

### 1. Database Schema (`rdgen_runs`)

A dedicated SQLite table `rdgen_runs` managed via SQLite migrations in `web-nodejs`:

| Field | Type | Description |
|-------|------|-------------|
| `uuid` | TEXT PRIMARY KEY | Unique UUID for the build run |
| `github_run_id` | TEXT | Workflow run ID returned by GitHub API |
| `platform` | TEXT | Target platform (`windows`, `windows-x86`, `linux`, `android`, `macos`) |
| `filename` | TEXT | Executable filename (e.g. `rustdesk.exe`) |
| `appname` | TEXT | Custom application name |
| `status` | TEXT | Build status (`starting`, `in_progress`, `success`, `failure`, `cancelled`) |
| `log_url` | TEXT | Direct GitHub Actions log URL |
| `created_at` | DATETIME | Timestamp of build request |
| `updated_at` | DATETIME | Timestamp of last status update |

### 2. Configuration & Settings Management

Operators configure GitHub Action runner integration through **Settings -> Generator Settings** in the BetterDesk console, which merges into SQLite and `.env`:

- `GHUSER`: GitHub Username / Organization owning the forked `rdgen` repo.
- `GHBEARER`: Fine-grained Personal Access Token (PAT) with Actions Read/Write permissions.
- `REPONAME`: Repository name (default: `rdgen`).
- `GHBRANCH`: Git branch (default: `master`).
- `ZIP_PASSWORD`: Encryption key for securing temporary `secrets.json` transferred to GitHub Actions.
- `GENURL`: Public base URL of the BetterDesk server accessible by GitHub Actions runners.
- `PROTOCOL`: `https` or `http`.

### 3. Native Node.js Service Layer (`rdgenService.js`)

#### A. AES Secret Zip Packaging
- Emulates `pyzipper` AES-LZMA encryption using Node.js crypto/archiver library to produce encrypted `secrets_{uuid}.zip` containing `secrets.json` (server IP, public key, custom settings, encoded base64 parameters).

#### B. Image Asset Management
- Saves uploaded PNG assets (`icon.png`, `logo.png`, `privacy.png`) into `storage/rdgen/png/{uuid}/`.

#### C. GitHub API Dispatcher
- Sends `POST https://api.github.com/repos/{GHUSER}/{REPONAME}/actions/workflows/generator-{platform}.yml/dispatches` with bearer authentication.
- Automatically handles self-hosted runner workflow (`sh-generator-windows.yml`) when self-hosted secret key matches.

#### D. Status Polling & Runner Callbacks
- Exposes `get_zip`, `get_png`, `save_custom_client`, `update_github_run`, `cleanup_secrets` endpoints matching exact contract expected by GitHub Actions workflows in `rdgen`.

#### E. File Storage & Retention
- Stores built client binaries under `storage/rdgen/exe/{uuid}/{filename}`.
- Automated cron cleanup purges temporary zips and builds older than 24 hours.

### 4. Auto-Provision GitHub Repository & Environment Variables

To provide a seamless 1-click setup experience for operators:

#### A. Automated Repository Fork / Creation
- A **"1-Click Auto-Provision GitHub Repo"** feature is available on the Generator / Settings page.
- When triggered, `web-nodejs` uses the configured GitHub Personal Access Token (`GHBEARER` with `public_repo` / `repo` scope) via the GitHub REST API to:
  1. Fork or create a public repository under the user's account (`POST /user/repos` or `POST /repos/bryangerlach/rdgen/forks`).
  2. Enable GitHub Actions on the newly provisioned repository (`PUT /repos/{owner}/{repo}/actions/permissions`).
  3. Generate a cryptographically secure random `ZIP_PASSWORD` (100 hex bytes via Node `crypto.randomBytes`).

#### B. Automated Repository Secrets Setup
- `web-nodejs` computes and sets required repository secrets using GitHub's Sodium/NaCl public-key encryption API (`GET /repos/{owner}/{repo}/actions/secrets/public-key` & `PUT /repos/{owner}/{repo}/actions/secrets/{secret_name}`):
  - **`GENURL`**: Set to the external BetterDesk console URL (`https://<hostname>:<port>`).
  - **`ZIP_PASSWORD`**: Set to the generated secure password.
- Automatically saves `GHUSER`, `REPONAME` (`rdgen`), `GHBRANCH` (`master`), and `ZIP_PASSWORD` directly into BetterDesk's database & `.env` via `envMerge.js`.

---

## User Interface Integration

The frontend UI is hosted in `web-nodejs/views/generator_rdgen_partial.ejs`, rendered within `web-nodejs/views/generator.ejs`:

- **Auto-Provision Banner / Button**: If GitHub settings are not yet fully configured, displays a prominent banner with a **"1-Click Provision GitHub Build Repo"** button that automatically forks the `rdgen` repo, configures secrets, and enables workflows without manual terminal steps.
- **Platform Selector**: Buttons for Windows 64-bit, Windows 32-bit, Linux, Android, macOS.
- **Client Configuration**: Version selection (1.4.7 to nightly), Delay Fix toggle, Application Name, Exe Filename, Company Name.
- **Server Details**: Pre-filled from BetterDesk server configuration (Server IP, Public Key, API Server URL).
- **Security & Permissions**: Connection direction, permanent password, approve mode, LAN discovery, direct IP, hide connection window (`hidecm`), auto-close, granular permission checkboxes (keyboard, clipboard, file transfer, audio, TCP tunnel, restart, recording, input blocking, remote config, printer, camera, terminal).
- **Branding Assets**: File inputs for square icon PNG, logo PNG, privacy PNG, theme override settings.
- **Code Customizations**: `xOffline` indicator toggle, notification controls, manual default/override TOML parameters.
- **Build Progress**: Live status monitoring, progress indicators, GitHub log link, direct download button on completion.

---

## Verification & Testing Plan

1. **Unit & Service Tests**:
   - Verify `secrets.json` construction and AES zip creation logic.
   - Verify GitHub API payload structure and dispatch mock responses.
   - Validate security sanitization for input filenames and path traversal prevention.
2. **Integration & Callback Verification**:
   - Test `get_zip`, `get_png`, `save_custom_client`, `update_github_run`, and `cleanup_secrets` endpoints against mock GitHub Action callbacks.
3. **End-to-End Build Test**:
   - Dispatch real build request to forked GitHub repo runner and verify binary download upon build completion.

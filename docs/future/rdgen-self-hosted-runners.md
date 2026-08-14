# BetterDesk RDGen: Self-Hosted Runners Plan

## Goal
Migrate the RustDesk custom client generation from GitHub-hosted runners to **Self-Hosted Proxmox Runners**. 
This will drastically reduce build times (from ~15-20 minutes down to ~2-4 minutes) by utilizing persistent, aggressive caching for Rust, C++ (vcpkg), and Flutter toolchains.

---

## Expected Performance Comparison

GitHub-hosted runners on the free tier provide standardized virtual machines (typically 2-core CPU, 7GB RAM). While they are convenient, they spin up a completely clean environment for every single build. This means RustDesk must re-download and re-compile massive dependency trees (vcpkg, Rust crates, Flutter packages) from scratch every time.

By moving to **Self-Hosted Proxmox Runners** with the *exact same hardware specifications* (e.g., 2 vCPU, 8GB RAM), we eliminate the dependency fetching and full-compilation phases because everything is aggressively cached locally on the NVMe disk.

| Target Platform | GitHub Hosted (Free Tier, No Cache) | Self-Hosted Proxmox (Same Specs, Cached) | Primary Time Saver |
| :--- | :--- | :--- | :--- |
| **Android (.apk)** | ~30 Minutes | **~3-5 Minutes** | `sccache` incremental compilation & `~/.pub-cache` persistence |
| **Windows (.exe / .msi)** | ~45 Minutes | **~4-6 Minutes** | vcpkg binary caching & `sccache` avoiding MSVC recompilation |
| **Linux (.deb / AppImage)** | ~25 Minutes | **~2-4 Minutes** | Direct Docker access (no nested virt) & Rust dependency caching |

*Note: The remaining 3-5 minutes on self-hosted runners is spent purely on incremental Rust compilation of your specific `custom.txt` payload injections, linking the final binaries, and packing the installers.*

---

## 1. Infrastructure Overview (Proxmox)

To build for all major platforms natively and efficiently, we recommend provisioning the following VMs/LXCs on your Proxmox server:

### A. Linux Build Node (Ubuntu 22.04 Unprivileged LXC)
*   **Purpose**: Builds Linux `.deb` / `.AppImage`, Android `.apk`, and potentially Web.
*   **Specs**: 4-8 vCPUs, 8GB-16GB RAM, 50GB NVMe Storage.
*   **Why LXC**: Near-zero overhead and extremely fast IOPS compared to a full VM. We will enable nesting/FUSE for Docker support so the GitHub Actions runner can execute containerized steps natively.

### B. Windows Build Node (Windows 11 VM)
*   **Purpose**: Builds Windows `.exe` and `.msi` (RustDesk requires MSVC, vcpkg, and Windows SDK).
*   **Specs**: 4-8 vCPUs, 8GB-16GB RAM, 80GB NVMe Storage.
*   **Why Windows 11**: Easier to manage standard desktop development tools and perfectly matches the end-user RustDesk desktop environment. Must be a full VM (QEMU).

---

## 2. Aggressive Caching Strategy

The primary bottleneck in GitHub-hosted runners is re-downloading and re-compiling the massive dependency tree. We will use **Local Virtual NVMe Disks** for caching to guarantee maximum IOPS during the intensive C++/Rust compilation phases. We can implement the following:

### Rust / Cargo Caching
*   **`sccache`**: Install `sccache` globally on the runners and set `RUSTC_WRAPPER=sccache`. This caches the intermediate compilation objects across different builds.
*   **Cargo Registry**: The `~/.cargo/registry` and `~/.cargo/git` directories will persist naturally on the runner, eliminating the 2-3 minute download phase.

### C++ / vcpkg Caching
*   RustDesk relies heavily on `vcpkg` for dependencies like `libvpx`, `opus`, etc. 
*   **Binary Caching**: Configure `VCPKG_DEFAULT_BINARY_CACHE` to a local persistent directory on the Proxmox runner. This prevents building C++ libraries from source on every run.

### Flutter / Dart Caching
*   The `~/.pub-cache` directory will persist, instantly resolving Flutter UI dependencies.

---

## 3. Workflow Modifications

We will need to modify the GitHub Actions YAML files (e.g., `generator-windows.yml`, `generator-linux.yml`) in the `rdgen` repository to target our custom runners.

**Current (GitHub Hosted):**
```yaml
jobs:
  build:
    runs-on: windows-latest
```

**Proposed (Self-Hosted):**
```yaml
jobs:
  build:
    runs-on: [self-hosted, Windows, x64, betterdesk-custom]
```

*Note: We can use matrix strategies or specific tags to ensure Linux builds go to the LXC container and Windows builds go to the Windows VM.*

---

## 4. Setup Procedure

### Step 1: Proxmox Provisioning
1. Spin up the Ubuntu LXC and Windows VM.
2. Install prerequisite build tools:
   * **Linux LXC**: Install `docker.io` and ensure the LXC is configured with **nesting=1** in Proxmox. *Note: Docker is absolutely required because the RustDesk GitHub Action (`run-on-arch-action`) mounts your workspace into a Docker container to compile the Linux and Android binaries.*
   * **Windows VM**: Run the automated `setup-windows-runner.ps1` script (located in this directory) as Administrator to automatically install Visual Studio Build Tools (C++), Git, CMake, Python3, and Rust via `winget`.

### Step 2: Register GitHub Runners
1. Navigate to your `rdgen` repository on GitHub -> **Settings** -> **Actions** -> **Runners**.
2. Click **New self-hosted runner**.
3. Run the provided registration scripts on your Linux LXC and Windows VM.
4. Install the runner as a background service:
   * Linux: `sudo ./svc.sh install && sudo ./svc.sh start`
   * Windows: Install as a Windows Service during configuration.

### Step 3: Implement Automated Cleanup
Because persistent runners cache heavily, disk space can bloat over thousands of builds. We will write a simple weekly cron job on the runners to clear caches older than 30 days:
* `cargo cache -a`
* `sccache --prune`

---

## 5. Security Considerations

*   **Dedicated Scope**: The runners will be registered **exclusively** to the `rdgen` repository. This prevents other repositories in your organization from running malicious workflows on your Proxmox machines and stealing the decrypted BetterDesk custom payload secrets.
*   **Secret Handling**: The `secrets.json` payload will be decrypted in memory/temp disk on your private Proxmox node, which is significantly more secure than public GitHub-hosted machines.

---

## 6. BetterDesk Interface Compatibility

**100% Compatible with Zero Code Changes.**

The "Build in Progress" page in the BetterDesk panel relies exclusively on the standard GitHub Actions API (`/repos/{owner}/{repo}/actions/runs/{run_id}`) to poll for live step status, logs, and completion states. 

The GitHub API is entirely agnostic to the *type* of runner executing the job. Because your self-hosted Proxmox nodes will process the exact same YAML workflow files and report their progress back to GitHub, the BetterDesk panel will continue to render the live progress bars, log outputs, and download buttons exactly as it does now. 

The only difference you and your operators will notice is that the steps will complete roughly 10x faster.

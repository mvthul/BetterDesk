const crypto = require('crypto');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const sodium = require('libsodium-wrappers');
const { upsertEnvKey } = require('../lib/envMerge');
const config = require('../config/config');

class GithubProvisionService {
    
    constructor() {
        this.apiBase = 'https://api.github.com';
    }

    async provision(pat, repoName, baseUrl = '') {
        if (!pat || !repoName) throw new Error('PAT and repository name are required.');
        
        const headers = {
            'Authorization': `Bearer ${pat}`,
            'Accept': 'application/vnd.github.v3+json',
            'X-GitHub-Api-Version': '2022-11-28'
        };

        // 1. Get User info
        let user;
        try {
            const userRes = await axios.get(`${this.apiBase}/user`, { headers });
            user = userRes.data;
        } catch (err) {
            throw new Error(`Failed to authenticate with GitHub: ${err.response?.data?.message || err.message}`);
        }

        // 2. Create Repository
        let repoData;
        try {
            const repoRes = await axios.post(`${this.apiBase}/user/repos`, {
                name: repoName,
                private: true,
                auto_init: false
            }, { headers });
            repoData = repoRes.data;
        } catch (err) {
            if (err.response?.status === 422) {
                // Repo might already exist, let's try to get it
                try {
                    const existingRes = await axios.get(`${this.apiBase}/repos/${user.login}/${repoName}`, { headers });
                    repoData = existingRes.data;
                } catch (e) {
                    throw new Error(`Repository creation failed and could not fetch existing repo: ${err.response?.data?.message}`);
                }
            } else {
                throw new Error(`Failed to create repository: ${err.response?.data?.message || err.message}`);
            }
        }

        const owner = repoData.owner.login;
        const repo = repoData.name;
        const cloneUrl = `https://${user.login}:${pat}@github.com/${owner}/${repo}.git`;
        const tmpDir = path.join('/tmp', `bd-provision-${Date.now()}`);

        // 3. Generate Encryption Keys
        let rsaPublicKeyBase64, rsaPrivateKeyPem, ed25519PrivateKeyPem;
        try {
            const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
                modulusLength: 3072,
                publicKeyEncoding: { type: 'spki', format: 'pem' },
                privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
            });
            rsaPublicKeyBase64 = Buffer.from(publicKey).toString('base64');
            rsaPrivateKeyPem = privateKey;

            const { privateKey: edPrivateKey } = crypto.generateKeyPairSync('ed25519', {
                publicKeyEncoding: { type: 'spki', format: 'pem' },
                privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
            });
            ed25519PrivateKeyPem = edPrivateKey;
        } catch (err) {
            throw new Error(`Failed to generate encryption keys: ${err.message}`);
        }

        // 4. Clone and Install Adapter
        let workflowCommit;
        try {
            console.log(`[Auto-Provision] Cloning repository ${cloneUrl.replace(pat, '***')} into ${tmpDir}...`);
            await execAsync(`git clone ${cloneUrl} ${tmpDir}`);
            
            // If repo is totally empty, fetch the RustDesk source code
            const isBare = fs.readdirSync(tmpDir).length <= 1; // only .git
            if (isBare) {
                console.log(`[Auto-Provision] Repository is bare. Fetching rustdesk/rustdesk master branch...`);
                await execAsync(`git remote add rustdesk https://github.com/rustdesk/rustdesk.git`, { cwd: tmpDir });
                await execAsync(`git fetch rustdesk master`, { cwd: tmpDir });
                await execAsync(`git checkout -b main FETCH_HEAD`, { cwd: tmpDir });
            }

            console.log(`[Auto-Provision] Initializing submodules...`);
            // Initialize submodules so the adapter script sees them as populated
            await execAsync(`git submodule update --init`, { cwd: tmpDir });

            let installScript = path.resolve(__dirname, '../scripts/real-client-build-repository/install-central-adapter.mjs');
            if (!fs.existsSync(installScript)) {
                // fallback if someone runs from a different structure
                installScript = '/opt/BetterDeskConsole/scripts/real-client-build-repository/install-central-adapter.mjs';
            }

            console.log(`[Auto-Provision] Running central adapter installer script...`);
            
            // Fix: pass empty string if process.env.REAL_CLIENT_PUBLIC_BASE_URL is undefined
            const payloadOrigin = baseUrl || process.env.REAL_CLIENT_PUBLIC_BASE_URL || '';
            
            await execAsync(`node ${installScript} ${tmpDir} --install --init-vendors --force`, {
                env: { ...process.env, REAL_CLIENT_PUBLIC_BASE_URL: payloadOrigin }
            });
            
            console.log(`[Auto-Provision] Committing changes...`);
            await execAsync(`git add -A`, { cwd: tmpDir });
            
            const hasChanges = (await execAsync(`git status --porcelain`, { cwd: tmpDir })).stdout.trim().length > 0;
            if (hasChanges) {
                await execAsync(`git commit -m "Install BetterDesk RustDesk client adapter"`, { cwd: tmpDir });
            }
            
            workflowCommit = (await execAsync(`git rev-parse HEAD`, { cwd: tmpDir })).stdout.trim();
            
            console.log(`[Auto-Provision] Pushing to origin main...`);
            await execAsync(`git push -u origin HEAD:main`, { cwd: tmpDir });
            console.log(`[Auto-Provision] Push completed.`);
        } catch (err) {
            throw new Error(`Failed to initialize adapter repository: ${err.message}`);
        } finally {
            // Cleanup
            await execAsync(`rm -rf ${tmpDir}`).catch(() => {});
        }

        // 5. Upload Secrets to GitHub Actions
        try {
            await sodium.ready;
            
            const pkeyRes = await axios.get(`${this.apiBase}/repos/${owner}/${repo}/actions/secrets/public-key`, { headers });
            const actionsPubKey = pkeyRes.data;

            const encryptSecret = (secretValue) => {
                const binkey = sodium.from_base64(actionsPubKey.key, sodium.base64_variants.ORIGINAL);
                const binsec = sodium.from_string(secretValue);
                const encBytes = sodium.crypto_box_seal(binsec, binkey);
                return sodium.to_base64(encBytes, sodium.base64_variants.ORIGINAL);
            };

            const uploadSecret = async (name, value) => {
                const encrypted_value = encryptSecret(value);
                await axios.put(`${this.apiBase}/repos/${owner}/${repo}/actions/secrets/${name}`, {
                    encrypted_value,
                    key_id: actionsPubKey.key_id
                }, { headers });
            };

            await uploadSecret('REAL_CLIENT_PAYLOAD_PRIVATE_KEY', rsaPrivateKeyPem);
            await uploadSecret('REAL_CLIENT_CUSTOM_CONFIG_SIGNING_KEY', ed25519PrivateKeyPem);
            
        } catch (err) {
            throw new Error(`Failed to configure GitHub Actions secrets: ${err.response?.data?.message || err.message}`);
        }

        // 6. Upload Variables to GitHub Actions
        const payloadOrigin = baseUrl || process.env.REAL_CLIENT_PUBLIC_BASE_URL || '';
        try {
            const createOrUpdateVar = async (name, value) => {
                try {
                    await axios.post(`${this.apiBase}/repos/${owner}/${repo}/actions/variables`, {
                        name, value: String(value)
                    }, { headers });
                } catch (e) {
                    if (e.response?.status === 409) {
                        await axios.patch(`${this.apiBase}/repos/${owner}/${repo}/actions/variables/${name}`, {
                            name, value: String(value)
                        }, { headers });
                    } else {
                        throw e;
                    }
                }
            };

            await createOrUpdateVar('BETTERDESK_PAYLOAD_ORIGIN', payloadOrigin);
            await createOrUpdateVar('REAL_CLIENT_RUNNER_WINDOWS_X64', process.env.REAL_CLIENT_RUNNER_WINDOWS_X64 || 'windows-latest');
        } catch (err) {
            throw new Error(`Failed to configure GitHub Actions variables: ${err.response?.data?.message || err.message}`);
        }

        // 7. Update Local Environment
        try {
            const envFile = process.env.CONSOLE_ENV_FILE || path.resolve(__dirname, '../.env');
            
            if (!fs.existsSync(envFile)) {
                fs.writeFileSync(envFile, '# Auto-provisioned by BetterDesk\n');
            }
            
            let envContent = fs.readFileSync(envFile, 'utf8');
            
            envContent = upsertEnvKey(envContent, 'REAL_CLIENT_GITHUB_TOKEN', pat);
            envContent = upsertEnvKey(envContent, 'REAL_CLIENT_GITHUB_OWNER', owner);
            envContent = upsertEnvKey(envContent, 'REAL_CLIENT_GITHUB_REPO', repo);
            envContent = upsertEnvKey(envContent, 'REAL_CLIENT_GITHUB_REF', 'main');
            envContent = upsertEnvKey(envContent, 'REAL_CLIENT_GITHUB_API_URL', 'https://api.github.com');
            envContent = upsertEnvKey(envContent, 'REAL_CLIENT_PAYLOAD_PUBLIC_KEY', rsaPublicKeyBase64);
            envContent = upsertEnvKey(envContent, 'REAL_CLIENT_GITHUB_WORKFLOW_COMMIT', workflowCommit);
            envContent = upsertEnvKey(envContent, 'REAL_CLIENT_GITHUB_WORKFLOWS', '{"linux":"betterdesk-linux.yml","windows":"betterdesk-windows.yml","android":"betterdesk-android.yml","macos":"betterdesk-macos.yml"}');
            envContent = upsertEnvKey(envContent, 'REAL_CLIENT_GITHUB_MATRIX', '{"windows-x64-exe":["1.4.9"],"windows-x64-msi":["1.4.9"],"linux-x64-deb":["1.4.9"],"linux-x64-appimage":["1.4.9"],"linux-x64-flatpak":["1.4.9"],"linux-arm64-deb":["1.4.9"],"linux-arm64-appimage":["1.4.9"],"linux-arm64-flatpak":["1.4.9"],"android-arm64-apk":["1.4.9"],"android-armv7-apk":["1.4.9"],"android-x64-apk":["1.4.9"],"macos-x64-dmg":["1.4.9"],"macos-arm64-dmg":["1.4.9"]}');
            envContent = upsertEnvKey(envContent, 'REAL_CLIENT_GITHUB_REVISIONS', '{"1.4.9":"6c578292e8ebbbec708b76986ba8c4bc7c509747"}');
            envContent = upsertEnvKey(envContent, 'REAL_CLIENT_PUBLIC_BASE_URL', payloadOrigin);
            
            fs.writeFileSync(envFile, envContent);
            process.env.REAL_CLIENT_GITHUB_TOKEN = pat;
            process.env.REAL_CLIENT_GITHUB_OWNER = owner;
            process.env.REAL_CLIENT_GITHUB_REPO = repo;
            process.env.REAL_CLIENT_GITHUB_REF = 'main';
            process.env.REAL_CLIENT_PAYLOAD_PUBLIC_KEY = rsaPublicKeyBase64;
            process.env.REAL_CLIENT_GITHUB_WORKFLOW_COMMIT = workflowCommit;
            process.env.REAL_CLIENT_PUBLIC_BASE_URL = payloadOrigin;
            
        } catch (err) {
            throw new Error(`Failed to update local .env file: ${err.message}`);
        }

        return { success: true, owner, repo, workflowCommit };
    }

    async update() {
        const pat = process.env.REAL_CLIENT_GITHUB_TOKEN;
        const owner = process.env.REAL_CLIENT_GITHUB_OWNER;
        const repo = process.env.REAL_CLIENT_GITHUB_REPO;

        if (!pat || !owner || !repo) {
            throw new Error('GitHub repository is not configured or token is missing.');
        }

        const cloneUrl = `https://${owner}:${pat}@github.com/${owner}/${repo}.git`;
        const tmpDir = path.join('/tmp', `bd-update-${Date.now()}`);

        let workflowCommit;
        try {
            console.log(`[Auto-Update] Cloning repository into ${tmpDir}...`);
            await execAsync(`git clone ${cloneUrl} ${tmpDir}`);

            console.log(`[Auto-Update] Initializing submodules...`);
            await execAsync(`git submodule update --init`, { cwd: tmpDir });

            let installScript = path.resolve(__dirname, '../scripts/real-client-build-repository/install-central-adapter.mjs');
            if (!fs.existsSync(installScript)) {
                installScript = '/opt/BetterDeskConsole/scripts/real-client-build-repository/install-central-adapter.mjs';
            }

            console.log(`[Auto-Update] Running central adapter installer script...`);
            const payloadOrigin = process.env.REAL_CLIENT_PUBLIC_BASE_URL || process.env.PANEL_PUBLIC_URL || '';

            await execAsync(`node ${installScript} ${tmpDir} --install --init-vendors --force`, {
                env: { ...process.env, REAL_CLIENT_PUBLIC_BASE_URL: payloadOrigin }
            });

            console.log(`[Auto-Update] Checking for repository changes...`);
            await execAsync(`git add -A`, { cwd: tmpDir });

            const hasChanges = (await execAsync(`git status --porcelain`, { cwd: tmpDir })).stdout.trim().length > 0;
            if (hasChanges) {
                console.log(`[Auto-Update] Committing updated adapter files...`);
                await execAsync(`git commit -m "Update BetterDesk RustDesk client adapter"`, { cwd: tmpDir });
                console.log(`[Auto-Update] Pushing to origin main...`);
                await execAsync(`git push origin HEAD:main`, { cwd: tmpDir });
                console.log(`[Auto-Update] Push completed.`);
            } else {
                console.log(`[Auto-Update] No changes detected.`);
            }

            workflowCommit = (await execAsync(`git rev-parse HEAD`, { cwd: tmpDir })).stdout.trim();
        } catch (err) {
            throw new Error(`Failed to update build repository: ${err.message}`);
        } finally {
            await execAsync(`rm -rf ${tmpDir}`).catch(() => {});
        }

        // Update local environment
        try {
            const envFile = process.env.CONSOLE_ENV_FILE || path.resolve(__dirname, '../.env');
            if (fs.existsSync(envFile)) {
                let envContent = fs.readFileSync(envFile, 'utf8');
                envContent = upsertEnvKey(envContent, 'REAL_CLIENT_GITHUB_WORKFLOW_COMMIT', workflowCommit);
                fs.writeFileSync(envFile, envContent);
            }
            process.env.REAL_CLIENT_GITHUB_WORKFLOW_COMMIT = workflowCommit;
        } catch (err) {
            throw new Error(`Failed to update local .env file during update: ${err.message}`);
        }

        return { success: true, owner, repo, workflowCommit };
    }
}

module.exports = new GithubProvisionService();

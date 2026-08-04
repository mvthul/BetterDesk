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

    async provision(pat, repoName) {
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
                description: 'BetterDesk RustDesk Client Build Repository'
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
        const tmpDir = path.join(require('os').tmpdir(), `bd-provision-${Date.now()}`);

        // 3. Initialize repository with central adapter
        try {
            await execAsync(`git clone ${cloneUrl} ${tmpDir}`);
            
            // If repo is totally empty, fetch the RustDesk source code
            const isBare = fs.readdirSync(tmpDir).length <= 1; // only .git
            if (isBare) {
                await execAsync(`git remote add rustdesk https://github.com/rustdesk/rustdesk.git`, { cwd: tmpDir });
                await execAsync(`git fetch rustdesk master`, { cwd: tmpDir });
                await execAsync(`git checkout -b main FETCH_HEAD`, { cwd: tmpDir });
            }

            let installScript = path.resolve(__dirname, '../scripts/real-client-build-repository/install-central-adapter.mjs');
            if (!fs.existsSync(installScript)) {
                installScript = path.resolve(__dirname, '../../docs/real-client-build-repository/install-central-adapter.mjs');
            }
            if (!fs.existsSync(installScript)) {
                throw new Error(`Adapter installer script not found at ${installScript}`);
            }
            await execAsync(`node ${installScript} ${tmpDir} --install --init-vendors`);
            
            await execAsync(`git config user.name "BetterDesk Auto-Provision"`, { cwd: tmpDir });
            await execAsync(`git config user.email "bot@betterdesk.local"`, { cwd: tmpDir });
            await execAsync(`git add .betterdesk .github .gitmodules`, { cwd: tmpDir });
            
            // It might throw if there's nothing to commit (already installed)
            try {
                await execAsync(`git commit -m "Install BetterDesk RustDesk client adapter"`, { cwd: tmpDir });
            } catch (e) { /* ignore if already installed */ }
            
            await execAsync(`node ${installScript} ${tmpDir} --check`);
            await execAsync(`git push -u origin HEAD:main`, { cwd: tmpDir });
        } catch (err) {
            throw new Error(`Failed to initialize adapter repository: ${err.message}`);
        }

        // Get Workflow Commit
        let workflowCommit;
        try {
            const { stdout } = await execAsync(`git rev-parse HEAD`, { cwd: tmpDir });
            workflowCommit = stdout.trim();
        } catch (err) {
            throw new Error(`Failed to get workflow commit hash: ${err.message}`);
        } finally {
            // Cleanup
            await execAsync(`rm -rf ${tmpDir}`).catch(() => {});
        }

        // 4. Generate Keys
        const rsaKeyPair = crypto.generateKeyPairSync('rsa', {
            modulusLength: 3072,
            publicKeyEncoding: { type: 'spki', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
        });
        
        const edKeyPair = crypto.generateKeyPairSync('ed25519', {
            publicKeyEncoding: { type: 'spki', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
        });

        const rsaPrivateKey = rsaKeyPair.privateKey;
        const rsaPublicKeyBase64 = Buffer.from(rsaKeyPair.publicKey).toString('base64');
        const edPrivateKey = edKeyPair.privateKey;

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

            await uploadSecret('REAL_CLIENT_PAYLOAD_PRIVATE_KEY', rsaPrivateKey);
            await uploadSecret('REAL_CLIENT_CUSTOM_CONFIG_SIGNING_KEY', edPrivateKey);
            
        } catch (err) {
            throw new Error(`Failed to configure GitHub Actions secrets: ${err.response?.data?.message || err.message}`);
        }

        // 6. Upload Variables
        try {
            // Fetch origin from request or config
            const payloadOrigin = config.serverUrl || `https://${process.env.VIRTUAL_HOST || 'localhost'}`;
            
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
        } catch (err) {
            throw new Error(`Failed to configure GitHub Actions variables: ${err.response?.data?.message || err.message}`);
        }

        // 7. Update Local Environment
        try {
            const envFile = path.resolve(__dirname, '../../.env'); // Target the root .env
            
            // We append or overwrite keys. `upsertEnvKey` creates the file if it doesn't exist? Wait, we should make sure the file exists.
            if (!fs.existsSync(envFile)) {
                fs.writeFileSync(envFile, '# Auto-provisioned by BetterDesk\n');
            }
            
            await upsertEnvKey(envFile, 'REAL_CLIENT_GITHUB_TOKEN', pat);
            await upsertEnvKey(envFile, 'REAL_CLIENT_PAYLOAD_PUBLIC_KEY', rsaPublicKeyBase64);
            await upsertEnvKey(envFile, 'REAL_CLIENT_GITHUB_WORKFLOW_COMMIT', workflowCommit);
            await upsertEnvKey(envFile, 'REAL_CLIENT_GITHUB_WORKFLOWS', '{"linux":"real-client-build.yml","windows":"real-client-build.yml"}');
            await upsertEnvKey(envFile, 'REAL_CLIENT_GITHUB_MATRIX', '{"linux-x64-deb":["1.4.9"], "windows-x64-exe":["1.4.9"]}');
            await upsertEnvKey(envFile, 'REAL_CLIENT_GITHUB_REVISIONS', '{"1.4.9":"6c578292e8ebbbec708b76986ba8c4bc7c509747"}');
            
        } catch (err) {
            throw new Error(`Failed to update local .env file: ${err.message}`);
        }

        return { success: true, owner, repo, workflowCommit };
    }
}

module.exports = new GithubProvisionService();

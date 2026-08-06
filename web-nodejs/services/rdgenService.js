const archiver = require('archiver');
archiver.registerFormat('zip-encrypted', require('archiver-zip-encrypted'));
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const tweetsodium = require('tweetsodium');
const dbAdapter = require('./dbAdapter').getAdapter();
const axios = require('axios');
const { upsertEnvKey } = require('../lib/envMerge');
const ENV_PATH = path.join(__dirname, '..', '.env');

function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true, mode: 0o777 });
    }
    try { fs.chmodSync(dirPath, 0o777); } catch (_) {}
}

const TEMP_DIR = path.join(os.tmpdir(), 'betterdesk-rdgen');
ensureDir(TEMP_DIR);

const UPLOADS_DIR = path.join(os.tmpdir(), 'betterdesk-rdgen-uploads');
ensureDir(UPLOADS_DIR);

async function generateCustomClient(params, myuuid, reqHost) {
    const {
        platform, server, key, apiServer,
        iconlink_url, iconlink_uuid, iconlink_file,
        logolink_url, logolink_uuid, logolink_file,
        privacylink_url, privacylink_uuid, privacylink_file,
        appname, urlLink, downloadLink, delayFix,
        xOffline, removeNewVersionNotif, compname, androidappid, filename,
        selfhosted,
        direction, installation, settings, permPass, theme, themeDorO,
        denyLan, enableDirectIP, autoClose, permissionsDorO, permissionsType,
        enableKeyboard, enableClipboard, enableFileTransfer, enableAudio, enableTCP,
        enableRemoteRestart, enableRecording, enableBlockingInput, enableRemoteModi,
        hidecm, passApproveMode, removeWallpaper, enablePrinter, enableCamera, enableTerminal,
        defaultManual, overrideManual
    } = params;

    const ghUser = process.env.GHUSER;
    const repoName = process.env.REPONAME || 'rdgen';
    const ghBearer = process.env.GHBEARER;
    const ghBranch = process.env.GHBRANCH || 'master';
    const zipPassword = process.env.ZIP_PASSWORD;
    const genUrl = process.env.GENURL || `https://${reqHost}`; // Fallback if GENURL is empty

    if (!ghUser || !ghBearer || !zipPassword) {
        throw new Error('GitHub Integration is not fully configured (GHUSER, GHBEARER, ZIP_PASSWORD).');
    }

    // Build custom JSON
    const decodedCustom = {
        'override-settings': {},
        'default-settings': {}
    };
    if (direction && direction !== 'Both') decodedCustom['conn-type'] = direction;
    if (installation === 'installationN') decodedCustom['disable-installation'] = 'Y';
    if (settings === 'settingsN') decodedCustom['disable-settings'] = 'Y';
    if (appname && appname.toUpperCase() !== 'RUSTDESK') decodedCustom['app-name'] = appname;
    if (permPass) decodedCustom['password'] = permPass;

    if (theme && theme !== 'system') {
        if (themeDorO === 'default') {
            if (platform === 'windows-x86') decodedCustom['default-settings']['allow-darktheme'] = theme === 'dark' ? 'Y' : 'N';
            else decodedCustom['default-settings']['theme'] = theme;
        } else if (themeDorO === 'override') {
            if (platform === 'windows-x86') decodedCustom['override-settings']['allow-darktheme'] = theme === 'dark' ? 'Y' : 'N';
            else decodedCustom['override-settings']['theme'] = theme;
        }
    }

    decodedCustom['enable-lan-discovery'] = denyLan === 'true' || denyLan === true ? 'N' : 'Y';
    decodedCustom['allow-auto-disconnect'] = autoClose === 'true' || autoClose === true ? 'Y' : 'N';

    const pType = permissionsDorO === 'default' ? 'default-settings' : 'override-settings';
    decodedCustom[pType]['access-mode'] = permissionsType || 'full';
    decodedCustom[pType]['enable-keyboard'] = enableKeyboard === 'true' || enableKeyboard === true ? 'Y' : 'N';
    decodedCustom[pType]['enable-clipboard'] = enableClipboard === 'true' || enableClipboard === true ? 'Y' : 'N';
    decodedCustom[pType]['enable-file-transfer'] = enableFileTransfer === 'true' || enableFileTransfer === true ? 'Y' : 'N';
    decodedCustom[pType]['enable-audio'] = enableAudio === 'true' || enableAudio === true ? 'Y' : 'N';
    decodedCustom[pType]['enable-tunnel'] = enableTCP === 'true' || enableTCP === true ? 'Y' : 'N';
    decodedCustom[pType]['enable-remote-restart'] = enableRemoteRestart === 'true' || enableRemoteRestart === true ? 'Y' : 'N';
    decodedCustom[pType]['enable-record-session'] = enableRecording === 'true' || enableRecording === true ? 'Y' : 'N';
    decodedCustom[pType]['enable-block-input'] = enableBlockingInput === 'true' || enableBlockingInput === true ? 'Y' : 'N';
    decodedCustom[pType]['allow-remote-config-modification'] = enableRemoteModi === 'true' || enableRemoteModi === true ? 'Y' : 'N';
    decodedCustom[pType]['direct-server'] = enableDirectIP === 'true' || enableDirectIP === true ? 'Y' : 'N';
    decodedCustom[pType]['verification-method'] = hidecm === 'true' || hidecm === true ? 'use-permanent-password' : 'use-both-passwords';
    decodedCustom[pType]['approve-mode'] = passApproveMode || 'password';
    decodedCustom[pType]['allow-hide-cm'] = hidecm === 'true' || hidecm === true ? 'Y' : 'N';
    decodedCustom[pType]['allow-remove-wallpaper'] = removeWallpaper === 'true' || removeWallpaper === true ? 'Y' : 'N';
    decodedCustom[pType]['enable-remote-printer'] = enablePrinter === 'true' || enablePrinter === true ? 'Y' : 'N';
    decodedCustom[pType]['enable-camera'] = enableCamera === 'true' || enableCamera === true ? 'Y' : 'N';
    decodedCustom[pType]['enable-terminal'] = enableTerminal === 'true' || enableTerminal === true ? 'Y' : 'N';

    if (defaultManual) {
        defaultManual.split('\n').forEach(line => {
            const idx = line.indexOf('=');
            if (idx > -1) {
                decodedCustom['default-settings'][line.substring(0, idx).trim()] = line.substring(idx + 1).trim();
            }
        });
    }
    if (overrideManual) {
        overrideManual.split('\n').forEach(line => {
            const idx = line.indexOf('=');
            if (idx > -1) {
                decodedCustom['override-settings'][line.substring(0, idx).trim()] = line.substring(idx + 1).trim();
            }
        });
    }

    const customBase64 = Buffer.from(JSON.stringify(decodedCustom)).toString('base64');

    const inputs_raw = {
        server: server || '',
        key: key || '',
        apiServer: apiServer || '',
        custom: customBase64,
        uuid: myuuid,
        iconlink_url: iconlink_url || 'false',
        iconlink_uuid: iconlink_uuid || '',
        iconlink_file: iconlink_file || '',
        logolink_url: logolink_url || 'false',
        logolink_uuid: logolink_uuid || '',
        logolink_file: logolink_file || '',
        privacylink_url: privacylink_url || 'false',
        privacylink_uuid: privacylink_uuid || '',
        privacylink_file: privacylink_file || '',
        appname: appname || 'RustDesk',
        genurl: genUrl,
        urlLink: urlLink || 'https://rustdesk.com',
        downloadLink: downloadLink || 'https://rustdesk.com/download',
        delayFix: delayFix === 'true' || delayFix === true ? 'true' : 'false',
        rdgen: 'true',
        xOffline: xOffline === 'true' || xOffline === true ? 'true' : 'false',
        removeNewVersionNotif: removeNewVersionNotif === 'true' || removeNewVersionNotif === true ? 'true' : 'false',
        compname: compname || 'Purslane Ltd',
        androidappid: androidappid || 'com.carriez.rustdesk',
        filename: filename || 'rustdesk'
    };

    const zipFilename = `secrets_${myuuid}.zip`;
    const zipPath = path.join(TEMP_DIR, zipFilename);
    const jsonPath = path.join(TEMP_DIR, `data_${myuuid}.json`);

    fs.writeFileSync(jsonPath, JSON.stringify(inputs_raw, null, 2));

    await new Promise((resolve, reject) => {
        const output = fs.createWriteStream(zipPath);
        const archive = archiver('zip-encrypted', {
            zlib: { level: 9 },
            encryptionMethod: 'aes256',
            password: zipPassword
        });

        output.on('close', resolve);
        archive.on('error', reject);
        archive.pipe(output);
        archive.file(jsonPath, { name: 'secrets.json' });
        archive.finalize();
    });

    if (fs.existsSync(jsonPath)) {
        fs.unlinkSync(jsonPath);
    }

    const zip_url = JSON.stringify({
        url: genUrl,
        file: zipFilename
    });

    let workflow = 'generator-windows.yml';
    if (platform === 'windows') workflow = selfhosted ? 'sh-generator-windows.yml' : 'generator-windows.yml';
    else if (platform === 'windows-x86') workflow = 'generator-windows-x86.yml';
    else if (platform === 'linux') workflow = 'generator-linux.yml';
    else if (platform === 'android') workflow = 'generator-android.yml';
    else if (platform === 'macos') workflow = 'generator-macos.yml';

    const url = `https://api.github.com/repos/${ghUser}/${repoName}/actions/workflows/${workflow}/dispatches`;

    const data = {
        ref: ghBranch,
        inputs: {
            version: params.version || 'master',
            zip_url: zip_url
        }
    };

    await dbAdapter.createRdgenRun({
        uuid: myuuid,
        platform,
        filename: inputs_raw.filename,
        appname: inputs_raw.appname,
        status: 'Starting generator...please wait'
    });

    try {
        const response = await axios.post(url, data, {
            headers: {
                'Accept': 'application/vnd.github+json',
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ghBearer}`,
                'X-GitHub-Api-Version': '2022-11-28'
            }
        });

        if (response.status === 204 || response.status === 200) {
            return {
                success: true,
                uuid: myuuid,
                filename: inputs_raw.filename,
                platform: platform,
                log_url: ''
            };
        } else {
            throw new Error('GitHub rejected the start request');
        }
    } catch (e) {
        await dbAdapter.updateRdgenRun(myuuid, { status: 'failed' });
        throw new Error(`Connection error: ${e.message}`);
    }
}

async function getRunStatus(uuidVal) {
    let run = await dbAdapter.getRdgenRun(uuidVal);
    if (!run) return { found: false };

    const ghUser = process.env.GHUSER;
    const repoName = process.env.REPONAME || 'rdgen';
    const ghBearer = process.env.GHBEARER;

    if (run.status !== 'success' && run.status !== 'failure' && run.status !== 'cancelled' && run.status !== 'timed_out' && run.status !== 'skipped' && run.github_run_id) {
        try {
            const api_url = `https://api.github.com/repos/${ghUser}/${repoName}/actions/runs/${run.github_run_id}`;
            const gh_response = await axios.get(api_url, {
                headers: {
                    'Authorization': `Bearer ${ghBearer}`,
                    'Accept': 'application/vnd.github+json'
                }
            });
            
            if (gh_response.status === 200) {
                const gh_data = gh_response.data;
                if (gh_data.status === 'completed') {
                    run = await dbAdapter.updateRdgenRun(uuidVal, { status: gh_data.conclusion });
                }
            }
        } catch (e) {
            console.error(`Error checking GitHub: ${e.message}`);
        }
    }

    return {
        found: true,
        status: run.status,
        github_log_url: run.log_url || (run.github_run_id ? `https://github.com/${ghUser}/${repoName}/actions/runs/${run.github_run_id}` : null),
        gh_run: run
    };
}

function updateEnvKey(key, value) {
    if (fs.existsSync(ENV_PATH)) {
        let content = fs.readFileSync(ENV_PATH, 'utf8');
        content = upsertEnvKey(content, key, value || '');
        fs.writeFileSync(ENV_PATH, content, { mode: 0o600 });
    }
    process.env[key] = value || '';
}

async function provisionGithubRepo(options = {}) {
    const bearerToken = options.pat || process.env.GHBEARER;
    const repoName = options.repoName || process.env.REPONAME || 'rdgen';
    const genUrl = options.genUrl || process.env.GENURL || '';
    const branch = options.branch || process.env.GHBRANCH || 'master';

    if (!bearerToken) {
        throw new Error('No GitHub Personal Access Token (PAT) provided or configured in environment.');
    }

    const headers = {
        'Authorization': `Bearer ${bearerToken}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'BetterDesk-Console',
        'X-GitHub-Api-Version': '2022-11-28'
    };

    // 1. Get authenticated user
    const userRes = await axios.get('https://api.github.com/user', { headers });
    const ghUser = userRes.data.login;

    // 2. Check if repository already exists under user's account
    let repoExists = false;
    try {
        await axios.get(`https://api.github.com/repos/${ghUser}/${repoName}`, { headers });
        repoExists = true;
    } catch (err) {
        if (err.response && err.response.status !== 404) {
            throw err;
        }
    }

    // 3. Fork or create repository if missing
    if (!repoExists) {
        let defaultForkExists = false;
        try {
            await axios.get(`https://api.github.com/repos/${ghUser}/rdgen`, { headers });
            defaultForkExists = true;
        } catch (e) {}

        if (defaultForkExists && repoName !== 'rdgen') {
            await axios.patch(`https://api.github.com/repos/${ghUser}/rdgen`, { name: repoName }, { headers });
            repoExists = true;
        } else if (!defaultForkExists) {
            try {
                await axios.post('https://api.github.com/repos/bryangerlach/rdgen/forks', {}, { headers });
            } catch (forkErr) {
                await axios.post('https://api.github.com/user/repos', {
                    name: repoName,
                    private: false,
                    auto_init: true
                }, { headers });
            }
            
            // Poll until repository is available on GitHub and rename if needed
            for (let i = 0; i < 15; i++) {
                try {
                    await axios.get(`https://api.github.com/repos/${ghUser}/${repoName}`, { headers });
                    repoExists = true;
                    break;
                } catch (e) {
                    try {
                        await axios.get(`https://api.github.com/repos/${ghUser}/rdgen`, { headers });
                        if (repoName !== 'rdgen') {
                            await axios.patch(`https://api.github.com/repos/${ghUser}/rdgen`, { name: repoName }, { headers });
                        }
                        repoExists = true;
                        break;
                    } catch (e2) {
                        await new Promise(r => setTimeout(r, 1000));
                    }
                }
            }
        }
    }

    // 4. Enable GitHub Actions permissions
    try {
        await axios.put(`https://api.github.com/repos/${ghUser}/${repoName}/actions/permissions`, {
            enabled: true,
            allowed_actions: 'all'
        }, { headers });
    } catch (e) {
        // Ignore if permissions endpoint returned 404
    }

    // 5. Generate secure random ZIP_PASSWORD if not set
    const zipPassword = process.env.ZIP_PASSWORD || crypto.randomBytes(32).toString('hex');

    // 6. Fetch Repo Public Key for Encrypting Secrets (retry up to 10 times until GitHub Actions initializes)
    let keyRes;
    for (let attempt = 0; attempt < 10; attempt++) {
        try {
            keyRes = await axios.get(`https://api.github.com/repos/${ghUser}/${repoName}/actions/secrets/public-key`, { headers });
            break;
        } catch (err) {
            if (attempt === 9) throw err;
            await new Promise(r => setTimeout(r, 1500));
        }
    }
    const { key: publicKey, key_id: keyId } = keyRes.data;

    // Helper to upload encrypted secret
    async function setRepoSecret(secretName, secretValue) {
        if (!secretValue) return;
        const messageBytes = Buffer.from(secretValue);
        const keyBytes = Buffer.from(publicKey, 'base64');
        const encryptedBytes = tweetsodium.seal(messageBytes, keyBytes);
        const encryptedBase64 = Buffer.from(encryptedBytes).toString('base64');

        await axios.put(`https://api.github.com/repos/${ghUser}/${repoName}/actions/secrets/${secretName}`, {
            encrypted_value: encryptedBase64,
            key_id: keyId
        }, { headers });
    }

    // 7. Set required repository secrets
    await setRepoSecret('GENURL', genUrl);
    await setRepoSecret('ZIP_PASSWORD', zipPassword);

    // 8. Persist environment settings to .env and process.env
    updateEnvKey('GHUSER', ghUser);
    updateEnvKey('GHBEARER', bearerToken);
    updateEnvKey('REPONAME', repoName);
    updateEnvKey('GHBRANCH', branch);
    updateEnvKey('ZIP_PASSWORD', zipPassword);
    if (genUrl) updateEnvKey('GENURL', genUrl);

    return {
        success: true,
        ghUser,
        repoName,
        branch,
        genUrl,
        zipPasswordConfigured: true
    };
}

module.exports = {
    generateCustomClient,
    getRunStatus,
    provisionGithubRepo,
    TEMP_DIR,
    UPLOADS_DIR
};

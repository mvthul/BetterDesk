const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const rdgenService = require('../services/rdgenService');
const clientConfigHost = require('../services/clientConfigHost');
const dbAdapter = require('../services/dbAdapter').getAdapter();
const { requireAuth } = require('../middleware/auth');
const { upsertEnvKey } = require('../lib/envMerge');
const ENV_PATH = path.join(__dirname, '..', '.env');

const upload = multer({ dest: rdgenService.UPLOADS_DIR });

// ── Public download portal ────────────────────────────────────────────────────
// GET /rdgen/:uuid — no auth required; UUID is the access token
router.get('/rdgen/:uuid', async (req, res) => {
    try {
        const uuid = req.params.uuid;
        if (!/^[0-9a-f-]{8,}$/i.test(uuid)) return res.status(404).send('Not found');
        const run = await dbAdapter.getRdgenRun(uuid);
        if (!run) return res.status(404).render('errors/404', { message: 'Build not found.' });
        res.render('rdgen-download', { rdgenRun: run });
    } catch (e) {
        res.status(500).send('Server error');
    }
});

// Helper to write env variables
function updateEnv(key, value) {
    if (fs.existsSync(ENV_PATH)) {
        let content = fs.readFileSync(ENV_PATH, 'utf8');
        content = upsertEnvKey(content, key, value || '');
        fs.writeFileSync(ENV_PATH, content, { mode: 0o600 });
    }
    process.env[key] = value || '';
}

// 1. Settings (GET/PUT)
router.get('/api/generator/rdgen/settings', requireAuth, (req, res) => {
    res.json({
        success: true,
        GHUSER: process.env.GHUSER || '',
        GHBEARER: process.env.GHBEARER ? '********' : '',
        REPONAME: process.env.REPONAME || 'rdgen',
        GHBRANCH: process.env.GHBRANCH || 'master',
        ZIP_PASSWORD: process.env.ZIP_PASSWORD ? '********' : '',
        GENURL: process.env.GENURL || ''
    });
});

router.put('/api/generator/rdgen/settings', requireAuth, (req, res) => {
    try {
        const { GHUSER, GHBEARER, REPONAME, GHBRANCH, ZIP_PASSWORD, GENURL } = req.body;
        if (GHUSER !== undefined) updateEnv('GHUSER', GHUSER);
        if (GHBEARER && GHBEARER !== '********') updateEnv('GHBEARER', GHBEARER);
        if (REPONAME !== undefined) updateEnv('REPONAME', REPONAME);
        if (GHBRANCH !== undefined) updateEnv('GHBRANCH', GHBRANCH);
        if (ZIP_PASSWORD && ZIP_PASSWORD !== '********') updateEnv('ZIP_PASSWORD', ZIP_PASSWORD);
        if (GENURL !== undefined) updateEnv('GENURL', GENURL);
        
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

router.post('/api/generator/rdgen/provision', requireAuth, express.json(), async (req, res) => {
    try {
        const { pat, repoName, genUrl } = req.body || {};
        const endpoints = clientConfigHost.resolveRustDeskEndpoints(req);
        const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https' || req.headers['x-forwarded-port'] === '443';
        const protocol = isHttps ? 'https' : 'http';
        const defaultGenUrl = `${protocol}://${endpoints.host}/api/generator/rdgen`;

        const result = await rdgenService.provisionGithubRepo({
            pat,
            repoName,
            genUrl: genUrl || process.env.GENURL || defaultGenUrl
        });
        res.json(result);
    } catch (e) {
        console.error('GitHub auto-provision error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// 2. Generate Client
router.post('/api/generator/rdgen/generate', requireAuth, upload.any(), async (req, res) => {
    try {
        const params = req.body;
        const myuuid = crypto.randomUUID();
        
        // Process uploaded images
        if (req.files) {
            req.files.forEach(file => {
                if (file.fieldname === 'rdgen-iconfile') {
                    params.iconlink_url = 'true'; // GitHub expects a URL but views.py uses GENURL
                    params.iconlink_uuid = myuuid;
                    params.iconlink_file = file.filename;
                }
                if (file.fieldname === 'rdgen-logofile') {
                    params.logolink_url = 'true';
                    params.logolink_uuid = myuuid;
                    params.logolink_file = file.filename;
                }
                if (file.fieldname === 'rdgen-privacyfile') {
                    params.privacylink_url = 'true';
                    params.privacylink_uuid = myuuid;
                    params.privacylink_file = file.filename;
                }
            });
        }

        const result = await rdgenService.generateCustomClient(params, myuuid, req.get('host'));
        res.json(result);
    } catch (e) {
        console.error('Generate error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// 3. Status Poll — also accessible without auth (portal page uses it for polling)
router.get('/api/generator/rdgen/status/:uuid', async (req, res) => {
    try {
        const result = await rdgenService.getRunStatus(req.params.uuid);
        res.json(result);
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 4. Webhook: Update GitHub Run
// Note: Intentionally no requireAuth so GitHub can post
router.post('/api/generator/rdgen/updategh', express.json(), async (req, res) => {
    try {
        const { uuid, github_run_id, status } = req.body;
        if (uuid) {
            const updates = {};
            if (github_run_id) updates.github_run_id = github_run_id;
            if (status) updates.status = status;
            await dbAdapter.updateRdgenRun(uuid, updates);
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 5. Webhook: Clean Zip
router.post('/api/generator/rdgen/cleanzip', express.json(), (req, res) => {
    const uuid = req.body.uuid;
    if (uuid) {
        const zipPath = path.join(rdgenService.TEMP_DIR, `secrets_${uuid}.zip`);
        if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
    }
    res.json({ success: true });
});

// 6. Provide Zip to GitHub
router.get('/api/generator/rdgen/get_zip', (req, res) => {
    const filename = req.query.filename || '';
    if (!filename.startsWith('secrets_') || !filename.endsWith('.zip')) {
        return res.status(403).send('Invalid file');
    }
    const filePath = path.join(rdgenService.TEMP_DIR, filename);
    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.status(404).send('Not found');
    }
});

// 7. Provide PNG to GitHub
router.get('/api/generator/rdgen/get_png', (req, res) => {
    const filename = req.query.filename;
    const uuid = req.query.uuid;
    if (!filename || !uuid) return res.status(400).send('Missing args');
    
    // We expect the file to be uploaded by multer in UPLOADS_DIR
    const filePath = path.join(rdgenService.UPLOADS_DIR, filename);
    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.status(404).send('Not found');
    }
});

// 8. Receive compiled client from GitHub
const saveUpload = multer({ dest: path.join(os.tmpdir(), 'betterdesk-rdgen-builds') });
router.post('/api/generator/rdgen/save_custom_client', saveUpload.single('file'), async (req, res) => {
    try {
        const uuid = req.body.uuid;
        const file = req.file;
        if (!uuid || !file) {
            return res.status(400).json({ success: false, error: 'Missing uuid or file' });
        }
        
        // Update database with artifact path
        await dbAdapter.updateRdgenRun(uuid, {
            status: 'success' // Done
        });
        
        // We move the artifact to a UUID specific directory
        const destDir = path.join(os.tmpdir(), 'betterdesk-rdgen-builds', uuid);
        if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
        
        const destPath = path.join(destDir, file.originalname);
        fs.renameSync(file.path, destPath);
        
        res.json({ success: true });
    } catch (e) {
        console.error('save_custom_client error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// 9. Download custom client — public (UUID-gated, no auth required for portal links)
router.get('/api/generator/rdgen/download/:uuid/:filename', (req, res) => {
    const uuid = req.params.uuid;
    const filename = req.params.filename;

    // Safety: uuid must be a hex UUID, filename must not path-traverse
    if (!/^[0-9a-f-]{8,}$/i.test(uuid)) return res.status(400).send('Invalid UUID');
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) return res.status(400).send('Invalid filename');

    const filePath = path.join(os.tmpdir(), 'betterdesk-rdgen-builds', uuid, filename);
    if (fs.existsSync(filePath)) {
        res.download(filePath);
    } else {
        res.status(404).send('Not found');
    }
});


// ── Presets ───────────────────────────────────────────────────────────────────

// List saved presets
router.get('/api/generator/rdgen/presets', requireAuth, async (req, res) => {
    try {
        const presets = await dbAdapter.listRdgenPresets();
        res.json({ success: true, presets });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Save a preset
router.post('/api/generator/rdgen/presets', requireAuth, async (req, res) => {
    try {
        let { name, config } = req.body || {};
        if (typeof config === 'string') {
            try { config = JSON.parse(config); } catch (_) {}
        }
        if (!name || !config || typeof config !== 'object') {
            return res.status(400).json({ success: false, error: 'name and config are required' });
        }
        const preset = await dbAdapter.createRdgenPreset(name, JSON.stringify(config));
        res.json({ success: true, preset });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Update a preset
router.put('/api/generator/rdgen/presets/:id', requireAuth, async (req, res) => {
    try {
        let { name, config } = req.body || {};
        if (typeof config === 'string') {
            try { config = JSON.parse(config); } catch (_) {}
        }
        if (!name || !config || typeof config !== 'object') {
            return res.status(400).json({ success: false, error: 'name and config are required' });
        }
        const preset = await dbAdapter.updateRdgenPreset(req.params.id, name, JSON.stringify(config));
        res.json({ success: true, preset });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Delete a preset
router.delete('/api/generator/rdgen/presets/:id', requireAuth, async (req, res) => {
    try {
        await dbAdapter.deleteRdgenPreset(req.params.id);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// List recent build runs, enriched with live GitHub job progress for active builds
router.get('/api/generator/rdgen/runs', requireAuth, async (req, res) => {
    try {
        const rows = await dbAdapter.listRdgenRuns(20);
        const ghUser   = process.env.GHUSER;
        const repoName = process.env.REPONAME || 'rdgen';
        const ghBearer = process.env.GHBEARER;
        const TERMINAL = new Set(['success', 'failure', 'cancelled', 'timed_out', 'skipped', 'action_required']);

        const runs = await Promise.all(rows.map(async run => {
            const enriched = { ...run };
            // Populate log_url if missing
            if (!enriched.log_url && enriched.github_run_id && ghUser) {
                enriched.log_url = `https://github.com/${ghUser}/${repoName}/actions/runs/${enriched.github_run_id}`;
            }
            // For active runs, fetch live status + job progress from GitHub
            if (!TERMINAL.has(enriched.status) && enriched.github_run_id && ghUser && ghBearer) {
                try {
                    const headers = {
                        'Authorization': `Bearer ${ghBearer}`,
                        'Accept': 'application/vnd.github+json'
                    };
                    // Fetch run status
                    const runRes = await fetch(
                        `https://api.github.com/repos/${ghUser}/${repoName}/actions/runs/${enriched.github_run_id}`,
                        { headers }
                    );
                    if (runRes.ok) {
                        const runData = await runRes.json();
                        enriched.gh_run_name    = runData.display_title || runData.name || null;
                        enriched.gh_run_number  = runData.run_number || null;
                        enriched.gh_status      = runData.status;        // queued/in_progress/completed
                        enriched.gh_conclusion  = runData.conclusion;    // success/failure/etc or null
                        // Sync terminal status back to DB
                        if (runData.status === 'completed' && runData.conclusion) {
                            await dbAdapter.updateRdgenRun(run.uuid, { status: runData.conclusion });
                            enriched.status = runData.conclusion;
                        }
                    }
                    // Fetch job-level progress
                    const jobsRes = await fetch(
                        `https://api.github.com/repos/${ghUser}/${repoName}/actions/runs/${enriched.github_run_id}/jobs`,
                        { headers }
                    );
                    if (jobsRes.ok) {
                        const jobsData = await jobsRes.json();
                        const jobs = jobsData.jobs || [];
                        const total     = jobs.length;
                        const completed = jobs.filter(j => j.status === 'completed').length;
                        const failed    = jobs.filter(j => j.conclusion === 'failure').length;
                        // Find the currently running job name
                        const activeJob = jobs.find(j => j.status === 'in_progress');
                        enriched.gh_jobs_total     = total;
                        enriched.gh_jobs_completed = completed;
                        enriched.gh_jobs_failed    = failed;
                        enriched.gh_active_job     = activeJob ? activeJob.name : null;
                    }
                } catch (_) { /* best-effort */ }
            }
            return enriched;
        }));

        res.json({ success: true, runs });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;

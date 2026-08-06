const path = require('path');
const fs = require('fs');
const envPath = process.env.CONSOLE_ENV_FILE || path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
        const match = line.match(/^([^#=]+)=(.*)$/);
        if (match) {
            const key = match[1].trim();
            if (!process.env[key]) process.env[key] = match[2].trim();
        }
    });
}
const githubProvisionService = require('../services/githubProvisionService');

async function triggerUpdate() {
    try {
        if (!process.env.REAL_CLIENT_GITHUB_TOKEN) {
            console.log("No GitHub token configured. Skipping build repository update.");
            return;
        }
        console.log("Triggering Real Client Build Repository update...");
        const result = await githubProvisionService.update();
        if (result.success) {
            console.log(`Build repository updated successfully! New workflow commit: ${result.workflowCommit}`);
        } else {
            console.error("Failed to update build repository.");
            process.exit(1);
        }
    } catch (err) {
        console.error("Error updating build repository:", err.message);
        process.exit(1);
    }
}

triggerUpdate();

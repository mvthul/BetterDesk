#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const langDir = path.join(__dirname, '..', 'lang');
const locales = fs.readdirSync(langDir).filter(f => f.endsWith('.json'));

const newKeys = {
    auto_provision_button: 'Auto-Provision GitHub',
    auto_provision_title: 'Auto-Provision GitHub Build Repository',
    auto_provision_desc: 'This will automatically create a private GitHub repository, inject the RustDesk build workflows, generate encryption keys, upload secrets, and configure BetterDesk.',
    auto_provision_pat_label: 'GitHub Personal Access Token (PAT)',
    auto_provision_pat_hint: 'Needs repo and workflow scopes. A fine-grained PAT is recommended.',
    auto_provision_repo_label: 'Repository Name',
    auto_provision_start: 'Start Provisioning'
};

for (const file of locales) {
    const filePath = path.join(langDir, file);
    try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (!data.generator) data.generator = {};
        
        for (const [k, v] of Object.entries(newKeys)) {
            if (!data.generator[k]) {
                data.generator[k] = v;
            }
        }
        
        fs.writeFileSync(filePath, JSON.stringify(data, null, 4) + '\n', 'utf8');
        console.log(`Updated ${file}`);
    } catch (e) {
        console.error(`Error updating ${file}: ${e.message}`);
    }
}

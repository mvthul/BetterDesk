const fs = require('fs');
const path = require('path');

const langDir = path.join(__dirname, '..', 'lang');
const files = fs.readdirSync(langDir).filter(f => f.endsWith('.json'));

const newKeys = {
    "auto_provision_title": "GitHub Repository Auto-Provisioning",
    "auto_provision_desc": "Automatically fork the rdgen repository, enable GitHub Actions workflows, and configure secret keys on your GitHub account.",
    "auto_provision_pat_label": "GitHub Personal Access Token (PAT)",
    "auto_provision_repo_label": "GitHub Build Repository Name",
    "auto_provision_start": "Start Auto-Provisioning"
};

files.forEach(file => {
    const filePath = path.join(langDir, file);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (data.generator) {
        Object.assign(data.generator, newKeys);
        fs.writeFileSync(filePath, JSON.stringify(data, null, 4) + '\n', 'utf8');
    }
});

console.log(`Successfully updated ${files.length} locale files with auto_provision keys.`);

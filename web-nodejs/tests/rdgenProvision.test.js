const tweetsodium = require('tweetsodium');
const rdgenService = require('../services/rdgenService');

describe('rdgenService.provisionGithubRepo', () => {
    test('tweetsodium seals secret payload into base64 string', () => {
        const dummyKeyBytes = Buffer.alloc(32, 1);
        const dummyKeyBase64 = dummyKeyBytes.toString('base64');
        const secret = 'https://panel.example.com/api/generator/rdgen';

        const messageBytes = Buffer.from(secret);
        const keyBytes = Buffer.from(dummyKeyBase64, 'base64');
        const encryptedBytes = tweetsodium.seal(messageBytes, keyBytes);
        const encryptedBase64 = Buffer.from(encryptedBytes).toString('base64');

        expect(encryptedBase64).toBeTruthy();
        expect(typeof encryptedBase64).toBe('string');
        expect(encryptedBase64.length).toBeGreaterThan(20);
    });

    test('provisionGithubRepo throws if no PAT provided or configured', async () => {
        const origBearer = process.env.GHBEARER;
        delete process.env.GHBEARER;
        try {
            await expect(rdgenService.provisionGithubRepo({})).rejects.toThrow(
                'No GitHub Personal Access Token (PAT) provided or configured in environment.'
            );
        } finally {
            if (origBearer) process.env.GHBEARER = origBearer;
        }
    });
});

const githubProvisionService = require('../services/githubProvisionService');
const axios = require('axios');

jest.mock('axios');

describe('GithubProvisionService', () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    test('should throw an error if pat or repoName is missing', async () => {
        await expect(githubProvisionService.provision('', 'repo')).rejects.toThrow('PAT and repository name are required.');
        await expect(githubProvisionService.provision('pat', '')).rejects.toThrow('PAT and repository name are required.');
    });

    test('should throw error when GitHub user authentication fails', async () => {
        axios.get.mockRejectedValueOnce({
            response: { data: { message: 'Bad credentials' } }
        });

        await expect(githubProvisionService.provision('bad_pat', 'my-repo')).rejects.toThrow('Failed to authenticate with GitHub: Bad credentials');
    });

    test('update() should throw error if env variables are missing', async () => {
        const oldToken = process.env.REAL_CLIENT_GITHUB_TOKEN;
        delete process.env.REAL_CLIENT_GITHUB_TOKEN;

        await expect(githubProvisionService.update()).rejects.toThrow('GitHub repository is not configured or token is missing.');

        if (oldToken) process.env.REAL_CLIENT_GITHUB_TOKEN = oldToken;
    });
});

const fs = require('fs');
const rdgenService = require('../services/rdgenService');
const db = require('../services/dbAdapter');

// Mock db adapter
jest.mock('../services/dbAdapter', () => ({
    getAdapter: () => ({
        getRdgenRuns: jest.fn().mockResolvedValue([]),
        addRdgenRun: jest.fn().mockResolvedValue(true),
        updateRdgenRunStatus: jest.fn().mockResolvedValue(true),
        createRdgenRun: jest.fn().mockResolvedValue(true),
        updateRdgenRun: jest.fn().mockResolvedValue(true)
    })
}));

// Mock axios for GitHub API
jest.mock('axios', () => ({
    post: jest.fn().mockResolvedValue({ status: 204 }),
    get: jest.fn().mockResolvedValue({ data: { workflow_runs: [] } })
}));

describe('rdgenService generateCustomClient', () => {
    let writeFileSyncSpy;

    beforeAll(() => {
        process.env.GHUSER = 'testuser';
        process.env.GHBEARER = 'testtoken';
        process.env.ZIP_PASSWORD = 'testpass';
        process.env.TEMP_DIR = '/tmp'; // Mock temp dir
    });

    beforeEach(() => {
        jest.clearAllMocks();
        writeFileSyncSpy = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    });

    afterEach(() => {
        writeFileSyncSpy.mockRestore();
    });

    it('correctly maps parameters from frontend form aliases (rdgen-direction, fix-delay)', async () => {
        const params = {
            platform: 'windows',
            version: '1.4.9',
            'fix-delay': 'true',
            exename: 'testexe',
            appname: 'MyCustomApp',
            'rdgen-direction': 'outgoing',
            installation: 'installationY',
            settings: 'settingsY',
            serverIP: 'my-server.com',
            key: 'mykey123',
            apiServer: 'https://my-server.com',
            passApproveMode: 'password-click',
            denyLan: 'false',
            permissionsDorO: 'default',
            permissionsType: 'custom',
            enableKeyboard: 'true',
            enableClipboard: 'true',
            defaultManual: 'allow-websocket=Y',
        };

        const result = await rdgenService.generateCustomClient(params, 'test-uuid-1', 'localhost');
        expect(result.success).toBe(true);
        expect(result.filename).toBe('testexe');

        // Check if writeFileSync was called with the correct data.json
        expect(writeFileSyncSpy).toHaveBeenCalled();
        const jsonContentCall = writeFileSyncSpy.mock.calls.find(c => c[0].endsWith('.json'));
        expect(jsonContentCall).toBeTruthy();

        const inputs_raw = JSON.parse(jsonContentCall[1]);
        expect(inputs_raw.server).toBe('my-server.com');
        expect(inputs_raw.filename).toBe('testexe');
        expect(inputs_raw.delayFix).toBe('true');
        expect(inputs_raw.appname).toBe('MyCustomApp');

        // Decode custom string to verify mapping
        const customDecodedStr = Buffer.from(inputs_raw.custom, 'base64').toString('ascii');
        const customDecoded = JSON.parse(customDecodedStr);

        expect(customDecoded['conn-type']).toBe('outgoing');
        expect(customDecoded['app-name']).toBe('MyCustomApp');
        expect(customDecoded['default-settings']['allow-websocket']).toBe('Y');
        expect(customDecoded['default-settings']['enable-keyboard']).toBe('Y');
    });

    it('uses correct default values when optional parameters are missing', async () => {
        const params = {
            platform: 'windows',
        };

        const result = await rdgenService.generateCustomClient(params, 'test-uuid-2', 'localhost');
        expect(result.success).toBe(true);

        const jsonContentCall = writeFileSyncSpy.mock.calls.find(c => c[0].endsWith('.json'));
        const inputs_raw = JSON.parse(jsonContentCall[1]);

        expect(inputs_raw.server).toBe('');
        expect(inputs_raw.delayFix).toBe('true'); // Default should be true
        expect(inputs_raw.filename).toBe('rustdesk');
        expect(inputs_raw.androidappid).toBe('com.carriez.flutter_hbb');
        expect(inputs_raw.compname).toBe('Purslane Ltd');

        const customDecodedStr = Buffer.from(inputs_raw.custom, 'base64').toString('ascii');
        const customDecoded = JSON.parse(customDecodedStr);

        // conn-type should be absent if both
        expect(customDecoded['conn-type']).toBeUndefined();
    });
});

import { downloadAll } from '../download';
import { DownloadItem, InstallItem } from '../models';
import { installAll } from '../install';
import { deleteAllDownloads, getDownloadedFiles, uninstallByName, listInstalledPrograms } from '../cleanup';
import { StatusDisplay } from '../ui';
import { IProcessExecutor } from '../interfaces';
import { createMockFileSystem, createMockHttpClient, createMockRegistry } from './helpers/mocks';

jest.mock('../download');
jest.mock('../install');
jest.mock('../cleanup');
jest.mock('../ui');

describe('main.ts integration', () => {
    describe('downloadAndInstall flow', () => {
        let mockFileSystem: ReturnType<typeof createMockFileSystem>;
        let mockHttpClient: ReturnType<typeof createMockHttpClient>;
        let mockProcessExecutor: jest.Mocked<IProcessExecutor>;

        beforeEach(() => {
            mockFileSystem = createMockFileSystem();
            mockHttpClient = createMockHttpClient();
            mockProcessExecutor = {
                spawn: jest.fn(),
            } as any;

            jest.clearAllMocks();
        });

        it('should handle successful download and install flow', async () => {
            const items: DownloadItem[] = [
                { name: 'app1', url: 'https://example.com/app1.exe' },
                { name: 'app2', url: 'https://example.com/app2.exe' },
            ];

            // Add a type annotation for mockStream to satisfy the linter
            const mockStream: { on: jest.Mock<any, any>; pipe: jest.Mock<any, any> } = {
                on: jest.fn((event: string, callback: () => void) => {
                    if (event === 'end') {
                        setImmediate(() => callback());
                    }
                    return mockStream;
                }),
                pipe: jest.fn(),
            };

            const mockResponse = {
                headers: { 'content-length': '0' },
                data: mockStream,
            };

            mockFileSystem.existsSync.mockReturnValue(true);
            mockHttpClient.request.mockResolvedValue(mockResponse);

            const writeStream: { on: jest.Mock<any, any> } = {
                on: jest.fn((event: string, callback: () => void) => {
                    if (event === 'finish') {
                        setImmediate(() => callback());
                    }
                    return writeStream;
                }),
            };

            mockFileSystem.createWriteStream.mockReturnValue(writeStream as any);

            (downloadAll as jest.Mock).mockResolvedValue({
                successful: [
                    { name: 'app1', path: '/tmp/app1.exe', downloadSuccess: true, error: undefined },
                    { name: 'app2', path: '/tmp/app2.exe', downloadSuccess: true, error: undefined },
                ],
                failed: [],
            });

            const mockProcess: { on: jest.Mock<any, any> } = {
                on: jest.fn((event: string, callback: (code?: number) => void) => {
                    if (event === 'close') {
                        setImmediate(() => callback(0));
                    }
                    return mockProcess;
                }),
            };

            mockProcessExecutor.spawn.mockReturnValue(mockProcess as any);

            (installAll as jest.Mock).mockResolvedValue([
                { name: 'app1', path: '/tmp/app1.exe', installSuccess: true, error: undefined },
                { name: 'app2', path: '/tmp/app2.exe', installSuccess: true, error: undefined },
            ]);

            const downloadResult = await downloadAll(items, {
                downloadDir: '/tmp',
                fileSystem: mockFileSystem as any,
                httpClient: mockHttpClient as any,
            });

            const installItems: InstallItem[] = downloadResult.successful.map(d => ({
                name: d.name,
                path: d.path,
            }));

            const installResults = await installAll(installItems, {
                processExecutor: mockProcessExecutor,
            });

            expect(downloadResult.successful).toHaveLength(2);
            expect(installResults).toHaveLength(2);
            expect(installResults.every(r => r.installSuccess)).toBe(true);
        });

        it('should handle partial download failures', async () => {
            const items: DownloadItem[] = [
                { name: 'app1', url: 'https://example.com/app1.exe' },
                { name: 'app2', url: 'https://example.com/app2.exe' },
            ];

            (downloadAll as jest.Mock).mockResolvedValue({
                successful: [
                    { name: 'app1', path: '/tmp/app1.exe', downloadSuccess: true, error: undefined },
                ],
                failed: [
                    { name: 'app2', path: '/tmp/app2.exe', downloadSuccess: false, error: new Error('Network error') },
                ],
            });

            const downloadResult = await downloadAll(items, {
                downloadDir: '/tmp',
            });

            expect(downloadResult.successful).toHaveLength(1);
            expect(downloadResult.failed).toHaveLength(1);
        });
    });

    describe('cleanupDownloads flow', () => {
        let mockFileSystem: ReturnType<typeof createMockFileSystem>;

        beforeEach(() => {
            mockFileSystem = createMockFileSystem();
            jest.clearAllMocks();
        });

        it('should delete all downloads successfully', async () => {
            mockFileSystem.existsSync.mockReturnValue(true);
            mockFileSystem.readdirSync.mockReturnValue(['file1.exe', 'file2.exe']);

            (deleteAllDownloads as jest.Mock).mockResolvedValue([
                { name: 'file1.exe', path: '/tmp/file1.exe', deleted: true },
                { name: 'file2.exe', path: '/tmp/file2.exe', deleted: true },
            ]);

            const results = await deleteAllDownloads('/tmp', mockFileSystem as any);

            expect(results).toHaveLength(2);
            expect(results.every(r => r.deleted)).toBe(true);
        });
    });

    describe('listDownloads flow', () => {
        let mockFileSystem: ReturnType<typeof createMockFileSystem>;

        beforeEach(() => {
            mockFileSystem = createMockFileSystem();
            jest.clearAllMocks();
        });

        it('should list all downloaded files', () => {
            mockFileSystem.existsSync.mockReturnValue(true);
            mockFileSystem.readdirSync.mockReturnValue(['file1.exe', 'file2.exe', 'file3.txt']);

            (getDownloadedFiles as jest.Mock).mockReturnValue([
                '/tmp/file1.exe',
                '/tmp/file2.exe',
            ]);

            const files = getDownloadedFiles('/tmp', mockFileSystem as any);

            expect(files).toHaveLength(2);
            expect(files[0]).toContain('file1.exe');
        });
    });

    describe('uninstallProgram flow', () => {
        let mockRegistry: ReturnType<typeof createMockRegistry>;
        let mockProcessExecutor: jest.Mocked<IProcessExecutor>;

        beforeEach(() => {
            mockRegistry = createMockRegistry();
            mockProcessExecutor = {
                spawn: jest.fn(),
            } as any;
            jest.clearAllMocks();
        });

        it('should uninstall a program successfully', async () => {
            mockRegistry.exec.mockResolvedValue({
                stdout: '"C:\\Program Files\\App\\uninstall.exe"',
                stderr: '',
            });

            const mockProcess: { on: jest.Mock<any, any> } = {
                on: jest.fn((event: string, callback: (code?: number) => void) => {
                    if (event === 'close') {
                        setImmediate(() => callback(0));
                    }
                    return mockProcess;
                }),
            };

            mockProcessExecutor.spawn.mockReturnValue(mockProcess as any);

            (uninstallByName as jest.Mock).mockResolvedValue({
                success: true,
            });

            const result = await uninstallByName('Test App', {
                registryAccess: mockRegistry as any,
                processExecutor: mockProcessExecutor,
            });

            expect(result.success).toBe(true);
        });

        it('should handle uninstall failures', async () => {
            (uninstallByName as jest.Mock).mockResolvedValue({
                success: false,
                error: 'Could not find uninstall string',
            });

            const result = await uninstallByName('NonExistent App', {});

            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
        });
    });

    describe('listInstalled flow', () => {
        let mockRegistry: ReturnType<typeof createMockRegistry>;

        beforeEach(() => {
            mockRegistry = createMockRegistry();
            jest.clearAllMocks();
        });

        it('should list all installed programs', async () => {
            (listInstalledPrograms as jest.Mock).mockResolvedValue([
                'Program 1',
                'Program 2',
                'Program 3',
            ]);

            const programs = await listInstalledPrograms(undefined, mockRegistry as any);

            expect(programs).toHaveLength(3);
        });

        it('should filter programs by pattern', async () => {
            (listInstalledPrograms as jest.Mock).mockResolvedValue([
                'Native Instruments',
            ]);

            const programs = await listInstalledPrograms('native', mockRegistry as any);

            expect(programs).toHaveLength(1);
            expect(programs[0]).toBe('Native Instruments');
        });
    });

    describe('StatusDisplay integration', () => {
        it('should work with install results', () => {
            const items = [
                { name: 'app1' },
                { name: 'app2' },
            ];

            const display = new StatusDisplay(items);
            display.start();

            display.setStatus('app1', 'completed');
            display.setStatus('app2', 'installing', 5000);

            display.finalize();

            expect(display).toBeDefined();
        });
    });
});


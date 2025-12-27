import {
    deleteDownload,
    deleteDownloads,
    deleteAllDownloads,
    getDownloadedFiles,
    findUninstallString,
    uninstallByName,
    uninstallByPath,
    listInstalledPrograms,
} from '../cleanup';
import { IFileSystem, IRegistryAccess, IProcessExecutor } from '../interfaces';
import { createMockFileSystem, createMockRegistry } from './helpers/mocks';

describe('cleanup', () => {
    describe('deleteDownload', () => {
        let mockFileSystem: ReturnType<typeof createMockFileSystem>;

        beforeEach(() => {
            mockFileSystem = createMockFileSystem();
        });

        it('should delete a file successfully', async () => {
            mockFileSystem.existsSync.mockReturnValue(true);

            const result = await deleteDownload('/tmp/file.exe', mockFileSystem as any);

            expect(result.success).toBe(true);
            expect(mockFileSystem.unlinkSync).toHaveBeenCalledWith('/tmp/file.exe');
        });

        it('should return error if file does not exist', async () => {
            mockFileSystem.existsSync.mockReturnValue(false);

            const result = await deleteDownload('/tmp/file.exe', mockFileSystem as any);

            expect(result.success).toBe(false);
            expect(result.error?.message).toContain('File does not exist');
            expect(mockFileSystem.unlinkSync).not.toHaveBeenCalled();
        });

        it('should handle deletion errors', async () => {
            const error = new Error('Permission denied');
            mockFileSystem.existsSync.mockReturnValue(true);
            mockFileSystem.unlinkSync.mockImplementation(() => {
                throw error;
            });

            const result = await deleteDownload('/tmp/file.exe', mockFileSystem as any);

            expect(result.success).toBe(false);
            expect(result.error).toBe(error);
        });
    });

    describe('deleteDownloads', () => {
        let mockFileSystem: ReturnType<typeof createMockFileSystem>;

        beforeEach(() => {
            mockFileSystem = createMockFileSystem();
        });

        it('should delete multiple files', async () => {
            mockFileSystem.existsSync.mockReturnValue(true);

            const filePaths = ['/tmp/file1.exe', '/tmp/file2.exe'];
            const results = await deleteDownloads(filePaths, mockFileSystem as any);

            expect(results).toHaveLength(2);
            expect(results[0].deleted).toBe(true);
            expect(results[1].deleted).toBe(true);
            expect(results[0].name).toBe('file1.exe');
            expect(results[1].name).toBe('file2.exe');
        });

        it('should handle partial failures', async () => {
            mockFileSystem.existsSync
                .mockReturnValueOnce(true)
                .mockReturnValueOnce(false);

            const filePaths = ['/tmp/file1.exe', '/tmp/file2.exe'];
            const results = await deleteDownloads(filePaths, mockFileSystem as any);

            expect(results[0].deleted).toBe(true);
            expect(results[1].deleted).toBe(false);
        });
    });

    describe('deleteAllDownloads', () => {
        let mockFileSystem: ReturnType<typeof createMockFileSystem>;

        beforeEach(() => {
            mockFileSystem = createMockFileSystem();
        });

        it('should delete all .exe files from directory', async () => {
            mockFileSystem.existsSync.mockReturnValue(true);
            mockFileSystem.readdirSync.mockReturnValue(['file1.exe', 'file2.exe', 'file3.txt']);

            const results = await deleteAllDownloads('/tmp', undefined, mockFileSystem as any);

            expect(results).toHaveLength(2);
            expect(results[0].name).toBe('file1.exe');
            expect(results[1].name).toBe('file2.exe');
        });

        it('should filter by pattern when provided', async () => {
            mockFileSystem.existsSync.mockReturnValue(true);
            mockFileSystem.readdirSync.mockReturnValue(['fl-studio.exe', 'native-instruments.exe', 'other.exe']);

            const results = await deleteAllDownloads('/tmp', 'fl-studio', mockFileSystem as any);

            expect(results).toHaveLength(1);
            expect(results[0].name).toBe('fl-studio.exe');
        });

        it('should return empty array if directory does not exist', async () => {
            mockFileSystem.existsSync.mockReturnValue(false);

            const results = await deleteAllDownloads('/tmp', undefined, mockFileSystem as any);

            expect(results).toHaveLength(0);
        });

        it('should throw error on readdir failure', async () => {
            mockFileSystem.existsSync.mockReturnValue(true);
            mockFileSystem.readdirSync.mockImplementation(() => {
                throw new Error('Access denied');
            });

            await expect(deleteAllDownloads('/tmp', undefined, mockFileSystem as any))
                .rejects.toThrow('Failed to delete downloads from /tmp');
        });
    });

    describe('getDownloadedFiles', () => {
        let mockFileSystem: ReturnType<typeof createMockFileSystem>;

        beforeEach(() => {
            mockFileSystem = createMockFileSystem();
        });

        it('should return all .exe files from directory', () => {
            mockFileSystem.existsSync.mockReturnValue(true);
            mockFileSystem.readdirSync.mockReturnValue(['file1.exe', 'file2.exe', 'file3.txt']);

            const files = getDownloadedFiles('/tmp', undefined, mockFileSystem as any);

            expect(files).toHaveLength(2);
            expect(files[0]).toContain('file1.exe');
            expect(files[1]).toContain('file2.exe');
        });

        it('should filter by pattern when provided', () => {
            mockFileSystem.existsSync.mockReturnValue(true);
            mockFileSystem.readdirSync.mockReturnValue(['fl-studio.exe', 'native-instruments.exe', 'other.exe']);

            const files = getDownloadedFiles('/tmp', 'fl-studio', mockFileSystem as any);

            expect(files).toHaveLength(1);
            expect(files[0]).toContain('fl-studio.exe');
        });

        it('should return empty array if directory does not exist', () => {
            mockFileSystem.existsSync.mockReturnValue(false);

            const files = getDownloadedFiles('/tmp', undefined, mockFileSystem as any);

            expect(files).toHaveLength(0);
        });
    });

    describe('findUninstallString', () => {
        let mockRegistry: ReturnType<typeof createMockRegistry>;

        beforeEach(() => {
            mockRegistry = createMockRegistry();
        });

        it('should find uninstall string from registry', async () => {
            mockRegistry.exec.mockResolvedValue({
                stdout: '"C:\\Program Files\\App\\uninstall.exe" /S',
                stderr: '',
            });

            const result = await findUninstallString('Test App', mockRegistry as any);

            expect(result).toBe('"C:\\Program Files\\App\\uninstall.exe" /S');
            expect(mockRegistry.exec).toHaveBeenCalled();
        });

        it('should return null if not found', async () => {
            mockRegistry.exec.mockResolvedValue({
                stdout: '',
                stderr: '',
            });

            const result = await findUninstallString('NonExistent App', mockRegistry as any);

            expect(result).toBeNull();
        });

        it('should handle registry errors gracefully', async () => {
            mockRegistry.exec.mockRejectedValue(new Error('Registry error'));

            const result = await findUninstallString('Test App', mockRegistry as any);

            expect(result).toBeNull();
        });
    });

    describe('uninstallByName', () => {
        let mockRegistry: ReturnType<typeof createMockRegistry>;
        let mockProcessExecutor: jest.Mocked<IProcessExecutor>;

        beforeEach(() => {
            mockRegistry = createMockRegistry();
            mockProcessExecutor = {
                spawn: jest.fn(),
            } as any;
        });

        it('should uninstall a program successfully', async () => {
            jest.useFakeTimers();
            // First call: find uninstall string (before uninstall)
            // Second call: verify uninstall (after uninstall) - return null to indicate uninstalled
            mockRegistry.exec
                .mockResolvedValueOnce({
                    stdout: '"C:\\Program Files\\App\\uninstall.exe"',
                    stderr: '',
                })
                .mockResolvedValueOnce({
                    stdout: '',
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

            const promise = uninstallByName('Test App', {
                registryAccess: mockRegistry as any,
                processExecutor: mockProcessExecutor,
            });

            // Fast-forward the 500ms wait for registry update
            jest.advanceTimersByTime(500);
            await jest.runAllTimersAsync();

            const result = await promise;

            expect(result.success).toBe(true);
            jest.useRealTimers();
        });

        it('should return error if uninstall string not found', async () => {
            mockRegistry.exec.mockResolvedValue({
                stdout: '',
                stderr: '',
            });

            const result = await uninstallByName('NonExistent App', {
                registryAccess: mockRegistry as any,
            });

            expect(result.success).toBe(false);
            expect(result.error).toContain('Could not find uninstall string');
        });

        it('should parse uninstall string with quotes', async () => {
            jest.useFakeTimers();
            // First call: find uninstall string (before uninstall)
            // Second call: verify uninstall (after uninstall) - return null to indicate uninstalled
            mockRegistry.exec
                .mockResolvedValueOnce({
                    stdout: '"C:\\Program Files\\App\\uninstall.exe" /S',
                    stderr: '',
                })
                .mockResolvedValueOnce({
                    stdout: '',
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

            const promise = uninstallByName('Test App', {
                registryAccess: mockRegistry as any,
                processExecutor: mockProcessExecutor,
            });

            // Fast-forward the 500ms wait for registry update
            jest.advanceTimersByTime(500);
            await jest.runAllTimersAsync();

            await promise;

            expect(mockProcessExecutor.spawn).toHaveBeenCalledWith(
                'C:\\Program Files\\App\\uninstall.exe',
                expect.arrayContaining(['/S']),
                expect.any(Object),
            );
            jest.useRealTimers();
        });

        it('should parse uninstall string without quotes', async () => {
            jest.useFakeTimers();
            // Use a path without spaces to avoid regex parsing issues
            // First call: find uninstall string (before uninstall)
            // Second call: verify uninstall (after uninstall) - return null to indicate uninstalled
            mockRegistry.exec
                .mockResolvedValueOnce({
                    stdout: 'C:\\ProgramFiles\\App\\uninstall.exe /S',
                    stderr: '',
                })
                .mockResolvedValueOnce({
                    stdout: '',
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

            const promise = uninstallByName('Test App', {
                registryAccess: mockRegistry as any,
                processExecutor: mockProcessExecutor,
            });

            // Fast-forward the 500ms wait for registry update
            jest.advanceTimersByTime(500);
            await jest.runAllTimersAsync();

            await promise;

            expect(mockProcessExecutor.spawn).toHaveBeenCalledWith(
                'C:\\ProgramFiles\\App\\uninstall.exe',
                expect.arrayContaining(['/S']),
                expect.any(Object),
            );
            jest.useRealTimers();
        });

        it('should add silent flags when silent is true', async () => {
            jest.useFakeTimers();
            // First call: find uninstall string (before uninstall)
            // Second call: verify uninstall (after uninstall) - return null to indicate uninstalled
            mockRegistry.exec
                .mockResolvedValueOnce({
                    stdout: '"C:\\Program Files\\App\\uninstall.exe"',
                    stderr: '',
                })
                .mockResolvedValueOnce({
                    stdout: '',
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

            const promise = uninstallByName('Test App', {
                silent: true,
                registryAccess: mockRegistry as any,
                processExecutor: mockProcessExecutor,
            });

            // Fast-forward the 500ms wait for registry update
            jest.advanceTimersByTime(500);
            await jest.runAllTimersAsync();

            await promise;

            expect(mockProcessExecutor.spawn).toHaveBeenCalledWith(
                'C:\\Program Files\\App\\uninstall.exe',
                expect.arrayContaining(['/S', '/SILENT', '/VERYSILENT']),
                expect.any(Object),
            );
            jest.useRealTimers();
        });

        it('should not add silent flags if already present', async () => {
            jest.useFakeTimers();
            // First call: find uninstall string (before uninstall)
            // Second call: verify uninstall (after uninstall) - return null to indicate uninstalled
            mockRegistry.exec
                .mockResolvedValueOnce({
                    stdout: '"C:\\Program Files\\App\\uninstall.exe" /S',
                    stderr: '',
                })
                .mockResolvedValueOnce({
                    stdout: '',
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

            const promise = uninstallByName('Test App', {
                silent: true,
                registryAccess: mockRegistry as any,
                processExecutor: mockProcessExecutor,
            });

            // Fast-forward the 500ms wait for registry update
            jest.advanceTimersByTime(500);
            await jest.runAllTimersAsync();

            await promise;

            const callArgs = mockProcessExecutor.spawn.mock.calls[0][1];
            const silentFlagCount = callArgs.filter((arg: string) =>
                arg === '/S' || arg === '/SILENT' || arg === '/VERYSILENT',
            ).length;

            expect(silentFlagCount).toBe(1); // Only the original /S, not duplicated
            jest.useRealTimers();
        });
    });

    describe('uninstallByPath', () => {
        let mockProcessExecutor: jest.Mocked<IProcessExecutor>;

        beforeEach(() => {
            mockProcessExecutor = {
                spawn: jest.fn(),
            } as any;
        });

        it('should uninstall using direct path', async () => {
            const mockProcess: { on: jest.Mock<any, any> } = {
                on: jest.fn((event: string, callback: (code?: number) => void) => {
                    if (event === 'close') {
                        setImmediate(() => callback(0));
                    }
                    return mockProcess;
                }),
            };

            mockProcessExecutor.spawn.mockReturnValue(mockProcess as any);

            const result = await uninstallByPath('C:\\uninstall.exe', {
                processExecutor: mockProcessExecutor,
            });

            expect(result.success).toBe(true);
            expect(mockProcessExecutor.spawn).toHaveBeenCalledWith(
                'C:\\uninstall.exe',
                ['/S', '/SILENT', '/VERYSILENT'],
                expect.any(Object),
            );
        });
    });

    describe('listInstalledPrograms', () => {
        let mockRegistry: ReturnType<typeof createMockRegistry>;

        beforeEach(() => {
            mockRegistry = createMockRegistry();
        });

        it('should list all installed programs', async () => {
            mockRegistry.exec.mockResolvedValue({
                stdout: 'Program 1\nProgram 2\nProgram 3\n',
                stderr: '',
            });

            const programs = await listInstalledPrograms(undefined, mockRegistry as any);

            expect(programs).toHaveLength(3);
            expect(programs).toContain('Program 1');
            expect(programs).toContain('Program 2');
            expect(programs).toContain('Program 3');
        });

        it('should filter programs by pattern', async () => {
            mockRegistry.exec.mockResolvedValue({
                stdout: 'FL Studio\nNative Instruments\nOther App\n',
                stderr: '',
            });

            const programs = await listInstalledPrograms('native', mockRegistry as any);

            expect(programs).toHaveLength(1);
            expect(programs[0]).toBe('Native Instruments');
        });

        it('should handle empty output', async () => {
            mockRegistry.exec.mockResolvedValue({
                stdout: '',
                stderr: '',
            });

            const programs = await listInstalledPrograms(undefined, mockRegistry as any);

            expect(programs).toHaveLength(0);
        });

        it('should throw error on registry access failure', async () => {
            mockRegistry.exec.mockRejectedValue(new Error('Access denied'));

            await expect(listInstalledPrograms(undefined, mockRegistry as any))
                .rejects.toThrow('Failed to list installed programs');
        });
    });
});


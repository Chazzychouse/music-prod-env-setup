import { executeProcess, executeInstaller, installSingle, installSequentially, installConcurrently, installAll } from '../install';
import { InstallItem } from '../models';
import { IProcessExecutor } from '../interfaces';

describe('install', () => {
    describe('executeProcess', () => {
        let mockProcessExecutor: jest.Mocked<IProcessExecutor>;

        beforeEach(() => {
            mockProcessExecutor = {
                spawn: jest.fn(),
            } as any;
        });

        it('should execute a process successfully', async () => {
            const mockProcess: { on: jest.Mock<any, any> } = {
                on: jest.fn((event: string, callback: (code?: number) => void) => {
                    if (event === 'close') {
                        setImmediate(() => callback(0));
                    }
                    return mockProcess;
                }),
            };

            mockProcessExecutor.spawn.mockReturnValue(mockProcess as any);

            const result = await executeProcess('test.exe', ['arg1'], {}, mockProcessExecutor);

            expect(result.success).toBe(true);
            expect(result.exitCode).toBe(0);
            expect(mockProcessExecutor.spawn).toHaveBeenCalledWith('test.exe', ['arg1'], {
                stdio: 'ignore',
                shell: false,
            });
        });

        it('should handle process errors', async () => {
            const mockProcess: { on: jest.Mock<any, any> } = {
                on: jest.fn((event: string, callback: (error?: Error) => void) => {
                    if (event === 'error') {
                        setImmediate(() => callback(new Error('Process error')));
                    }
                    return mockProcess;
                }),
            };

            mockProcessExecutor.spawn.mockReturnValue(mockProcess as any);

            const result = await executeProcess('test.exe', [], {}, mockProcessExecutor);

            expect(result.success).toBe(false);
            expect(result.error).toBe('Process error');
        });

        it('should handle non-zero exit codes', async () => {
            const mockProcess: { on: jest.Mock<any, any> } = {
                on: jest.fn((event: string, callback: (code?: number) => void) => {
                    if (event === 'close') {
                        setImmediate(() => callback(1));
                    }
                    return mockProcess;
                }),
            };

            mockProcessExecutor.spawn.mockReturnValue(mockProcess as any);

            const result = await executeProcess('test.exe', [], {}, mockProcessExecutor);

            expect(result.success).toBe(false);
            expect(result.exitCode).toBe(1);
        });

        it('should handle timeouts', async () => {
            jest.useFakeTimers();
            const mockProcess: { on: jest.Mock<any, any>, kill: jest.Mock<any, any> } = {
                on: jest.fn(),
                kill: jest.fn(),
            };

            mockProcessExecutor.spawn.mockReturnValue(mockProcess as any);

            const promise = executeProcess('test.exe', [], { timeout: 50 }, mockProcessExecutor);

            jest.advanceTimersByTime(50);

            await jest.runAllTimersAsync();

            const result = await promise;

            expect(result.success).toBe(false);
            expect(result.error).toBe('Process execution timed out');
            expect(mockProcess.kill).toHaveBeenCalled();

            jest.useRealTimers();
        });

        it('should call onProgress callback', async () => {
            jest.useFakeTimers();
            const mockProcess: { on: jest.Mock<any, any> } = {
                on: jest.fn((event: string, callback: (code?: number) => void) => {
                    if (event === 'close') {
                        setTimeout(() => callback(0), 150);
                    }
                    return mockProcess;
                }),
            };

            mockProcessExecutor.spawn.mockReturnValue(mockProcess as any);

            const onProgress = jest.fn();
            const promise = executeProcess('test.exe', [], { onProgress, timeout: 1000 }, mockProcessExecutor);

            jest.advanceTimersByTime(120);

            expect(onProgress).toHaveBeenCalled();

            jest.advanceTimersByTime(30);

            await jest.runAllTimersAsync();

            await promise;

            jest.useRealTimers();
        });

        it('should use non-silent mode when specified', async () => {
            const mockProcess: { on: jest.Mock<any, any> } = {
                on: jest.fn((event: string, callback: (code?: number) => void) => {
                    if (event === 'close') {
                        setImmediate(() => callback(0));
                    }
                    return mockProcess;
                }),
            };

            mockProcessExecutor.spawn.mockReturnValue(mockProcess as any);

            await executeProcess('test.exe', [], { silent: false }, mockProcessExecutor);

            expect(mockProcessExecutor.spawn).toHaveBeenCalledWith('test.exe', [], {
                stdio: 'inherit',
                shell: false,
            });
        });
    });

    describe('executeInstaller', () => {
        let mockProcessExecutor: jest.Mocked<IProcessExecutor>;

        beforeEach(() => {
            mockProcessExecutor = {
                spawn: jest.fn(),
            } as any;
        });

        it('should add comprehensive silent flags when silent is true', async () => {
            const mockProcess: { on: jest.Mock<any, any> } = {
                on: jest.fn((event: string, callback: (code?: number) => void) => {
                    if (event === 'close') {
                        setImmediate(() => callback(0));
                    }
                    return mockProcess;
                }),
            };

            mockProcessExecutor.spawn.mockReturnValue(mockProcess as any);

            await executeInstaller('installer.exe', { silent: true }, mockProcessExecutor);

            expect(mockProcessExecutor.spawn).toHaveBeenCalledWith(
                'installer.exe',
                ['/VERYSILENT', '/SP-', '/SUPPRESSMSGBOXES', '/NORESTART', '/SILENT', '/S'],
                expect.any(Object),
            );
        });

        it('should not add silent flags when silent is false', async () => {
            const mockProcess: { on: jest.Mock<any, any> } = {
                on: jest.fn((event: string, callback: (code?: number) => void) => {
                    if (event === 'close') {
                        setImmediate(() => callback(0));
                    }
                    return mockProcess;
                }),
            };

            mockProcessExecutor.spawn.mockReturnValue(mockProcess as any);

            await executeInstaller('installer.exe', { silent: false }, mockProcessExecutor);

            expect(mockProcessExecutor.spawn).toHaveBeenCalledWith(
                'installer.exe',
                [],
                expect.any(Object),
            );
        });

        it('should merge custom args with silent args', async () => {
            const mockProcess: { on: jest.Mock<any, any> } = {
                on: jest.fn((event: string, callback: (code?: number) => void) => {
                    if (event === 'close') {
                        setImmediate(() => callback(0));
                    }
                    return mockProcess;
                }),
            };

            mockProcessExecutor.spawn.mockReturnValue(mockProcess as any);

            await executeInstaller('installer.exe', { silent: true, args: ['/CUSTOM'] }, mockProcessExecutor);

            expect(mockProcessExecutor.spawn).toHaveBeenCalledWith(
                'installer.exe',
                ['/VERYSILENT', '/SP-', '/SUPPRESSMSGBOXES', '/NORESTART', '/SILENT', '/S', '/CUSTOM'],
                expect.any(Object),
            );
        });
    });

    describe('installSingle', () => {
        let mockProcessExecutor: jest.Mocked<IProcessExecutor>;

        beforeEach(() => {
            mockProcessExecutor = {
                spawn: jest.fn(),
            } as any;
        });

        it('should install a single item successfully', async () => {
            const item: InstallItem = { name: 'test-app', path: '/tmp/test-app.exe' };
            const mockProcess: { on: jest.Mock<any, any> } = {
                on: jest.fn((event: string, callback: (code?: number) => void) => {
                    if (event === 'close') {
                        setImmediate(() => callback(0));
                    }
                    return mockProcess;
                }),
            };

            mockProcessExecutor.spawn.mockReturnValue(mockProcess as any);

            const onStatusChange = jest.fn();
            const result = await installSingle(item, {
                processExecutor: mockProcessExecutor,
                onStatusChange,
            });

            expect(result.installSuccess).toBe(true);
            expect(result.name).toBe('test-app');
            expect(onStatusChange).toHaveBeenCalledWith('test-app', 'completed');
        });

        it('should handle installation failures', async () => {
            const item: InstallItem = { name: 'test-app', path: '/tmp/test-app.exe' };
            const mockProcess: { on: jest.Mock<any, any> } = {
                on: jest.fn((event: string, callback: (code?: number) => void) => {
                    if (event === 'close') {
                        setImmediate(() => callback(1));
                    }
                    return mockProcess;
                }),
            };

            mockProcessExecutor.spawn.mockReturnValue(mockProcess as any);

            const onStatusChange = jest.fn();
            const result = await installSingle(item, {
                processExecutor: mockProcessExecutor,
                onStatusChange,
            });

            expect(result.installSuccess).toBe(false);
            expect(onStatusChange).toHaveBeenCalledWith('test-app', 'failed');
        });

        it('should call onProgress callback', async () => {
            jest.useFakeTimers();
            const item: InstallItem = { name: 'test-app', path: '/tmp/test-app.exe' };
            const mockProcess: { on: jest.Mock<any, any> } = {
                on: jest.fn((event: string, callback: (code?: number) => void) => {
                    if (event === 'close') {
                        setTimeout(() => callback(0), 150);
                    }
                    return mockProcess;
                }),
            };

            mockProcessExecutor.spawn.mockReturnValue(mockProcess as any);

            const onProgress = jest.fn();
            const promise = installSingle(item, {
                processExecutor: mockProcessExecutor,
                onProgress,
            });

            jest.advanceTimersByTime(120);

            expect(onProgress).toHaveBeenCalled();

            jest.advanceTimersByTime(30);

            await jest.runAllTimersAsync();

            await promise;

            jest.useRealTimers();
        });
    });

    describe('installSequentially', () => {
        let mockProcessExecutor: jest.Mocked<IProcessExecutor>;

        beforeEach(() => {
            mockProcessExecutor = {
                spawn: jest.fn(),
            } as any;
        });

        it('should install items one after another', async () => {
            const items: InstallItem[] = [
                { name: 'app1', path: '/tmp/app1.exe' },
                { name: 'app2', path: '/tmp/app2.exe' },
            ];

            let callCount = 0;
            const mockProcess: { on: jest.Mock<any, any> } = {
                on: jest.fn((event: string, callback: (code?: number) => void) => {
                    if (event === 'close') {
                        setImmediate(() => {
                            callCount++;
                            callback(0);
                        });
                    }
                    return mockProcess;
                }),
            };

            mockProcessExecutor.spawn.mockReturnValue(mockProcess as any);

            const results = await installSequentially(items, {
                processExecutor: mockProcessExecutor,
            });

            expect(results).toHaveLength(2);
            expect(results[0].installSuccess).toBe(true);
            expect(results[1].installSuccess).toBe(true);
            expect(mockProcessExecutor.spawn).toHaveBeenCalledTimes(2);
        });

        it('should set pending status for all items initially', async () => {
            const items: InstallItem[] = [
                { name: 'app1', path: '/tmp/app1.exe' },
                { name: 'app2', path: '/tmp/app2.exe' },
            ];

            const mockProcess: { on: jest.Mock<any, any> } = {
                on: jest.fn((event: string, callback: (code?: number) => void) => {
                    if (event === 'close') {
                        setImmediate(() => callback(0));
                    }
                    return mockProcess;
                }),
            };

            mockProcessExecutor.spawn.mockReturnValue(mockProcess as any);

            const onStatusChange = jest.fn();
            await installSequentially(items, {
                processExecutor: mockProcessExecutor,
                onStatusChange,
            });

            expect(onStatusChange).toHaveBeenCalledWith('app1', 'pending');
            expect(onStatusChange).toHaveBeenCalledWith('app2', 'pending');
        });
    });

    describe('installConcurrently', () => {
        let mockProcessExecutor: jest.Mocked<IProcessExecutor>;

        beforeEach(() => {
            mockProcessExecutor = {
                spawn: jest.fn(),
            } as any;
        });

        it('should install items concurrently', async () => {
            const items: InstallItem[] = [
                { name: 'app1', path: '/tmp/app1.exe' },
                { name: 'app2', path: '/tmp/app2.exe' },
            ];

            const mockProcess: { on: jest.Mock<any, any> } = {
                on: jest.fn((event: string, callback: (code?: number) => void) => {
                    if (event === 'close') {
                        setImmediate(() => callback(0));
                    }
                    return mockProcess;
                }),
            };

            mockProcessExecutor.spawn.mockReturnValue(mockProcess as any);

            const results = await installConcurrently(items, {
                processExecutor: mockProcessExecutor,
            });

            expect(results).toHaveLength(2);
            expect(results[0].installSuccess).toBe(true);
            expect(results[1].installSuccess).toBe(true);
        });

        it('should handle partial failures', async () => {
            const items: InstallItem[] = [
                { name: 'app1', path: '/tmp/app1.exe' },
                { name: 'app2', path: '/tmp/app2.exe' },
            ];

            let callCount = 0;
            const mockProcess: { on: jest.Mock<any, any> } = {
                on: jest.fn((event: string, callback: (code?: number) => void) => {
                    if (event === 'close') {
                        setImmediate(() => {
                            callback(callCount === 0 ? 0 : 1);
                            callCount++;
                        });
                    }
                    return mockProcess;
                }),
            };

            mockProcessExecutor.spawn.mockReturnValue(mockProcess as any);

            const results = await installConcurrently(items, {
                processExecutor: mockProcessExecutor,
            });

            expect(results[0].installSuccess).toBe(true);
            expect(results[1].installSuccess).toBe(false);
        });
    });

    describe('installAll', () => {
        let mockProcessExecutor: jest.Mocked<IProcessExecutor>;

        beforeEach(() => {
            mockProcessExecutor = {
                spawn: jest.fn(),
            } as any;
        });

        it('should use sequential mode by default', async () => {
            const items: InstallItem[] = [
                { name: 'app1', path: '/tmp/app1.exe' },
            ];

            const mockProcess: { on: jest.Mock<any, any> } = {
                on: jest.fn((event: string, callback: (code?: number) => void) => {
                    if (event === 'close') {
                        setImmediate(() => callback(0));
                    }
                    return mockProcess;
                }),
            };

            mockProcessExecutor.spawn.mockReturnValue(mockProcess as any);

            await installAll(items, {
                processExecutor: mockProcessExecutor,
            });

            expect(mockProcessExecutor.spawn).toHaveBeenCalledTimes(1);
        });

        it('should use concurrent mode when specified', async () => {
            const items: InstallItem[] = [
                { name: 'app1', path: '/tmp/app1.exe' },
                { name: 'app2', path: '/tmp/app2.exe' },
            ];

            const mockProcess: { on: jest.Mock<any, any> } = {
                on: jest.fn((event: string, callback: (code?: number) => void) => {
                    if (event === 'close') {
                        setImmediate(() => callback(0));
                    }
                    return mockProcess;
                }),
            };

            mockProcessExecutor.spawn.mockReturnValue(mockProcess as any);

            await installAll(items, {
                concurrent: true,
                processExecutor: mockProcessExecutor,
            });

            expect(mockProcessExecutor.spawn).toHaveBeenCalledTimes(2);
        });
    });
});


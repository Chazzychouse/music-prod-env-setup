import { downloadFile, downloadSingle, downloadAll } from '../download';
import { DownloadItem } from '../models';
import { IProgressBarFactory } from '../interfaces';
import { createMockFileSystem, createMockHttpClient } from './helpers/mocks';

describe('download', () => {
    describe('downloadFile', () => {
        let mockFileSystem: ReturnType<typeof createMockFileSystem>;
        let mockHttpClient: ReturnType<typeof createMockHttpClient>;

        beforeEach(() => {
            mockFileSystem = createMockFileSystem();
            mockHttpClient = createMockHttpClient();
        });

        it('should download a file successfully', async () => {
            const url = 'https://example.com/file.exe';
            const outputPath = '/tmp/file.exe';
            const mockStream: { on: jest.Mock<any, any>, pipe: jest.Mock<any, any> } = {
                on: jest.fn((event: string, callback: (data?: any) => void) => {
                    if (event === 'data') {
                        setImmediate(() => callback(Buffer.from('test data')));
                    } else if (event === 'end') {
                        setImmediate(() => callback());
                    }
                    return mockStream;
                }),
                pipe: jest.fn(),
            };

            const mockResponse = {
                headers: { 'content-length': '9' },
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

            await downloadFile(url, outputPath, undefined, mockFileSystem as any, mockHttpClient as any);

            expect(mockFileSystem.existsSync).toHaveBeenCalledWith('/tmp');
            expect(mockHttpClient.request).toHaveBeenCalledWith({
                method: 'GET',
                url,
                responseType: 'stream',
            });
        });

        it('should create directory if it does not exist', async () => {
            const url = 'https://example.com/file.exe';
            const outputPath = '/tmp/file.exe';
            const mockStream: { on: jest.Mock<any, any>, pipe: jest.Mock<any, any> } = {
                on: jest.fn((event: string, callback: () => void) => {
                    if (event === 'end') {
                        setImmediate(() => callback());
                    }
                    return mockStream;
                }),
                pipe: jest.fn(),
            };

            const mockResponse = {
                headers: { 'content-length': '9' },
                data: mockStream,
            };

            mockFileSystem.existsSync.mockReturnValue(false);
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

            await downloadFile(url, outputPath, undefined, mockFileSystem as any, mockHttpClient as any);

            expect(mockFileSystem.mkdirSync).toHaveBeenCalledWith('/tmp', { recursive: true });
        });

        it('should call onProgress callback with progress updates', async () => {
            const url = 'https://example.com/file.exe';
            const outputPath = '/tmp/file.exe';
            const onProgress = jest.fn();

            const mockStream: { on: jest.Mock<any, any>, pipe: jest.Mock<any, any> } = {
                on: jest.fn((event: string, callback: (data?: any) => void) => {
                    if (event === 'data') {
                        setImmediate(() => callback(Buffer.from('test')));
                    } else if (event === 'end') {
                        setImmediate(() => callback());
                    }
                    return mockStream;
                }),
                pipe: jest.fn(),
            };

            const mockResponse = {
                headers: { 'content-length': '4' },
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

            await downloadFile(url, outputPath, onProgress, mockFileSystem as any, mockHttpClient as any);

            await new Promise(resolve => setImmediate(resolve));

            expect(onProgress).toHaveBeenCalled();
        });
    });

    describe('downloadSingle', () => {
        let mockFileSystem: ReturnType<typeof createMockFileSystem>;
        let mockHttpClient: ReturnType<typeof createMockHttpClient>;

        beforeEach(() => {
            mockFileSystem = createMockFileSystem();
            mockHttpClient = createMockHttpClient();
        });

        it('should download a single file successfully', async () => {
            const item: DownloadItem = { name: 'test-app', url: 'https://example.com/app.exe' };
            const mockStream: { on: jest.Mock<any, any>, pipe: jest.Mock<any, any> } = {
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

            const result = await downloadSingle(item, {
                downloadDir: '/tmp',
                fileSystem: mockFileSystem as any,
                httpClient: mockHttpClient as any,
            });

            expect(result.downloadSuccess).toBe(true);
            expect(result.name).toBe('test-app');
            expect(result.path).toBe('/tmp\\test-app.exe');
        });

        it('should handle download errors gracefully', async () => {
            const item: DownloadItem = { name: 'test-app', url: 'https://example.com/app.exe' };
            const error = new Error('Network error');

            mockFileSystem.existsSync.mockReturnValue(true);
            mockHttpClient.request.mockRejectedValue(error);

            const result = await downloadSingle(item, {
                downloadDir: '/tmp',
                fileSystem: mockFileSystem as any,
                httpClient: mockHttpClient as any,
            });

            expect(result.downloadSuccess).toBe(false);
            expect(result.error).toBe(error);
        });

        it('should use default download directory if not provided', async () => {
            const item: DownloadItem = { name: 'test-app', url: 'https://example.com/app.exe' };
            const mockStream: { on: jest.Mock<any, any>, pipe: jest.Mock<any, any> } = {
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

            const result = await downloadSingle(item, {
                fileSystem: mockFileSystem as any,
                httpClient: mockHttpClient as any,
            });

            expect(result.path).toContain('C:\\Users\\ccart\\Downloads');
        });
    });

    describe('downloadAll', () => {
        let mockFileSystem: ReturnType<typeof createMockFileSystem>;
        let mockHttpClient: ReturnType<typeof createMockHttpClient>;
        let mockProgressBarFactory: jest.Mocked<IProgressBarFactory>;

        beforeEach(() => {
            mockFileSystem = createMockFileSystem();
            mockHttpClient = createMockHttpClient();
            mockProgressBarFactory = {
                createMultiBar: jest.fn(() => ({
                    create: jest.fn(() => ({
                        setTotal: jest.fn(),
                        update: jest.fn(),
                        stop: jest.fn(),
                    })),
                    stop: jest.fn(),
                })),
            } as any;
        });

        it('should download all files successfully', async () => {
            const items: DownloadItem[] = [
                { name: 'app1', url: 'https://example.com/app1.exe' },
                { name: 'app2', url: 'https://example.com/app2.exe' },
            ];

            const mockStream: { on: jest.Mock<any, any>, pipe: jest.Mock<any, any> } = {
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

            const result = await downloadAll(items, {
                downloadDir: '/tmp',
                fileSystem: mockFileSystem as any,
                httpClient: mockHttpClient as any,
                progressBarFactory: mockProgressBarFactory,
            });

            expect(result.successful).toHaveLength(2);
            expect(result.failed).toHaveLength(0);
        });

        it('should handle partial failures', async () => {
            const items: DownloadItem[] = [
                { name: 'app1', url: 'https://example.com/app1.exe' },
                { name: 'app2', url: 'https://example.com/app2.exe' },
            ];

            const mockStream: { on: jest.Mock<any, any>, pipe: jest.Mock<any, any> } = {
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
            mockHttpClient.request
                .mockResolvedValueOnce(mockResponse)
                .mockRejectedValueOnce(new Error('Network error'));

            const writeStream: { on: jest.Mock<any, any> } = {
                on: jest.fn((event: string, callback: () => void) => {
                    if (event === 'finish') {
                        setImmediate(() => callback());
                    }
                    return writeStream;
                }),
            };
            mockFileSystem.createWriteStream.mockReturnValue(writeStream as any);

            const result = await downloadAll(items, {
                downloadDir: '/tmp',
                fileSystem: mockFileSystem as any,
                httpClient: mockHttpClient as any,
                progressBarFactory: mockProgressBarFactory,
            });

            expect(result.successful).toHaveLength(1);
            expect(result.failed).toHaveLength(1);
            expect(result.failed[0].name).toBe('app2');
        });

        it('should work without progress bar factory', async () => {
            const items: DownloadItem[] = [
                { name: 'app1', url: 'https://example.com/app1.exe' },
            ];

            const mockStream: { on: jest.Mock<any, any>, pipe: jest.Mock<any, any> } = {
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

            const result = await downloadAll(items, {
                downloadDir: '/tmp',
                fileSystem: mockFileSystem as any,
                httpClient: mockHttpClient as any,
            });

            expect(result.successful).toHaveLength(1);
        });
    });
});


/**
 * Mock helpers and factories for testing
 * 
 * Note: These types use jest.Mock which is available in test files
 * that have @types/jest installed and configured.
 */

// Type definitions for mocks
export interface MockFileSystem {
    existsSync: jest.Mock<boolean, [string]>;
    mkdirSync: jest.Mock<void, [string, { recursive?: boolean }?]>;
    readdirSync: jest.Mock<string[], [string]>;
    unlinkSync: jest.Mock<void, [string]>;
    createWriteStream: jest.Mock<NodeJS.WritableStream, [string]>;
}

export interface MockHttpClient {
    request: jest.Mock;
}

export interface MockProcessSpawn {
    spawn: jest.Mock;
}

export interface MockRegistry {
    exec: jest.Mock<Promise<{ stdout: string; stderr: string }>, [string]>;
}

export function createMockFileSystem(): MockFileSystem {
    const writeStream = {
        on: jest.fn((event: string, callback: () => void) => {
            if (event === 'finish') {
                setTimeout(() => callback(), 0);
            }
            return writeStream;
        }),
        write: jest.fn(),
        end: jest.fn(),
    } as any;

    return {
        existsSync: jest.fn<boolean, [string]>(),
        mkdirSync: jest.fn<void, [string, { recursive?: boolean }?]>(),
        readdirSync: jest.fn<string[], [string]>(),
        unlinkSync: jest.fn<void, [string]>(),
        createWriteStream: jest.fn<NodeJS.WritableStream, [string]>(() => writeStream),
    };
}

export function createMockHttpClient(): MockHttpClient {
    return {
        request: jest.fn(),
    };
}

export function createMockProcessSpawn(): MockProcessSpawn {
    return {
        spawn: jest.fn(),
    };
}

export function createMockRegistry(): MockRegistry {
    return {
        exec: jest.fn<Promise<{ stdout: string; stderr: string }>, [string]>(),
    };
}


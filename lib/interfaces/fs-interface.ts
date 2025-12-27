import * as fs from 'fs';

/**
 * File system abstraction interface for testability
 */
export interface IFileSystem {
    existsSync(path: string): boolean;
    mkdirSync(path: string, options?: { recursive?: boolean }): void;
    readdirSync(path: string): string[];
    unlinkSync(path: string): void;
    createWriteStream(path: string): NodeJS.WritableStream;
}

/**
 * Default implementation using Node.js fs module
 */
export class NodeFileSystem implements IFileSystem {
    existsSync(path: string): boolean {
        return fs.existsSync(path);
    }

    mkdirSync(path: string, options?: { recursive?: boolean }): void {
        fs.mkdirSync(path, options);
    }

    readdirSync(path: string): string[] {
        return fs.readdirSync(path);
    }

    unlinkSync(path: string): void {
        fs.unlinkSync(path);
    }

    createWriteStream(path: string): NodeJS.WritableStream {
        return fs.createWriteStream(path);
    }
}


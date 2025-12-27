import * as path from 'path';
import * as fs from 'fs';
import extractZip from 'extract-zip';
import { IFileSystem, NodeFileSystem } from './interfaces/fs-interface';
import { IHttpClient, AxiosHttpClient } from './interfaces/http-interface';
import { IProgressBarFactory } from './interfaces/progress-interface';

interface IProgress {
    loaded: number;
    total: number;
}

export interface DownloadItem {
    name: string;
    url: string;
    installerPaths?: string[]; // Specific installer file names to look for in extracted folder
}

export interface DownloadResult {
    name: string;
    path: string | string[]; // Single path or array of paths for multiple installers
    downloadSuccess: boolean;
    error: Error | undefined;
}

export interface DownloadOptions {
    downloadDir?: string;
    onProgress?: (name: string, progress: { loaded: number; total: number }) => void;
    // Dependency injection for testing
    fileSystem?: IFileSystem;
    httpClient?: IHttpClient;
    progressBarFactory?: IProgressBarFactory;
}

/**
 * Low-level function to download a file from a URL
 */
export async function downloadFile(
    url: string,
    outputPath: string,
    onProgress?: (progress: IProgress) => void,
    fileSystem?: IFileSystem,
    httpClient?: IHttpClient,
): Promise<void> {
    const fs = fileSystem || new NodeFileSystem();
    const http = httpClient || new AxiosHttpClient();

    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    const response = await http.request({
        method: 'GET',
        url: url,
        responseType: 'stream',
    });

    const totalLength = parseInt(response.headers['content-length'] || '0', 10);
    let downloadLength = 0;

    const writer = fs.createWriteStream(outputPath);
    response.data.on('data', (chunk: Buffer) => {
        downloadLength += chunk.length;
        onProgress?.({ loaded: downloadLength, total: totalLength });
    });
    response.data.on('end', () => {
        onProgress?.({ loaded: totalLength, total: totalLength });
    });
    response.data.on('error', (error: Error) => {
        throw error;
    });
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
        response.data.on('error', reject);
    });
}

/**
 * Detects if a URL points to a zip file
 */
function isZipFile(url: string): boolean {
    const urlLower = url.toLowerCase();
    return urlLower.endsWith('.zip') || urlLower.includes('.zip?');
}

/**
 * Finds the first .exe file in a directory (recursively)
 */
function findInstallerExecutable(dir: string): string | null {
    if (!fs.existsSync(dir)) {
        return null;
    }

    try {
        const entries = fs.readdirSync(dir);

        for (const entry of entries) {
            const fullPath = path.join(dir, entry);

            try {
                const stats = fs.statSync(fullPath);

                if (stats.isDirectory()) {
                    // Recursively search in subdirectories
                    const found = findInstallerExecutable(fullPath);
                    if (found) return found;
                    continue;
                }

                // Check if it's an .exe file
                if (stats.isFile() && entry.toLowerCase().endsWith('.exe')) {
                    return fullPath;
                }
            } catch {
                // Skip entries we can't stat
                continue;
            }
        }
    } catch (error) {
        // Directory read failed
    }

    return null;
}

/**
 * Finds specific installer files by name in a directory (recursively)
 * Returns array of full paths to found installers
 */
function findSpecificInstallers(dir: string, installerNames: string[]): string[] {
    if (!fs.existsSync(dir)) {
        return [];
    }

    const foundInstallers: string[] = [];
    const installerNamesLower = installerNames.map(name => name.toLowerCase());

    function searchDirectory(currentDir: string): void {
        try {
            const entries = fs.readdirSync(currentDir);

            for (const entry of entries) {
                const fullPath = path.join(currentDir, entry);

                try {
                    const stats = fs.statSync(fullPath);

                    if (stats.isDirectory()) {
                        // Recursively search in subdirectories
                        searchDirectory(fullPath);
                        continue;
                    }

                    if (stats.isFile()) {
                        const entryLower = entry.toLowerCase();
                        // Check if this file matches any of the installer names
                        for (const installerName of installerNamesLower) {
                            if (entryLower === installerName || entryLower.includes(installerName)) {
                                foundInstallers.push(fullPath);
                                break; // Found a match, no need to check other names for this file
                            }
                        }
                    }
                } catch {
                    // Skip entries we can't stat
                    continue;
                }
            }
        } catch (error) {
            // Directory read failed
        }
    }

    searchDirectory(dir);
    return foundInstallers;
}

/**
 * Extracts a zip file and finds the installer executable(s)
 * Returns a single path if one installer found, or array of paths if multiple installers specified
 */
async function extractZipAndFindInstaller(
    zipPath: string,
    extractDir: string,
    installerPaths?: string[],
    fileSystem?: IFileSystem,
): Promise<string | string[]> {
    const fsInterface = fileSystem || new NodeFileSystem();

    // Create extraction directory if it doesn't exist
    if (!fsInterface.existsSync(extractDir)) {
        fsInterface.mkdirSync(extractDir, { recursive: true });
    }

    // Extract the zip file
    await extractZip(zipPath, { dir: extractDir });

    // If specific installer paths are provided, find those
    if (installerPaths && installerPaths.length > 0) {
        const foundInstallers = findSpecificInstallers(extractDir, installerPaths);
        if (foundInstallers.length === 0) {
            throw new Error(`No installers found matching: ${installerPaths.join(', ')} in ${extractDir}`);
        }
        // Return array if multiple installers found, or single path if only one
        return foundInstallers.length === 1 ? foundInstallers[0] : foundInstallers;
    }

    // Otherwise, find the first .exe installer (backward compatibility)
    const installerPath = findInstallerExecutable(extractDir);

    if (!installerPath) {
        throw new Error(`No installer executable (.exe) found in extracted zip: ${extractDir}`);
    }

    return installerPath;
}

/**
 * Downloads a single file
 */
export async function downloadSingle(
    item: DownloadItem,
    options: DownloadOptions = {},
): Promise<DownloadResult> {
    const { downloadDir = 'C:\\Users\\ccart\\Downloads', fileSystem, httpClient } = options;
    const isZip = isZipFile(item.url);
    const downloadedFilePath = isZip
        ? `${downloadDir}\\${item.name}.zip`
        : `${downloadDir}\\${item.name}.exe`;

    try {
        await downloadFile(item.url, downloadedFilePath, (progress) => {
            options.onProgress?.(item.name, progress);
        }, fileSystem, httpClient);

        let installerPath: string | string[] = downloadedFilePath;

        // If it's a zip file, extract it and find the installer(s)
        if (isZip) {
            const extractDir = path.join(downloadDir, item.name);
            installerPath = await extractZipAndFindInstaller(
                downloadedFilePath,
                extractDir,
                item.installerPaths,
                fileSystem,
            );
        }

        return {
            name: item.name,
            path: installerPath,
            downloadSuccess: true,
            error: undefined,
        };
    } catch (error) {
        return {
            name: item.name,
            path: downloadedFilePath,
            downloadSuccess: false,
            error: error as Error,
        };
    }
}

/**
 * Downloads all files with progress bars
 */
export async function downloadAll(
    items: DownloadItem[],
    options: DownloadOptions = {},
): Promise<{ successful: DownloadResult[]; failed: DownloadResult[] }> {
    const { progressBarFactory, fileSystem, httpClient } = options;

    // Use provided factory or default implementation
    let multibar: any = null;
    if (progressBarFactory) {
        multibar = progressBarFactory.createMultiBar({});
    } else {
        // Default implementation - import only when needed to avoid circular dependency
        const { CliProgressBarFactory } = await import('./ui');
        const factory = new CliProgressBarFactory();
        multibar = factory.createMultiBar({});
    }

    const downloadPromises = items.map(async (item) => {
        const progressBar = multibar ? multibar.create(0, 0, { name: item.name }) : null;
        const { downloadDir = 'C:\\Users\\ccart\\Downloads' } = options;
        const isZip = isZipFile(item.url);
        const downloadedFilePath = isZip
            ? `${downloadDir}\\${item.name}.zip`
            : `${downloadDir}\\${item.name}.exe`;

        try {
            await downloadFile(item.url, downloadedFilePath, (progress) => {
                if (progress.total > 0 && progressBar) {
                    progressBar.setTotal(progress.total);
                    progressBar.update(progress.loaded);
                }
                options.onProgress?.(item.name, progress);
            }, fileSystem, httpClient);

            let installerPath: string | string[] = downloadedFilePath;

            // If it's a zip file, extract it and find the installer(s)
            if (isZip) {
                const extractDir = path.join(downloadDir, item.name);
                installerPath = await extractZipAndFindInstaller(
                    downloadedFilePath,
                    extractDir,
                    item.installerPaths,
                    fileSystem,
                );
            }

            if (progressBar) progressBar.stop();
            return {
                name: item.name,
                path: installerPath,
                downloadSuccess: true,
                error: undefined,
            };
        } catch (error) {
            if (progressBar) progressBar.stop();
            return {
                name: item.name,
                path: downloadedFilePath,
                downloadSuccess: false,
                error: error as Error,
            };
        }
    });

    const downloadResults = await Promise.allSettled(downloadPromises);
    if (multibar) multibar.stop();

    const successfulDownloads: DownloadResult[] = [];
    const failedDownloads: DownloadResult[] = [];

    for (const result of downloadResults) {
        if (result.status === 'fulfilled') {
            if (result.value.downloadSuccess) {
                successfulDownloads.push(result.value);
            } else {
                failedDownloads.push(result.value);
            }
        } else {
            failedDownloads.push({
                name: 'unknown',
                path: '',
                downloadSuccess: false,
                error: new Error(result.reason || 'Download failed'),
            });
        }
    }

    return { successful: successfulDownloads, failed: failedDownloads };
}

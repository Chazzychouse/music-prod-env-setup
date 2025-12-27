import * as path from 'path';
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
}

export interface DownloadResult {
    name: string;
    path: string;
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
 * Downloads a single file
 */
export async function downloadSingle(
    item: DownloadItem,
    options: DownloadOptions = {},
): Promise<DownloadResult> {
    const { downloadDir = 'C:\\Users\\ccart\\Downloads', fileSystem, httpClient } = options;
    const installerPath = `${downloadDir}\\${item.name}.exe`;

    try {
        await downloadFile(item.url, installerPath, (progress) => {
            options.onProgress?.(item.name, progress);
        }, fileSystem, httpClient);

        return {
            name: item.name,
            path: installerPath,
            downloadSuccess: true,
            error: undefined,
        };
    } catch (error) {
        return {
            name: item.name,
            path: installerPath,
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
        const installerPath = `${downloadDir}\\${item.name}.exe`;

        try {
            await downloadFile(item.url, installerPath, (progress) => {
                if (progress.total > 0 && progressBar) {
                    progressBar.setTotal(progress.total);
                    progressBar.update(progress.loaded);
                }
                options.onProgress?.(item.name, progress);
            }, fileSystem, httpClient);
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
                path: installerPath,
                downloadSuccess: false,
                error: error as Error,
            };
        }
    });

    const downloadResults = await Promise.allSettled(downloadPromises);
    if (multibar) multibar.stop();

    const successfulDownloads = downloadResults
        .filter((r): r is PromiseFulfilledResult<DownloadResult> =>
            r.status === 'fulfilled' && r.value.downloadSuccess)
        .map(r => r.value);

    const failedDownloads = downloadResults
        .filter((r): r is PromiseFulfilledResult<DownloadResult> =>
            r.status === 'fulfilled' && !r.value.downloadSuccess)
        .map(r => r.value)
        .concat(
            downloadResults
                .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
                .map(r => ({
                    name: 'unknown',
                    path: '',
                    downloadSuccess: false,
                    error: new Error(r.reason || 'Download failed'),
                })),
        );

    return { successful: successfulDownloads, failed: failedDownloads };
}

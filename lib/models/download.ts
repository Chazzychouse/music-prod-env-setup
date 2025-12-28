import { IFileSystem, IHttpClient, IProgressBarFactory } from "../interfaces";

/**
 * Progress information for download operations
 */
export type Progress = {
    loaded: number;
    total: number;
}

/**
 * Item to be downloaded
 */
export type DownloadItem = {
    name: string;
    url: string;
    installerPaths?: string[]; // Specific installer file names to look for in extracted folder
}

/**
 * Options for download operations
 */
export type DownloadOptions = {
    downloadDir?: string;
    onProgress?: (name: string, progress: Progress) => void;
    fileSystem?: IFileSystem;
    httpClient?: IHttpClient;
    progressBarFactory?: IProgressBarFactory;
}

/**
 * Result of a download operation
 */
export type DownloadResult = {
    name: string;
    path: string | string[]; // Single path or array of paths for multiple installers
    downloadSuccess: boolean;
    error: Error | undefined;
}


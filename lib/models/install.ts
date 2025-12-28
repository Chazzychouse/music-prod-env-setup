import { IProcessExecutor } from "../interfaces";

/**
 * Item to be installed
 */
export type InstallItem = {
    name: string;
    path: string | string[]; // Single path or array of paths for multiple installers
    installedAppNames?: string[]; // Names to check in registry and plugin directories (VST, AAX, etc.) for verification
    requiresManualInstallation?: boolean;
}

/**
 * Options for install operations
 */
export type InstallOptions = {
    downloadDir?: string;
    concurrent?: boolean;
}

/**
 * Result of an install operation
 */
export type InstallResult = {
    name: string;
    path: string | string[]; // Single path or array of paths for multiple installers
    installSuccess: boolean;
    error: Error | undefined;
}

/**
 * Options for orchestrating installation tasks (may involve multiple installers)
 * Used by high-level installation functions like installSingle, installAll
 */
export type InstallationTaskOptions = {
    silent?: boolean;
    timeout?: number;
    concurrent?: boolean;
    onProgress?: (name: string, elapsed: number) => void;
    onStatusChange?: (name: string, status: 'pending' | 'installing' | 'completed' | 'failed' | 'skipped') => void;
    processExecutor?: IProcessExecutor;
}


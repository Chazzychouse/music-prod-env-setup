import { IRegistryAccess } from "../interfaces/registry-interface";
import { IProcessExecutor } from "../interfaces/process-interface";

/**
 * Options for uninstall operations
 */
export type UninstallOptions = {
    silent?: boolean;
    timeout?: number;
    concurrent?: boolean;
    onProgress?: (elapsed: number) => void;
    onStatusChange?: (name: string, status: 'pending' | 'uninstalling' | 'completed' | 'failed', elapsed?: number) => void;
    registryAccess?: IRegistryAccess;
    processExecutor?: IProcessExecutor;
}

/**
 * Result of an uninstall operation
 */
export type UninstallResult = {
    name: string;
    success: boolean;
    error?: string;
}


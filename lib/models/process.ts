/**
 * Options for executing a single process (installer/uninstaller)
 * Used by low-level execution functions like executeProcess, executeInstaller
 */
export type ProcessOptions = {
    silent?: boolean;
    timeout?: number;
    args?: string[];
    elevated?: boolean;
    onProgress?: (elapsed: number) => void;
}

/**
 * Response from executing a single process (installer/uninstaller)
 * Used by low-level execution functions like executeProcess, executeInstaller
 */
export type ProcessResponse = {
    success: boolean;
    exitCode: number | null;
    error?: string;
}


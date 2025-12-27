import { IProcessExecutor, NodeProcessExecutor } from './interfaces/process-interface';
import { listInstalledPrograms } from './cleanup';

// ============================================================================
// Install Types & Interfaces
// ============================================================================

export interface InstallItem {
    name: string;
    path: string;
    installedAppNames?: string[]; // Names to check in registry for verification
    requiresManualInstallation?: boolean;
}

export interface InstallResult {
    name: string;
    path: string;
    installSuccess: boolean;
    error: Error | undefined;
}

export interface InstallOptions {
    silent?: boolean;
    timeout?: number;
    concurrent?: boolean;
    onProgress?: (name: string, elapsed: number) => void;
    onStatusChange?: (name: string, status: 'pending' | 'installing' | 'completed' | 'failed') => void;
    // Dependency injection for testing
    processExecutor?: IProcessExecutor;
}

interface ExecuteOptions {
    silent?: boolean;
    timeout?: number;
    args?: string[];
    elevated?: boolean;
    onProgress?: (elapsed: number) => void;
}

export type ProcessResponse = {
    success: boolean;
    exitCode: number | null;
    error?: string;
}

// ============================================================================
// Shared Process Execution
// ============================================================================

/**
 * Low-level function to execute a process (installer/uninstaller)
 * Exported for use by cleanup module
 */
export async function executeProcess(
    executablePath: string,
    args: string[],
    options: ExecuteOptions = {},
    processExecutor?: IProcessExecutor,
): Promise<ProcessResponse> {
    const { silent = true, timeout = 300000, onProgress } = options;
    const executor = processExecutor || new NodeProcessExecutor();

    return new Promise((resolve) => {
        const process = executor.spawn(executablePath, args, {
            stdio: silent ? 'ignore' : 'inherit',
            shell: false,
        });

        const startTime = Date.now();
        let progressInterval: NodeJS.Timeout | null = null;

        if (onProgress) {
            progressInterval = setInterval(() => {
                const elapsed = Date.now() - startTime;
                onProgress(elapsed);
            }, 100);
        }

        let timedOut = false;
        const timeoutId = timeout > 0 ? setTimeout(() => {
            timedOut = true;
            if (progressInterval) clearInterval(progressInterval);
            process.kill();
            resolve({
                success: false,
                exitCode: null,
                error: 'Process execution timed out',
            });
        }, timeout) : null;

        process.on('close', (code) => {
            if (timeoutId) clearTimeout(timeoutId);
            if (progressInterval) clearInterval(progressInterval);
            if (timedOut) return;

            resolve({
                success: code === 0,
                exitCode: code,
                error: code !== 0 ? `Process exited with code ${code}` : undefined,
            });
        });

        process.on('error', (error: NodeJS.ErrnoException) => {
            if (timeoutId) clearTimeout(timeoutId);
            if (progressInterval) clearInterval(progressInterval);

            // Provide more helpful error messages for common issues
            let errorMessage = error.message;
            if (error.code === 'EACCES') {
                errorMessage = `Access denied. This may require administrator privileges. Try running the command as administrator. (Original error: ${error.message})`;
            } else if (error.code === 'ENOENT') {
                errorMessage = `Executable not found: ${executablePath}. The uninstaller may have been moved or deleted.`;
            }

            resolve({
                success: false,
                exitCode: null,
                error: errorMessage,
            });
        });
    });
}

// ============================================================================
// Install Functions
// ============================================================================

/**
 * Gets comprehensive silent installation arguments that work for most Windows installers
 * Different Windows installers use different silent flags:
 * - NSIS: /S, /SILENT, /VERYSILENT
 * - Inno Setup: /VERYSILENT, /SP- (suppress "This will install..." prompt), 
 *               /SUPPRESSMSGBOXES (suppress message boxes), /NORESTART (prevent restart prompts)
 * - InstallShield: /s, /S, /silent
 * - Wise: /s, /S
 * 
 * Most modern installers ignore flags they don't recognize, so we can include
 * flags for multiple installer types. The order matters - more specific flags first.
 */
function getSilentArgs(): string[] {
    // Comprehensive set of silent flags that work across different installer types
    // /VERYSILENT - Most silent mode (Inno Setup, NSIS)
    // /SP- - Suppress "This will install..." prompt (Inno Setup)
    // /SUPPRESSMSGBOXES - Suppress all message boxes (Inno Setup)
    // /NORESTART - Prevent restart prompts (Inno Setup)
    // /SILENT - Standard silent mode (NSIS, InstallShield)
    // /S - Minimal silent flag (NSIS, InstallShield, Wise)
    return ['/VERYSILENT', '/SP-', '/SUPPRESSMSGBOXES', '/NORESTART', '/SILENT', '/S'];
}

/**
 * Low-level function to execute an installer with improved silent installation support
 * Uses comprehensive silent flags that work for most Windows installer types
 */
export async function executeInstaller(
    installerPath: string,
    options: ExecuteOptions = {},
    processExecutor?: IProcessExecutor,
): Promise<ProcessResponse> {
    const { silent = true, args = [] } = options;

    if (!silent) {
        return executeProcess(installerPath, args, options, processExecutor);
    }

    // Use comprehensive silent flags that work for most installers
    // Most installers ignore flags they don't recognize, so including
    // flags for multiple installer types is safe
    const silentArgs = getSilentArgs();
    const allArgs = [...silentArgs, ...args];

    return executeProcess(installerPath, allArgs, options, processExecutor);
}

/**
 * Verifies if a program is installed by checking the Windows registry
 * Returns true if any of the provided app names are found in the registry
 */
async function verifyInstallation(installedAppNames: string[]): Promise<boolean> {
    if (!installedAppNames || installedAppNames.length === 0) {
        return false;
    }

    try {
        // Wait a brief moment for registry to update
        await new Promise(resolve => setTimeout(resolve, 1000));

        const allPrograms = await listInstalledPrograms();
        const allProgramsLower = allPrograms.map(p => p.toLowerCase());

        // Check if any of the expected app names are found in the registry
        return installedAppNames.some(appName => {
            const appNameLower = appName.toLowerCase();
            return allProgramsLower.some(program =>
                program === appNameLower || program.includes(appNameLower)
            );
        });
    } catch (error) {
        // If verification fails, assume not installed
        return false;
    }
}

/**
 * Installs a single item
 */
export async function installSingle(
    item: InstallItem,
    options: InstallOptions = {},
): Promise<InstallResult> {
    const { silent = true, timeout = 300000, onProgress, onStatusChange, processExecutor } = options;

    // If manual installation is required, launch installer without silent flags
    // and wait for the user to complete the wizard
    if (item.requiresManualInstallation) {
        onStatusChange?.(item.name, 'installing');

        // Launch installer in non-silent mode so user can interact with it
        // executeInstaller will wait for the process to complete (when user closes the installer)
        const result = await executeInstaller(item.path, {
            silent: false,  // Show GUI for manual installation
            timeout,
            onProgress: (elapsed) => {
                onProgress?.(item.name, elapsed);
            },
        }, processExecutor);

        // After the installer process completes (user closed the wizard),
        // verify if the installation was successful
        if (item.installedAppNames && item.installedAppNames.length > 0) {
            // Wait a moment for registry to update after installer closes
            await new Promise(resolve => setTimeout(resolve, 2000));
            const isInstalled = await verifyInstallation(item.installedAppNames);
            if (isInstalled) {
                onStatusChange?.(item.name, 'completed');
                return {
                    name: item.name,
                    path: item.path,
                    installSuccess: true,
                    error: undefined,
                };
            }
        }

        // If we can't verify or verification failed, check the exit code
        // Exit code 0 typically means success, but some installers may use different codes
        // For manual installations, we're more lenient - if the process completed
        // without error, we assume the user completed the installation
        const installSuccess = result.success || result.exitCode === 0;
        onStatusChange?.(item.name, installSuccess ? 'completed' : 'failed');
        return {
            name: item.name,
            path: item.path,
            installSuccess,
            error: installSuccess ? undefined : new Error(result.error || 'Installation wizard was closed or cancelled'),
        };
    }

    try {
        const result = await executeInstaller(item.path, {
            silent,
            timeout,
            onProgress: (elapsed) => {
                onProgress?.(item.name, elapsed);
            },
        }, processExecutor);

        // If installation reported failure or timeout, verify if it actually succeeded
        if (!result.success) {
            // Check if the program is actually installed despite the failure report
            if (item.installedAppNames && item.installedAppNames.length > 0) {
                const isInstalled = await verifyInstallation(item.installedAppNames);
                if (isInstalled) {
                    // Program is installed - mark as successful despite timeout/failure
                    onStatusChange?.(item.name, 'completed');
                    return {
                        name: item.name,
                        path: item.path,
                        installSuccess: true,
                        error: undefined,
                    };
                }
            }

            // Verification failed or no app names provided - mark as failed
            onStatusChange?.(item.name, 'failed');
            return {
                name: item.name,
                path: item.path,
                installSuccess: false,
                error: new Error(result.error || 'Installation failed'),
            };
        }

        onStatusChange?.(item.name, 'completed');
        return {
            name: item.name,
            path: item.path,
            installSuccess: true,
            error: undefined,
        };
    } catch (error) {
        // On exception, also verify installation if app names are provided
        if (item.installedAppNames && item.installedAppNames.length > 0) {
            const isInstalled = await verifyInstallation(item.installedAppNames);
            if (isInstalled) {
                onStatusChange?.(item.name, 'completed');
                return {
                    name: item.name,
                    path: item.path,
                    installSuccess: true,
                    error: undefined,
                };
            }
        }

        onStatusChange?.(item.name, 'failed');
        return {
            name: item.name,
            path: item.path,
            installSuccess: false,
            error: error as Error,
        };
    }
}

/**
 * Installs items sequentially
 */
export async function installSequentially(
    items: InstallItem[],
    options: InstallOptions = {},
): Promise<InstallResult[]> {
    const { onStatusChange } = options;
    const installResults: InstallResult[] = [];

    items.forEach(item => {
        onStatusChange?.(item.name, 'pending');
    });

    for (const item of items) {
        const result = await installSingle(item, options);
        installResults.push(result);
    }

    return installResults;
}

/**
 * Installs items concurrently
 */
export async function installConcurrently(
    items: InstallItem[],
    options: InstallOptions = {},
): Promise<InstallResult[]> {
    const { onStatusChange } = options;

    items.forEach(item => {
        onStatusChange?.(item.name, 'pending');
    });

    const settledResults = await Promise.allSettled(
        items.map(item => installSingle(item, options)),
    );

    return settledResults.map((result, index) => {
        if (result.status === 'fulfilled') {
            return result.value;
        } else {
            const item = items[index];
            onStatusChange?.(item?.name || 'unknown', 'failed');
            return {
                name: item?.name || 'unknown',
                path: item?.path || '',
                installSuccess: false,
                error: new Error(result.reason || 'Installation failed'),
            };
        }
    });
}

/**
 * Installs all items (with mode selection)
 */
export async function installAll(
    items: InstallItem[],
    options: InstallOptions = {},
): Promise<InstallResult[]> {
    if (options.concurrent) {
        return installConcurrently(items, options);
    } else {
        return installSequentially(items, options);
    }
}


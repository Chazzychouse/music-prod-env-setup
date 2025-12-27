import { IProcessExecutor, NodeProcessExecutor } from './interfaces/process-interface';
import { listInstalledPrograms } from './cleanup';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Install Types & Interfaces
// ============================================================================

export interface InstallItem {
    name: string;
    path: string | string[]; // Single path or array of paths for multiple installers
    installedAppNames?: string[]; // Names to check in registry and plugin directories (VST, AAX, etc.) for verification
    requiresManualInstallation?: boolean;
}

export interface InstallResult {
    name: string;
    path: string | string[]; // Single path or array of paths for multiple installers
    installSuccess: boolean;
    error: Error | undefined;
}

export interface InstallOptions {
    silent?: boolean;
    timeout?: number;
    concurrent?: boolean;
    onProgress?: (name: string, elapsed: number) => void;
    onStatusChange?: (name: string, status: 'pending' | 'installing' | 'completed' | 'failed' | 'skipped') => void;
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
            } else if (error.code === 'EFTYPE') {
                errorMessage = `Cannot execute file directly: ${executablePath}. This may be an MSI file that needs to be run with msiexec.exe, or the file may be corrupted.`;
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
 * Handles MSI files by using msiexec.exe
 */
export async function executeInstaller(
    installerPath: string,
    options: ExecuteOptions = {},
    processExecutor?: IProcessExecutor,
): Promise<ProcessResponse> {
    const { silent = true, args = [] } = options;

    // Check if this is an MSI file
    const isMsiFile = installerPath.toLowerCase().endsWith('.msi');

    if (isMsiFile) {
        // MSI files must be executed using msiexec.exe
        // msiexec.exe /i <path> /qn for silent installation
        // /qn = quiet, no UI
        // /qb = basic UI (progress bar only)
        const msiArgs = silent
            ? ['/i', installerPath, '/qn', '/norestart']  // Silent install
            : ['/i', installerPath, '/qb'];  // Show basic UI for manual installation

        // Add any additional args provided
        const allArgs = [...msiArgs, ...args];

        return executeProcess('msiexec.exe', allArgs, options, processExecutor);
    }

    // For non-MSI files, use the original logic
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
 * Recursively searches a directory for files matching plugin names
 * Returns true if any matching file is found
 */
function searchRecursivelyForPlugin(
    dirPath: string,
    pluginNameLower: string,
    maxDepth: number = 20
): boolean {
    if (maxDepth <= 0) {
        return false;
    }

    try {
        if (!fs.existsSync(dirPath)) {
            return false;
        }

        const items = fs.readdirSync(dirPath, { withFileTypes: true });

        for (const item of items) {
            const itemPath = path.join(dirPath, item.name);
            const itemNameLower = item.name.toLowerCase();

            if (item.isFile()) {
                // Check if the file name contains the plugin name
                if (itemNameLower.includes(pluginNameLower)) {
                    return true;
                }
            } else if (item.isDirectory()) {
                // Recursively search subdirectories
                if (searchRecursivelyForPlugin(itemPath, pluginNameLower, maxDepth - 1)) {
                    return true;
                }
            }
        }
    } catch {
        // Skip directories we can't read
        return false;
    }

    return false;
}

/**
 * Recursively finds all files matching plugin names in a directory
 * Returns an array of file paths that match
 */
function findMatchingFilesRecursively(
    dirPath: string,
    pluginNameLower: string,
    maxDepth: number = 20
): string[] {
    const matchingFiles: string[] = [];

    if (maxDepth <= 0) {
        return matchingFiles;
    }

    try {
        if (!fs.existsSync(dirPath)) {
            return matchingFiles;
        }

        const items = fs.readdirSync(dirPath, { withFileTypes: true });

        for (const item of items) {
            const itemPath = path.join(dirPath, item.name);
            const itemNameLower = item.name.toLowerCase();

            if (item.isFile()) {
                // Check if the file name contains the plugin name
                if (itemNameLower.includes(pluginNameLower)) {
                    matchingFiles.push(itemPath);
                }
            } else if (item.isDirectory()) {
                // Recursively search subdirectories
                matchingFiles.push(...findMatchingFilesRecursively(itemPath, pluginNameLower, maxDepth - 1));
            }
        }
    } catch {
        // Skip directories we can't read
    }

    return matchingFiles;
}

/**
 * Plugin directory configuration
 * Defines all plugin types and their search directories
 */
const PLUGIN_DIRECTORIES = [
    // VST plugins
    'C:\\Program Files\\Common Files\\VST3',
    'C:\\Program Files\\Common Files\\VST2',
    'C:\\Program Files (x86)\\VSTPlugIns',
    // AAX plugins
    'C:\\Program Files\\Common Files\\Avid\\Audio\\Plug-Ins',
];

/**
 * Lists installed plugins matching the provided plugin names
 * Checks all plugin directories (VST, AAX, etc.)
 * Returns an array of matching plugin names found
 * Searches recursively through all subdirectories
 */
export async function listInstalledPlugins(pluginNames: string[]): Promise<string[]> {
    if (!pluginNames || pluginNames.length === 0) {
        return [];
    }

    const foundPlugins = new Set<string>();

    try {
        for (const pluginDir of PLUGIN_DIRECTORIES) {
            if (!fs.existsSync(pluginDir)) {
                continue;
            }

            for (const pluginName of pluginNames) {
                const pluginNameLower = pluginName.toLowerCase();

                // Search recursively for matching plugin files
                const matchingFiles = findMatchingFilesRecursively(pluginDir, pluginNameLower);

                // Extract meaningful names from the found files
                for (const filePath of matchingFiles) {
                    const fileName = path.basename(filePath);
                    const fileNameWithoutExt = path.parse(fileName).name;
                    // Use the actual file name (without extension) instead of the configured plugin name
                    foundPlugins.add(fileNameWithoutExt);
                }
            }
        }
    } catch (error) {
        // If checking fails, return empty array
        return [];
    }

    return Array.from(foundPlugins);
}

/**
 * Recursively removes empty directories starting from the deepest level
 */
function removeEmptyDirectoriesRecursively(dirPath: string, maxDepth: number = 20): void {
    if (maxDepth <= 0 || !fs.existsSync(dirPath)) {
        return;
    }

    try {
        const items = fs.readdirSync(dirPath, { withFileTypes: true });

        // First, recursively process subdirectories
        for (const item of items) {
            if (item.isDirectory()) {
                const subDirPath = path.join(dirPath, item.name);
                removeEmptyDirectoriesRecursively(subDirPath, maxDepth - 1);
            }
        }

        // After processing subdirectories, check if this directory is now empty
        const remainingItems = fs.readdirSync(dirPath);
        if (remainingItems.length === 0) {
            try {
                fs.rmdirSync(dirPath);
            } catch {
                // Ignore errors - directory might not be empty or we might not have permissions
            }
        }
    } catch {
        // Ignore errors when checking directories
    }
}

/**
 * Removes plugins matching the provided plugin names from all plugin directories
 * Returns the number of plugins successfully removed
 * Searches recursively through all subdirectories
 */
export async function removePlugins(pluginNames: string[]): Promise<{ removed: number; errors: string[] }> {
    if (!pluginNames || pluginNames.length === 0) {
        return { removed: 0, errors: [] };
    }

    let removed = 0;
    const errors: string[] = [];
    const topLevelDirsToCheck: Set<string> = new Set();

    try {
        for (const pluginDir of PLUGIN_DIRECTORIES) {
            if (!fs.existsSync(pluginDir)) {
                continue;
            }

            const rootItems = fs.readdirSync(pluginDir, { withFileTypes: true });

            for (const pluginName of pluginNames) {
                const pluginNameLower = pluginName.toLowerCase();

                // Check root level for plugins (files)
                for (const item of rootItems) {
                    if (item.isFile()) {
                        const itemNameLower = item.name.toLowerCase();
                        if (itemNameLower.includes(pluginNameLower)) {
                            const filePath = path.join(pluginDir, item.name);
                            try {
                                fs.unlinkSync(filePath);
                                removed++;
                            } catch (error) {
                                errors.push(`Failed to remove ${filePath}: ${(error as Error).message}`);
                            }
                        }
                    }
                }

                // Search recursively in all subdirectories
                for (const item of rootItems) {
                    if (item.isDirectory()) {
                        const subDirPath = path.join(pluginDir, item.name);
                        const matchingFiles = findMatchingFilesRecursively(subDirPath, pluginNameLower);

                        if (matchingFiles.length > 0) {
                            // Track the top-level directory for cleanup
                            topLevelDirsToCheck.add(subDirPath);

                            // Remove all matching files
                            for (const filePath of matchingFiles) {
                                try {
                                    fs.unlinkSync(filePath);
                                    removed++;
                                } catch (error) {
                                    errors.push(`Failed to remove ${filePath}: ${(error as Error).message}`);
                                }
                            }

                            // For VST3 plugins, if the top-level directory name matches the plugin,
                            // remove the entire directory (e.g., "TAL-Chorus-LX.vst3" folder)
                            const dirNameLower = item.name.toLowerCase();
                            if (dirNameLower.includes(pluginNameLower) && dirNameLower.endsWith('.vst3')) {
                                try {
                                    // Remove the entire directory recursively
                                    fs.rmSync(subDirPath, { recursive: true, force: true });
                                    removed++;
                                    topLevelDirsToCheck.delete(subDirPath); // Already removed
                                } catch (error) {
                                    errors.push(`Failed to remove directory ${subDirPath}: ${(error as Error).message}`);
                                }
                            }
                        }
                    }
                }
            }
        }

        // Try to remove empty directories recursively
        for (const dirPath of topLevelDirsToCheck) {
            if (fs.existsSync(dirPath)) {
                removeEmptyDirectoriesRecursively(dirPath);
            }
        }
    } catch (error) {
        errors.push(`Error during plugin removal: ${(error as Error).message}`);
    }

    return { removed, errors };
}

/**
 * Checks if plugins exist in all plugin directories
 * Returns true if any of the provided plugin names are found
 */
async function checkPlugins(pluginNames: string[]): Promise<boolean> {
    if (!pluginNames || pluginNames.length === 0) {
        return false;
    }
    const foundPlugins = await listInstalledPlugins(pluginNames);
    return foundPlugins.length > 0;
}

/**
 * Verifies if a program is installed by checking the Windows registry and all plugin directories
 * Returns true if any of the provided app names are found in the registry or plugins are found
 */
async function verifyInstallation(
    installedAppNames?: string[]
): Promise<boolean> {
    // Check registry if app names provided
    let registryCheck = false;
    if (installedAppNames && installedAppNames.length > 0) {
        try {
            // Wait a brief moment for registry to update
            await new Promise(resolve => setTimeout(resolve, 1000));

            const allPrograms = await listInstalledPrograms();
            const allProgramsLower = allPrograms.map(p => p.toLowerCase());

            // Check if any of the expected app names are found in the registry
            registryCheck = installedAppNames.some(appName => {
                const appNameLower = appName.toLowerCase();
                return allProgramsLower.some(program =>
                    program === appNameLower || program.includes(appNameLower)
                );
            });
        } catch (error) {
            // If verification fails, assume not installed
            registryCheck = false;
        }
    }

    // Check plugins in all directories (VST, AAX, etc.) using the same app names
    const pluginCheck = await checkPlugins(installedAppNames || []);

    // Return true if any check passes
    return registryCheck || pluginCheck;
}

/**
 * Installs a single item (may have multiple installers)
 */
export async function installSingle(
    item: InstallItem,
    options: InstallOptions = {},
): Promise<InstallResult> {
    const { silent = true, timeout = 300000, onProgress, onStatusChange, processExecutor } = options;

    // Normalize path to array for consistent handling
    const installerPaths = Array.isArray(item.path) ? item.path : [item.path];

    // Check if software is already installed before attempting installation
    if (item.installedAppNames && item.installedAppNames.length > 0) {
        const isAlreadyInstalled = await verifyInstallation(item.installedAppNames);
        if (isAlreadyInstalled) {
            onStatusChange?.(item.name, 'skipped');
            return {
                name: item.name,
                path: item.path,
                installSuccess: true,
                error: undefined,
            };
        }
    }

    // If manual installation is required, launch installers without silent flags
    // and wait for the user to complete each wizard
    if (item.requiresManualInstallation) {
        onStatusChange?.(item.name, 'installing');

        // Install each installer sequentially
        for (let i = 0; i < installerPaths.length; i++) {
            const installerPath = installerPaths[i];
            const result = await executeInstaller(installerPath, {
                silent: false,  // Show GUI for manual installation
                timeout,
                onProgress: (elapsed) => {
                    onProgress?.(item.name, elapsed);
                },
            }, processExecutor);

            // If this installer failed to launch, return error
            if (result.exitCode === null) {
                onStatusChange?.(item.name, 'failed');
                return {
                    name: item.name,
                    path: item.path,
                    installSuccess: false,
                    error: new Error(result.error || `Installation wizard failed to launch for ${installerPath}`),
                };
            }
        }

        // After all installers complete (user closed all wizards),
        // verify if the installation was successful
        if (item.installedAppNames && item.installedAppNames.length > 0) {
            // Wait a moment for registry to update after installers close
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

        // For manual installations, be very lenient with exit codes
        // Many installers spawn a launcher process that exits immediately while
        // the actual installer wizard runs in a child process. We should only
        // fail if there was an actual error event (like file not found, access denied, etc.)
        // A non-zero exit code from a launcher doesn't necessarily mean failure.
        // If all processes closed (exitCode !== null), assume the user will complete
        // the installation through the wizard. Only fail if there was an error event.
        onStatusChange?.(item.name, 'completed');
        return {
            name: item.name,
            path: item.path,
            installSuccess: true,
            error: undefined,
        };
    }

    try {
        // Install each installer sequentially
        let lastError: Error | undefined = undefined;
        for (let i = 0; i < installerPaths.length; i++) {
            const installerPath = installerPaths[i];
            const result = await executeInstaller(installerPath, {
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

                // Store error but continue with other installers
                lastError = new Error(result.error || `Installation failed for ${installerPath}`);
            }
        }

        // If we had errors and verification didn't pass, mark as failed
        if (lastError) {
            // Final verification check
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
                error: lastError,
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



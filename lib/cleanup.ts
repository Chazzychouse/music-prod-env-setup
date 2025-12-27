import * as path from 'path';
import * as fs from 'fs';
import * as child_process from 'child_process';
import { promisify } from 'util';
import { executeProcess, ProcessResponse } from './install';
import { IFileSystem, NodeFileSystem } from './interfaces/fs-interface';
import { IRegistryAccess, NodeRegistryAccess } from './interfaces/registry-interface';
import { IProcessExecutor } from './interfaces/process-interface';

const exec = promisify(child_process.exec);

// ============================================================================
// File Cleanup Types & Interfaces
// ============================================================================

export interface DeleteResult {
    name: string;
    path: string;
    deleted: boolean;
    error?: Error;
}

// ============================================================================
// Process Cleanup Helpers
// ============================================================================

/**
 * Finds and kills processes that are using a specific file
 * Uses PowerShell to find processes by executable name and command line
 */
async function killProcessesUsingFile(filePath: string): Promise<{ killed: number; errors: string[] }> {
    const errors: string[] = [];
    let killed = 0;

    try {
        // Get the executable name without extension (e.g., "fl-studio" from "fl-studio.exe")
        const fileNameWithoutExt = path.basename(filePath, path.extname(filePath));
        // Also get the full filename (e.g., "fl-studio.exe")
        const fileName = path.basename(filePath);

        // Escape the file path for PowerShell (escape single quotes by doubling them)
        const escapedPath = filePath.replace(/'/g, "''");
        // For WMI queries, we need to escape backslashes
        const escapedPathForWmi = filePath.replace(/\\/g, '\\\\');

        // Strategy 1: Kill processes by executable name (most common case)
        // This catches processes like "fl-studio.exe" that are still running
        try {
            const psCommand = `Get-Process -Name '${fileNameWithoutExt}' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue`;
            await exec(`powershell -Command "${psCommand}"`);
            killed += 1; // Assume at least one was found if no error
        } catch (error) {
            // Process might not exist, which is fine - continue to other methods
        }

        // Strategy 2: Find processes by command line containing the file path
        // This catches processes that were launched with the installer file as an argument
        try {
            const wmiCommand = `$processes = Get-WmiObject Win32_Process | Where-Object { $_.CommandLine -like '*${escapedPathForWmi}*' }; if ($processes) { $processes | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } }`;
            await exec(`powershell -Command "${wmiCommand}"`);
        } catch (error) {
            // WMI might fail due to permissions or no processes found - that's okay
            // Don't add to errors as this is expected to fail sometimes
        }

        // Strategy 3: Also try by the exact filename in case the process name matches
        // Some installers might keep a process running with the same name
        try {
            const psCommand2 = `Get-Process | Where-Object { $_.Path -eq '${escapedPath}' } | Stop-Process -Force -ErrorAction SilentlyContinue`;
            await exec(`powershell -Command "${psCommand2}"`);
        } catch (error) {
            // Process might not exist, which is fine
        }

        // Wait a bit for file handles to be released
        await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
        errors.push(`Failed to kill processes: ${(error as Error).message}`);
    }

    return { killed, errors };
}

// ============================================================================
// Uninstall Types & Interfaces
// ============================================================================

export interface UninstallOptions {
    silent?: boolean;
    timeout?: number;
    concurrent?: boolean;
    onProgress?: (elapsed: number) => void;
    onStatusChange?: (name: string, status: 'pending' | 'uninstalling' | 'completed' | 'failed', elapsed?: number) => void;
    // Dependency injection for testing
    registryAccess?: IRegistryAccess;
    processExecutor?: IProcessExecutor;
}

export interface UninstallResult {
    name: string;
    success: boolean;
    error?: string;
}

// ============================================================================
// File Cleanup Functions
// ============================================================================

/**
 * Deletes a single downloaded file
 * If the file is locked (EBUSY), attempts to kill processes using it and retries
 */
export async function deleteDownload(
    filePath: string,
    fileSystem?: IFileSystem,
): Promise<{ success: boolean; error?: Error }> {
    const fileSys = fileSystem || new NodeFileSystem();

    try {
        if (!fileSys.existsSync(filePath)) {
            return { success: false, error: new Error(`File does not exist: ${filePath}`) };
        }

        // Check if it's a directory
        const stats = fs.statSync(filePath);
        if (stats.isDirectory()) {
            // Remove directory recursively
            fs.rmSync(filePath, { recursive: true, force: true });
            return { success: true };
        } else {
            // It's a file, use unlinkSync
            fileSys.unlinkSync(filePath);
            return { success: true };
        }
    } catch (error) {
        const err = error as NodeJS.ErrnoException;

        // If the file is busy/locked, try to kill processes using it and retry
        if (err.code === 'EBUSY' || err.message?.includes('resource busy') || err.message?.includes('locked')) {
            try {
                // Kill processes using the file
                await killProcessesUsingFile(filePath);

                // Wait a bit longer for file handles to be released
                await new Promise(resolve => setTimeout(resolve, 1000));

                // Retry deletion
                if (fileSys.existsSync(filePath)) {
                    const stats = fs.statSync(filePath);
                    if (stats.isDirectory()) {
                        fs.rmSync(filePath, { recursive: true, force: true });
                    } else {
                        fileSys.unlinkSync(filePath);
                    }
                    return { success: true };
                } else {
                    // File was deleted by the process cleanup
                    return { success: true };
                }
            } catch (retryError) {
                // If retry also fails, return the original error
                return { success: false, error: err };
            }
        }

        return { success: false, error: err };
    }
}

/**
 * Deletes multiple downloaded files
 */
export async function deleteDownloads(
    filePaths: string[],
    fileSystem?: IFileSystem,
): Promise<DeleteResult[]> {
    const results: DeleteResult[] = [];

    for (const filePath of filePaths) {
        const fileName = path.basename(filePath);
        const result = await deleteDownload(filePath, fileSystem);
        results.push({
            name: fileName,
            path: filePath,
            deleted: result.success,
            error: result.error,
        });
    }

    return results;
}

/**
 * Deletes all downloads from a directory matching the pattern
 */
export async function deleteAllDownloads(
    downloadDir: string,
    pattern?: string,
    fileSystem?: IFileSystem,
): Promise<DeleteResult[]> {
    const fileSys = fileSystem || new NodeFileSystem();

    try {
        if (!fileSys.existsSync(downloadDir)) {
            return [];
        }

        const items = fileSys.readdirSync(downloadDir);
        let itemsToDelete: string[];

        if (pattern) {
            // If pattern provided, filter by pattern
            itemsToDelete = items.filter(item => item.includes(pattern));
        } else {
            // If no pattern, include .exe files, .zip files, and directories
            itemsToDelete = items.filter(item => {
                const itemPath = path.join(downloadDir, item);
                // Check if it's a directory
                try {
                    const stats = fs.statSync(itemPath);
                    if (stats.isDirectory()) {
                        return true;
                    }
                } catch {
                    // If we can't stat it, skip it
                }
                // Check if it's a .exe or .zip file
                return item.endsWith('.exe') || item.endsWith('.zip');
            });
        }

        const itemPaths = itemsToDelete.map(f => path.join(downloadDir, f));
        return await deleteDownloads(itemPaths, fileSystem);
    } catch (error) {
        throw new Error(`Failed to delete downloads from ${downloadDir}: ${(error as Error).message}`);
    }
}

/**
 * Gets all downloaded files from a directory
 * Includes .exe files, .zip files, and folders
 */
export function getDownloadedFiles(
    downloadDir: string,
    pattern?: string,
    fileSystem?: IFileSystem,
): string[] {
    const fileSys = fileSystem || new NodeFileSystem();

    try {
        if (!fileSys.existsSync(downloadDir)) {
            return [];
        }

        const items = fileSys.readdirSync(downloadDir);
        let filteredItems: string[];

        if (pattern) {
            // If pattern provided, filter by pattern
            filteredItems = items.filter(item => item.includes(pattern));
        } else {
            // If no pattern, include .exe files, .zip files, and directories
            filteredItems = items.filter(item => {
                const itemPath = path.join(downloadDir, item);
                // Check if it's a directory using Node.js fs directly
                try {
                    const stats = fs.statSync(itemPath);
                    if (stats.isDirectory()) {
                        return true;
                    }
                } catch {
                    // If we can't stat it, skip it
                }
                // Check if it's a .exe or .zip file
                return item.endsWith('.exe') || item.endsWith('.zip');
            });
        }

        return filteredItems.map(f => path.join(downloadDir, f));
    } catch (error) {
        throw new Error(`Failed to read downloads directory ${downloadDir}: ${(error as Error).message}`);
    }
}

// ============================================================================
// Uninstall Functions
// ============================================================================

/**
 * Finds the uninstall string for a program from Windows registry
 */
export async function findUninstallString(
    programName: string,
    registryAccess?: IRegistryAccess,
): Promise<string | null> {
    const registry = registryAccess || new NodeRegistryAccess();

    try {
        const registryPaths = [
            'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
            'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
        ];

        // Escape the program name for PowerShell
        // Replace single quotes with two single quotes (PowerShell escaping)
        // Then wrap the entire pattern in single quotes to prevent interpretation of special chars
        const escapedProgramName = programName.replace(/'/g, "''");

        for (const regPath of registryPaths) {
            try {
                // Use -like with wildcards and properly escaped program name
                // The pattern is wrapped in single quotes in the PowerShell command
                const { stdout } = await registry.exec(
                    `powershell -Command "Get-ItemProperty ${regPath} | Where-Object { $_.DisplayName -like '*${escapedProgramName}*' } | Select-Object -First 1 -ExpandProperty UninstallString"`,
                );
                const uninstallString = stdout.trim();
                if (uninstallString && uninstallString.length > 0) {
                    return uninstallString;
                }
            } catch (error) {
                // Continue to next registry path
            }
        }

        return null;
    } catch (error) {
        return null;
    }
}

/**
 * Uninstalls a program by name (searches registry for uninstall string)
 */
export async function uninstallByName(
    programName: string,
    options: UninstallOptions = {},
): Promise<{ success: boolean; error?: string }> {
    const { silent = true, timeout = 300000, onProgress, registryAccess, processExecutor } = options;

    const uninstallString = await findUninstallString(programName, registryAccess);
    if (!uninstallString) {
        return { success: false, error: `Could not find uninstall string for ${programName}` };
    }

    // Check if this is an MSI-based uninstall
    // MSI uninstall strings can be:
    // - msiexec.exe /x {ProductCode}
    // - msiexec.exe /x "path\to\file.msi"
    // - "path\to\file.msi" (just the MSI file path)
    const isMsiUninstall = uninstallString.toLowerCase().includes('msiexec') ||
        uninstallString.toLowerCase().endsWith('.msi') ||
        /\.msi\s/i.test(uninstallString);

    let executable: string;
    let args: string[];

    if (isMsiUninstall) {
        // Handle MSI uninstall
        if (uninstallString.toLowerCase().includes('msiexec')) {
            // Parse msiexec command: msiexec.exe /x {ProductCode} or msiexec.exe /x "path.msi"
            // Handle both "msiexec.exe" and just "msiexec"
            const msiMatch = uninstallString.match(/msiexec(?:\.exe)?\s+(.+)/i);
            if (msiMatch) {
                executable = 'msiexec.exe';
                let existingArgsStr = msiMatch[1].trim();

                // Replace /i with /x if present (install flag -> uninstall flag)
                existingArgsStr = existingArgsStr.replace(/\/([ix])(\s|$|\{)/gi, (match, flag, suffix) => {
                    return flag.toLowerCase() === 'i' ? '/x' + suffix : match;
                });

                // Simple argument parsing - split by spaces but preserve quoted strings and braces
                const parsedArgs: string[] = [];
                const regex = /(?:[^\s"]+|"[^"]*"|\{[^}]*\})+/g;
                let match;
                while ((match = regex.exec(existingArgsStr)) !== null) {
                    parsedArgs.push(match[0].trim());
                }

                // Ensure /x is present (for uninstall)
                const hasX = parsedArgs.some(arg => {
                    const argLower = arg.toLowerCase();
                    return argLower === '/x' || argLower.startsWith('/x{') || argLower.startsWith('/x"');
                });

                if (!hasX) {
                    // Add /x at the beginning
                    parsedArgs.unshift('/x');
                }

                // Add silent flag if needed (MSI uses /qn, /qb, /qr, not /S)
                const hasQuietFlag = parsedArgs.some(arg => {
                    const argLower = arg.toLowerCase();
                    return argLower === '/qn' || argLower === '/qb' || argLower === '/qr' ||
                        argLower.startsWith('/q') && argLower.length === 3;
                });
                if (silent && !hasQuietFlag) {
                    parsedArgs.push('/qn', '/norestart');
                } else if (!silent && !hasQuietFlag) {
                    parsedArgs.push('/qb');
                }

                args = parsedArgs;
            } else {
                return { success: false, error: `Invalid MSI uninstall string format: ${uninstallString}` };
            }
        } else {
            // Just an MSI file path - need to use msiexec.exe /x
            const msiPath = uninstallString.trim().replace(/^["']|["']$/g, ''); // Remove quotes
            executable = 'msiexec.exe';
            args = ['/x', msiPath];
            if (silent) {
                args.push('/qn', '/norestart');
            } else {
                args.push('/qb');
            }
        }
    } else {
        // Handle non-MSI uninstall (regular executables)
        // Extract the executable and arguments
        // Handle both quoted and unquoted paths
        let existingArgsStr: string;

        if (uninstallString.startsWith('"')) {
            // Quoted path: "C:\Program Files\..." /arg1 /arg2
            const endQuote = uninstallString.indexOf('"', 1);
            if (endQuote === -1) {
                return { success: false, error: `Invalid uninstall string format: ${uninstallString}` };
            }
            executable = uninstallString.substring(1, endQuote);
            existingArgsStr = uninstallString.substring(endQuote + 1).trim();
        } else {
            // Unquoted path: try to find where executable ends and args begin
            // Look for common argument patterns like /S, /SILENT, etc. or space-separated args
            // For unquoted paths with spaces, we need to be smarter
            // Common pattern: C:\Program Files\...\uninstall.exe /S
            // We'll try to find the .exe or similar extension first
            const exeMatch = uninstallString.match(/^(.+\.(exe|bat|cmd))(?:\s+(.*))?$/i);
            if (exeMatch) {
                executable = exeMatch[1];
                existingArgsStr = exeMatch[3] || '';
            } else {
                // Fallback: split on first space (may not work for paths with spaces)
                const spaceIndex = uninstallString.indexOf(' ');
                if (spaceIndex === -1) {
                    executable = uninstallString;
                    existingArgsStr = '';
                } else {
                    executable = uninstallString.substring(0, spaceIndex);
                    existingArgsStr = uninstallString.substring(spaceIndex + 1).trim();
                }
            }
        }

        // Parse existing arguments (split by spaces, but preserve quoted strings)
        const existingArgs = existingArgsStr ? existingArgsStr.split(/\s+(?=(?:[^"]*"[^"]*")*[^"]*$)/).filter(arg => arg.trim()) : [];

        // Add silent flags if not already present (for non-MSI installers)
        const hasSilentFlag = existingArgs.some(arg =>
            arg.includes('/S') || arg.includes('/SILENT') || arg.includes('/VERYSILENT'),
        );
        const silentArgs = silent && !hasSilentFlag
            ? ['/S', '/SILENT', '/VERYSILENT']
            : [];

        args = [...existingArgs, ...silentArgs];
    }

    // Execute the uninstall process
    const processResult = await executeProcess(executable, args, {
        silent,
        timeout,
        onProgress,
    }, processExecutor);

    // Verify uninstall success by checking if the program is still in the registry
    // Some uninstallers return non-zero exit codes even when they succeed
    // Use retry logic with exponential backoff to handle registry update delays
    // This is especially important for concurrent uninstalls where registry queries
    // might conflict or see stale data

    const maxRetries = 5;
    const initialDelay = 500; // Start with 500ms
    let delay = initialDelay;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        // Wait before checking registry (staggered delay to avoid conflicts)
        await new Promise(resolve => setTimeout(resolve, delay));

        const stillInstalled = await findUninstallString(programName, registryAccess);

        if (!stillInstalled) {
            // Program is no longer in registry - uninstall succeeded regardless of exit code
            return { success: true };
        }

        // If process reported failure and we've checked at least once, don't retry
        if (!processResult.success && attempt >= 1) {
            break;
        }

        // Exponential backoff: 500ms, 1000ms, 2000ms, 3000ms, 3000ms
        if (attempt < maxRetries - 1) {
            delay = Math.min(initialDelay * Math.pow(2, attempt + 1), 3000);
        }
    }

    // Program is still installed after all retries
    // If process reported success, registry might just be slow to update
    // Return success if process succeeded, otherwise return failure
    if (processResult.success) {
        // Process succeeded but registry still shows it - might be a false positive
        // or registry is very slow. Trust the process result.
        return { success: true };
    }

    // Process reported failure and registry still shows it - uninstall failed
    return processResult;
}

/**
 * Uninstalls a program using a direct uninstaller path
 */
export async function uninstallByPath(
    uninstallerPath: string,
    options: UninstallOptions = {},
): Promise<{ success: boolean; error?: string }> {
    const { silent = true, timeout = 300000, onProgress, processExecutor } = options;

    const silentArgs = silent ? ['/S', '/SILENT', '/VERYSILENT'] : [];

    return executeProcess(uninstallerPath, silentArgs, {
        silent,
        timeout,
        onProgress,
    }, processExecutor);
}

/**
 * Uninstalls a single program by name
 * Wraps uninstallByName with proper error handling
 */
async function uninstallSingle(
    programName: string,
    options: UninstallOptions = {},
): Promise<UninstallResult> {
    const { onStatusChange, onProgress } = options;

    try {
        onStatusChange?.(programName, 'uninstalling');

        const result = await uninstallByName(programName, {
            ...options,
            onProgress: (elapsed) => {
                // Update status with elapsed time for progress display
                onStatusChange?.(programName, 'uninstalling', elapsed);
                onProgress?.(elapsed);
            },
        });

        if (result.success) {
            onStatusChange?.(programName, 'completed');
        } else {
            onStatusChange?.(programName, 'failed');
        }

        return {
            name: programName,
            success: result.success,
            error: result.error,
        };
    } catch (error) {
        // Catch any unexpected errors (e.g., from registry access, process execution)
        const errorMessage = error instanceof Error
            ? error.message
            : typeof error === 'string'
                ? error
                : 'Uninstallation failed with unknown error';

        onStatusChange?.(programName, 'failed');

        return {
            name: programName,
            success: false,
            error: errorMessage,
        };
    }
}

/**
 * Uninstalls programs sequentially
 */
export async function uninstallSequentially(
    programNames: string[],
    options: UninstallOptions = {},
): Promise<UninstallResult[]> {
    const { onStatusChange } = options;
    const results: UninstallResult[] = [];

    programNames.forEach(name => {
        onStatusChange?.(name, 'pending');
    });

    for (const programName of programNames) {
        const result = await uninstallSingle(programName, options);
        results.push(result);
    }

    return results;
}

/**
 * Uninstalls programs concurrently
 * Uses staggered delays to prevent registry query conflicts
 */
export async function uninstallConcurrently(
    programNames: string[],
    options: UninstallOptions = {},
): Promise<UninstallResult[]> {
    const { onStatusChange } = options;

    programNames.forEach(name => {
        onStatusChange?.(name, 'pending');
    });

    // Stagger the start of each uninstall to reduce registry query conflicts
    // Each uninstall starts with a small random delay (0-200ms) to spread out registry queries
    const settledResults = await Promise.allSettled(
        programNames.map((name, index) => {
            // Add a small staggered delay before starting each uninstall
            // This helps prevent simultaneous registry queries that could conflict
            const staggerDelay = Math.floor(Math.random() * 200) + (index * 50);

            return new Promise<UninstallResult>((resolve) => {
                setTimeout(async () => {
                    try {
                        const result = await uninstallSingle(name, options);
                        resolve(result);
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    } catch (error: any) {
                        // Catch any errors that weren't handled by uninstallSingle
                        onStatusChange?.(name, 'failed');
                        resolve({
                            name,
                            success: false,
                            error: error?.message || String(error) || 'Uninstallation failed with unknown error',
                        });
                    }
                }, staggerDelay);
            });
        }),
    );

    return settledResults.map((result, index) => {
        if (result.status === 'fulfilled') {
            return result.value;
        } else {
            const programName = programNames[index];
            onStatusChange?.(programName || 'unknown', 'failed');
            // Extract error message from rejection reason
            const errorMessage = result.reason instanceof Error
                ? result.reason.message
                : typeof result.reason === 'string'
                    ? result.reason
                    : 'Uninstallation failed';
            return {
                name: programName || 'unknown',
                success: false,
                error: errorMessage,
            };
        }
    });
}

/**
 * Uninstalls all programs (with mode selection)
 */
export async function uninstallAll(
    programNames: string[],
    options: UninstallOptions = {},
): Promise<UninstallResult[]> {
    if (options.concurrent) {
        return uninstallConcurrently(programNames, options);
    } else {
        return uninstallSequentially(programNames, options);
    }
}

/**
 * Lists installed programs (simplified - returns program names)
 */
export async function listInstalledPrograms(
    pattern?: string,
    registryAccess?: IRegistryAccess,
): Promise<string[]> {
    const registry = registryAccess || new NodeRegistryAccess();

    try {
        const { stdout } = await registry.exec(
            'powershell -Command "Get-ItemProperty HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*,HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\* | Where-Object { $_.DisplayName } | Select-Object -ExpandProperty DisplayName | Sort-Object"',
        );

        const programs = stdout
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0);

        const uniquePrograms = Array.from(new Set(programs));

        return pattern
            ? uniquePrograms.filter(name => name.toLowerCase().includes(pattern.toLowerCase()))
            : uniquePrograms;
    } catch (error) {
        throw new Error(`Failed to list installed programs: ${(error as Error).message}`);
    }
}

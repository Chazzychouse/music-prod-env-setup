import * as path from 'path';
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
    onProgress?: (elapsed: number) => void;
    // Dependency injection for testing
    registryAccess?: IRegistryAccess;
    processExecutor?: IProcessExecutor;
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
    const fs = fileSystem || new NodeFileSystem();

    try {
        if (!fs.existsSync(filePath)) {
            return { success: false, error: new Error(`File does not exist: ${filePath}`) };
        }

        fs.unlinkSync(filePath);
        return { success: true };
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
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
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
    const fs = fileSystem || new NodeFileSystem();

    try {
        if (!fs.existsSync(downloadDir)) {
            return [];
        }

        const files = fs.readdirSync(downloadDir);
        const filesToDelete = pattern
            ? files.filter(f => f.includes(pattern))
            : files.filter(f => f.endsWith('.exe'));

        const filePaths = filesToDelete.map(f => path.join(downloadDir, f));
        return await deleteDownloads(filePaths, fileSystem);
    } catch (error) {
        throw new Error(`Failed to delete downloads from ${downloadDir}: ${(error as Error).message}`);
    }
}

/**
 * Gets all downloaded files from a directory
 */
export function getDownloadedFiles(
    downloadDir: string,
    pattern?: string,
    fileSystem?: IFileSystem,
): string[] {
    const fs = fileSystem || new NodeFileSystem();

    try {
        if (!fs.existsSync(downloadDir)) {
            return [];
        }

        const files = fs.readdirSync(downloadDir);
        const filteredFiles = pattern
            ? files.filter(f => f.includes(pattern))
            : files.filter(f => f.endsWith('.exe'));

        return filteredFiles.map(f => path.join(downloadDir, f));
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

    // Extract the executable and arguments
    // Handle both quoted and unquoted paths
    let executable: string;
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
        const exeMatch = uninstallString.match(/^(.+\.(exe|msi|bat|cmd))(?:\s+(.*))?$/i);
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

    // Add silent flags if not already present
    const hasSilentFlag = existingArgs.some(arg =>
        arg.includes('/S') || arg.includes('/SILENT') || arg.includes('/VERYSILENT'),
    );
    const silentArgs = silent && !hasSilentFlag
        ? ['/S', '/SILENT', '/VERYSILENT']
        : [];

    const args = [...existingArgs, ...silentArgs];

    // Execute the uninstall process
    const processResult = await executeProcess(executable, args, {
        silent,
        timeout,
        onProgress,
    }, processExecutor);

    // Verify uninstall success by checking if the program is still in the registry
    // Some uninstallers return non-zero exit codes even when they succeed
    // Wait a brief moment for registry to update
    await new Promise(resolve => setTimeout(resolve, 500));

    const stillInstalled = await findUninstallString(programName, registryAccess);

    if (!stillInstalled) {
        // Program is no longer in registry - uninstall succeeded regardless of exit code
        return { success: true };
    }

    // Program is still installed - check if process reported success
    if (processResult.success) {
        // Process reported success but program still exists - might need more time
        // Wait a bit longer and check again
        await new Promise(resolve => setTimeout(resolve, 2000));
        const stillInstalledAfterWait = await findUninstallString(programName, registryAccess);
        if (!stillInstalledAfterWait) {
            return { success: true };
        }
    }

    // Program is still installed and process reported failure
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

        // Remove duplicates (same program can appear in both 32-bit and 64-bit registry)
        const uniquePrograms = Array.from(new Set(programs));

        return pattern
            ? uniquePrograms.filter(name => name.toLowerCase().includes(pattern.toLowerCase()))
            : uniquePrograms;
    } catch (error) {
        throw new Error(`Failed to list installed programs: ${(error as Error).message}`);
    }
}

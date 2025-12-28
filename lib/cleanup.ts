import * as path from 'path';
import * as fs from 'fs';
import * as child_process from 'child_process';
import { promisify } from 'util';
import { executeProcess } from './install';
import { IFileSystem, NodeFileSystem } from './interfaces/fs-interface';
import { IRegistryAccess, NodeRegistryAccess } from './interfaces/registry-interface';
import { DeleteResult, UninstallOptions, UninstallResult } from './models';

const exec = promisify(child_process.exec);


/**
 * Kills processes that might be locking a file
 */
async function killProcessesUsingFile(filePath: string): Promise<void> {
    const fileName = path.basename(filePath, path.extname(filePath));
    const escapedPath = filePath.replace(/'/g, "''");

    const commands = [
        `Get-Process -Name '${fileName}' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue`,
        `Get-Process | Where-Object { $_.Path -eq '${escapedPath}' } | Stop-Process -Force -ErrorAction SilentlyContinue`,
    ];

    for (const cmd of commands) {
        try {
            await exec(`powershell -Command "${cmd}"`);
        } catch {
        }
    }
}

/**
 * Deletes a single file or directory
 * Handles locked files by killing processes and retrying
 */
export async function deleteDownload(
    filePath: string,
    fileSystem?: IFileSystem,
): Promise<{ success: boolean; error?: Error }> {
    const fileSys = fileSystem || new NodeFileSystem();

    if (!fileSys.existsSync(filePath)) {
        return { success: false, error: new Error(`File does not exist: ${filePath}`) };
    }

    try {
        const stats = fs.statSync(filePath);
        if (stats.isDirectory()) {
            fs.rmSync(filePath, { recursive: true, force: true });
        } else {
            fileSys.unlinkSync(filePath);
        }
        return { success: true };
    } catch (error) {
        const err = error as NodeJS.ErrnoException;

        if (err.code === 'EBUSY' || err.message?.includes('locked')) {
            try {
                await killProcessesUsingFile(filePath);
                await new Promise(resolve => setTimeout(resolve, 1000));

                if (fileSys.existsSync(filePath)) {
                    const stats = fs.statSync(filePath);
                    if (stats.isDirectory()) {
                        fs.rmSync(filePath, { recursive: true, force: true });
                    } else {
                        fileSys.unlinkSync(filePath);
                    }
                }
                return { success: true };
            } catch {
                return { success: false, error: err };
            }
        }

        return { success: false, error: err };
    }
}

/**
 * Deletes multiple files
 */
export async function deleteDownloads(
    filePaths: string[],
    fileSystem?: IFileSystem,
): Promise<DeleteResult[]> {
    const results: DeleteResult[] = [];

    for (const filePath of filePaths) {
        const result = await deleteDownload(filePath, fileSystem);
        results.push({
            name: path.basename(filePath),
            path: filePath,
            deleted: result.success,
            error: result.error,
        });
    }

    return results;
}

/**
 * Gets files matching download patterns (.exe, .zip, or directories)
 */
function isDownloadFile(itemName: string, itemPath: string): boolean {
    if (itemName.endsWith('.exe') || itemName.endsWith('.zip')) {
        return true;
    }
    try {
        return fs.statSync(itemPath).isDirectory();
    } catch {
        return false;
    }
}

/**
 * Gets all downloaded files from a directory
 */
export function getDownloadedFiles(
    downloadDir: string,
    fileSystem?: IFileSystem,
): string[] {
    const fileSys = fileSystem || new NodeFileSystem();

    if (!fileSys.existsSync(downloadDir)) {
        return [];
    }

    const items = fileSys.readdirSync(downloadDir);
    const filtered = items.filter(item => isDownloadFile(item, path.join(downloadDir, item)));

    return filtered.map(item => path.join(downloadDir, item));
}

/**
 * Deletes all downloads from a directory
 */
export async function deleteAllDownloads(
    downloadDir: string,
    fileSystem?: IFileSystem,
): Promise<DeleteResult[]> {
    const files = getDownloadedFiles(downloadDir, fileSystem);
    return deleteDownloads(files, fileSystem);
}

/**
 * Finds uninstall string from Windows registry
 */
export async function findUninstallString(
    programName: string,
    registryAccess?: IRegistryAccess,
): Promise<string | null> {
    const registry = registryAccess || new NodeRegistryAccess();
    const escapedName = programName.replace(/'/g, "''");

    const registryPaths = [
        'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
        'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
    ];

    for (const regPath of registryPaths) {
        try {
            const { stdout } = await registry.exec(
                `powershell -Command "Get-ItemProperty ${regPath} | Where-Object { $_.DisplayName -like '*${escapedName}*' } | Select-Object -First 1 -ExpandProperty UninstallString"`,
            );
            const uninstallString = stdout.trim();
            if (uninstallString) {
                return uninstallString;
            }
        } catch {
            // Continue to next registry path
        }
    }

    return null;
}

/**
 * Parses uninstall string into executable and arguments
 */
function parseUninstallString(uninstallString: string): { executable: string; args: string[] } {
    const lower = uninstallString.toLowerCase();
    const isMsi = lower.includes('msiexec') || lower.endsWith('.msi') || /\.msi\s/i.test(uninstallString);

    if (isMsi) {
        if (lower.includes('msiexec')) {
            const match = uninstallString.match(/msiexec(?:\.exe)?\s+(.+)/i);
            if (!match) {
                throw new Error(`Invalid MSI uninstall string: ${uninstallString}`);
            }

            let argsStr = match[1].trim();
            // Replace /i with /x for uninstall
            argsStr = argsStr.replace(/\/([ix])(\s|$|\{)/gi, (match, flag, suffix) => {
                return flag.toLowerCase() === 'i' ? '/x' + suffix : match;
            });

            // Parse arguments
            const args: string[] = [];
            const regex = /(?:[^\s"]+|"[^"]*"|\{[^}]*\})+/g;
            let m;
            while ((m = regex.exec(argsStr)) !== null) {
                args.push(m[0].trim());
            }

            // Ensure /x flag exists
            if (!args.some(a => a.toLowerCase().startsWith('/x'))) {
                args.unshift('/x');
            }

            // Add quiet flag if not present
            const hasQuiet = args.some(a => {
                const aLower = a.toLowerCase();
                return aLower === '/qn' || aLower === '/qb' || aLower === '/qr' || (aLower.startsWith('/q') && aLower.length === 3);
            });
            if (!hasQuiet) {
                args.push('/qn', '/norestart');
            }

            return { executable: 'msiexec.exe', args };
        } else {
            // Direct MSI file path
            const msiPath = uninstallString.trim().replace(/^["']|["']$/g, '');
            return {
                executable: 'msiexec.exe',
                args: ['/x', msiPath, '/qn', '/norestart'],
            };
        }
    }

    // Regular uninstaller
    let executable: string;
    let argsStr: string;

    if (uninstallString.startsWith('"')) {
        const endQuote = uninstallString.indexOf('"', 1);
        if (endQuote === -1) {
            throw new Error(`Invalid uninstall string: ${uninstallString}`);
        }
        executable = uninstallString.substring(1, endQuote);
        argsStr = uninstallString.substring(endQuote + 1).trim();
    } else {
        const match = uninstallString.match(/^(.+\.(exe|bat|cmd))(?:\s+(.*))?$/i);
        if (match) {
            executable = match[1];
            argsStr = match[3] || '';
        } else {
            const spaceIdx = uninstallString.indexOf(' ');
            executable = spaceIdx === -1 ? uninstallString : uninstallString.substring(0, spaceIdx);
            argsStr = spaceIdx === -1 ? '' : uninstallString.substring(spaceIdx + 1).trim();
        }
    }

    const args = argsStr
        ? argsStr.split(/\s+(?=(?:[^"]*"[^"]*")*[^"]*$)/).filter(a => a.trim())
        : [];

    // Add silent flags if not present
    const hasSilent = args.some(a => a.includes('/S') || a.includes('/SILENT') || a.includes('/VERYSILENT'));
    if (!hasSilent) {
        args.push('/S', '/SILENT', '/VERYSILENT');
    }

    return { executable, args };
}

/**
 * Uninstalls a program by name
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

    try {
        const { executable, args } = parseUninstallString(uninstallString);

        // Override silent flags if needed
        if (!silent) {
            const silentFlags = ['/S', '/SILENT', '/VERYSILENT', '/qn', '/qb'];
            const filtered = args.filter(a => !silentFlags.some(flag => a.toLowerCase().includes(flag.toLowerCase())));
            if (executable === 'msiexec.exe') {
                filtered.push('/qb');
            }
            args.length = 0;
            args.push(...filtered);
        }

        const result = await executeProcess(executable, args, {
            silent,
            timeout,
            onProgress,
        }, processExecutor);

        // Verify uninstallation with retries
        for (let i = 0; i < 5; i++) {
            await new Promise(resolve => setTimeout(resolve, 500 * (i + 1)));
            const stillInstalled = await findUninstallString(programName, registryAccess);
            if (!stillInstalled) {
                return { success: true };
            }
            if (!result.success && i >= 1) {
                break;
            }
        }

        return result.success ? { success: true } : result;
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

/**
 * Uninstalls a program using direct uninstaller path
 */
export async function uninstallByPath(
    uninstallerPath: string,
    options: UninstallOptions = {},
): Promise<{ success: boolean; error?: string }> {
    const { silent = true, timeout = 300000, onProgress, processExecutor } = options;
    const args = silent ? ['/S', '/SILENT', '/VERYSILENT'] : [];
    return executeProcess(uninstallerPath, args, { silent, timeout, onProgress }, processExecutor);
}

/**
 * Uninstalls a single program with status callbacks
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
        onStatusChange?.(programName, 'failed');
        return {
            name: programName,
            success: false,
            error: error instanceof Error ? error.message : String(error),
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
    programNames.forEach(name => onStatusChange?.(name, 'pending'));

    const results: UninstallResult[] = [];
    for (const name of programNames) {
        results.push(await uninstallSingle(name, options));
    }
    return results;
}

/**
 * Uninstalls programs concurrently
 */
export async function uninstallConcurrently(
    programNames: string[],
    options: UninstallOptions = {},
): Promise<UninstallResult[]> {
    const { onStatusChange } = options;
    programNames.forEach(name => onStatusChange?.(name, 'pending'));

    const results = await Promise.allSettled(
        programNames.map((name, index) => {
            const delay = Math.floor(Math.random() * 200) + (index * 50);
            return new Promise<UninstallResult>(resolve => {
                setTimeout(async () => {
                    try {
                        resolve(await uninstallSingle(name, options));
                    } catch (error) {
                        onStatusChange?.(name, 'failed');
                        resolve({
                            name,
                            success: false,
                            error: error instanceof Error ? error.message : String(error),
                        });
                    }
                }, delay);
            });
        }),
    );

    return results.map((result, index) => {
        if (result.status === 'fulfilled') {
            return result.value;
        }
        const name = programNames[index] || 'unknown';
        onStatusChange?.(name, 'failed');
        return {
            name,
            success: false,
            error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        };
    });
}

/**
 * Uninstalls all programs (sequential or concurrent)
 */
export async function uninstallAll(
    programNames: string[],
    options: UninstallOptions = {},
): Promise<UninstallResult[]> {
    return options.concurrent
        ? uninstallConcurrently(programNames, options)
        : uninstallSequentially(programNames, options);
}

/**
 * Lists installed programs from Windows registry
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

        const unique = Array.from(new Set(programs));
        return pattern
            ? unique.filter(name => name.toLowerCase().includes(pattern.toLowerCase()))
            : unique;
    } catch (error) {
        throw new Error(`Failed to list installed programs: ${(error as Error).message}`);
    }
}

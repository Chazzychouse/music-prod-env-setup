import { downloadAll, DownloadItem } from './download';
import { installAll, InstallItem } from './install';
import { deleteAllDownloads, getDownloadedFiles, uninstallByName, listInstalledPrograms } from './cleanup';
import { StatusDisplay } from './ui';
import urls from '../data/urls.json';

// ============================================================================
// Command Handler Types
// ============================================================================

export interface CLIOptions {
    downloadDir?: string;
    concurrent?: boolean;
}

// ============================================================================
// Command Handlers
// ============================================================================

/**
 * Downloads and installs all items from URLs
 */
export async function downloadAndInstall(
    items: DownloadItem[],
    options: CLIOptions = {},
): Promise<void> {
    const { downloadDir = 'C:\\Users\\ccart\\Downloads', concurrent = false } = options;

    // Phase 1: Download all files
    console.log('Starting downloads...\n');
    const { successful, failed } = await downloadAll(items, { downloadDir });

    console.log('\nDownloads completed.');
    console.log(`Successful: ${successful.length}, Failed: ${failed.length}`);

    if (successful.length === 0) {
        console.log('No files downloaded successfully. Skipping installations.');
        return;
    }

    // Phase 2: Install all successfully downloaded files
    console.log('\nStarting installations...\n');

    // Map download results to install items, including installedAppNames from urls.json
    const installItems: InstallItem[] = successful.map(d => {
        // Find the corresponding item in urls.json to get installedAppNames
        const urlItem = urls.urls.find(item => item.name === d.name);
        return {
            name: d.name,
            path: d.path,
            installedAppNames: urlItem?.installedAppNames,
            requiresManualInstallation: urlItem?.requiresManualInstallation ?? false,
        };
    });
    const display = new StatusDisplay(installItems);
    display.start();

    const installResults = await installAll(installItems, {
        concurrent,
        onStatusChange: (name, status) => {
            display.setStatus(name, status);
        },
        onProgress: (name, elapsed) => {
            display.setStatus(name, 'installing', elapsed);
        },
    });

    display.finalize();

    // Final reporting
    const successfulInstalls = installResults.filter(r => r.installSuccess).length;
    const failedInstalls = installResults.filter(r => !r.installSuccess).length;

    console.log('\nAll operations completed.');
    console.log(`Successful downloads: ${successful.length}`);
    console.log(`Failed downloads: ${failed.length}`);
    console.log(`Successful installations: ${successfulInstalls}`);
    console.log(`Failed installations: ${failedInstalls}`);
}

/**
 * Deletes downloaded files
 */
export async function cleanupDownloads(
    downloadDir: string,
    pattern?: string,
): Promise<void> {
    console.log(`Cleaning up downloads from ${downloadDir}...\n`);

    const results = await deleteAllDownloads(downloadDir, pattern);

    const successful = results.filter(r => r.deleted).length;
    const failed = results.filter(r => !r.deleted).length;

    console.log('\nCleanup completed.');
    console.log(`Deleted: ${successful}, Failed: ${failed}`);

    if (failed > 0) {
        console.log('\nFailed deletions:');
        results.filter(r => !r.deleted).forEach(r => {
            console.log(`  ✗ ${r.name}: ${r.error?.message || 'Unknown error'}`);
        });
    }
}

/**
 * Lists downloaded files
 */
export async function listDownloads(downloadDir: string): Promise<void> {
    console.log(`Downloaded files in ${downloadDir}:\n`);

    const files = getDownloadedFiles(downloadDir);

    if (files.length === 0) {
        console.log('  No downloaded files found.');
        return;
    }

    files.forEach((file, index) => {
        const fileName = file.split('\\').pop() || file;
        console.log(`  ${index + 1}. ${fileName}`);
    });
}

/**
 * Uninstalls all programs matching installedAppNames from urls.json
 */
export async function uninstallAllMatching(
    pattern?: string,
    options: { silent?: boolean; timeout?: number } = {},
): Promise<void> {
    // Extract app names we care about from urls.json
    const caredAboutNames = new Set<string>();
    urls.urls.forEach(item => {
        if (item.installedAppNames && Array.isArray(item.installedAppNames)) {
            item.installedAppNames.forEach(name => caredAboutNames.add(name));
        }
    });

    // Get all installed programs
    const allPrograms = await listInstalledPrograms();

    // Filter to only programs we care about
    // Match if the program name exactly matches or contains a cared-about name
    let programsToUninstall = allPrograms.filter(program =>
        Array.from(caredAboutNames).some(caredName => {
            const programLower = program.toLowerCase();
            const caredNameLower = caredName.toLowerCase();
            return programLower === caredNameLower || programLower.includes(caredNameLower);
        })
    );

    // Apply pattern filter if provided
    if (pattern) {
        programsToUninstall = programsToUninstall.filter(name =>
            name.toLowerCase().includes(pattern.toLowerCase())
        );
    }

    if (programsToUninstall.length === 0) {
        console.log('No matching programs found to uninstall.');
        return;
    }

    console.log(`Found ${programsToUninstall.length} program(s) to uninstall:\n`);
    programsToUninstall.forEach((program, index) => {
        console.log(`  ${index + 1}. ${program}`);
    });
    console.log('');

    // Create display for all programs
    const display = new StatusDisplay(programsToUninstall.map(name => ({ name })));
    display.start();

    // Uninstall each program
    const results: Array<{ name: string; success: boolean; error?: string }> = [];
    for (const programName of programsToUninstall) {
        display.setStatus(programName, 'uninstalling', 0);

        const result = await uninstallByName(programName, {
            silent: options.silent ?? true,
            timeout: options.timeout ?? 300000,
            onProgress: (elapsed) => {
                display.setStatus(programName, 'uninstalling', elapsed);
            },
        });

        if (result.success) {
            display.setStatus(programName, 'completed');
        } else {
            display.setStatus(programName, 'failed');
        }

        results.push({ name: programName, success: result.success, error: result.error });
    }

    display.finalize();

    // Final reporting
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    console.log('\nUninstall completed.');
    console.log(`Successful: ${successful}, Failed: ${failed}`);

    if (failed > 0) {
        console.log('\nFailed uninstalls:');
        results.filter(r => !r.success).forEach(r => {
            console.log(`  ✗ ${r.name}: ${r.error || 'Unknown error'}`);
        });
        if (results.some(r => !r.success && r.error?.includes('Access denied'))) {
            console.log(`\nTip: Try running this command as administrator (right-click PowerShell and select "Run as Administrator").`);
        }
    }
}

/**
 * Lists installed programs matching a pattern
 * Only shows programs that are in urls.json by default
 * Use '--all' or '*' as pattern to show all installed programs
 */
export async function listInstalled(pattern?: string): Promise<void> {
    console.log('Installed programs:\n');

    // Get all installed programs
    const allPrograms = await listInstalledPrograms();

    // Check if user wants to see all programs
    const showAll = pattern === '--all' || pattern === '*';

    let programs: string[];

    if (showAll) {
        // Show all programs without filtering
        programs = allPrograms;
    } else {
        // Extract app names we care about from urls.json
        const caredAboutNames = new Set<string>();
        urls.urls.forEach(item => {
            if (item.installedAppNames && Array.isArray(item.installedAppNames)) {
                item.installedAppNames.forEach(name => caredAboutNames.add(name));
            }
        });

        // Filter to only show programs we care about
        // Match if the program name exactly matches or contains a cared-about name
        programs = allPrograms.filter(program =>
            Array.from(caredAboutNames).some(caredName => {
                const programLower = program.toLowerCase();
                const caredNameLower = caredName.toLowerCase();
                return programLower === caredNameLower || programLower.includes(caredNameLower);
            })
        );

        // Apply pattern filter if provided (and not --all or *)
        if (pattern) {
            programs = programs.filter(name => name.toLowerCase().includes(pattern.toLowerCase()));
        }
    }

    if (programs.length === 0) {
        console.log('  No programs found.');
        return;
    }

    programs.forEach((program, index) => {
        console.log(`  ${index + 1}. ${program}`);
    });
}


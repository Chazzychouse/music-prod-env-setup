import { downloadAll, DownloadItem } from './download';
import { installAll, InstallItem, listInstalledPlugins, removePlugins } from './install';
import { deleteAllDownloads, getDownloadedFiles, uninstallAll, listInstalledPrograms } from './cleanup';
import { StatusDisplay } from './ui';
import urls from '../data/urls';

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

    // Map download results to install items, including installedAppNames and pluginNames from urls.json
    const installItems: InstallItem[] = successful.map(d => {
        // Find the corresponding item in urls.json to get installedAppNames and pluginNames
        const urlItem = urls.urls.find(item => item.name === d.name);
        return {
            name: d.name,
            path: d.path,
            installedAppNames: urlItem?.installedAppNames,
            pluginNames: urlItem?.pluginNames,
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
 * Also removes plugins matching pluginNames from all plugin directories
 */
export async function uninstallAllMatching(
    pattern?: string,
    options: { silent?: boolean; timeout?: number; concurrent?: boolean } = {},
): Promise<void> {
    // Extract app names and plugin names we care about from urls.json
    const caredAboutNames = new Set<string>();
    const caredAboutPluginNames = new Set<string>();
    const urlItemMap = new Map<string, { installedAppNames?: string[]; pluginNames?: string[] }>();

    urls.urls.forEach(item => {
        if (item.installedAppNames && Array.isArray(item.installedAppNames)) {
            item.installedAppNames.forEach(name => caredAboutNames.add(name));
        }
        if (item.pluginNames && Array.isArray(item.pluginNames)) {
            item.pluginNames.forEach(name => caredAboutPluginNames.add(name));
        }
        // Map app names to their URL item for plugin lookup
        if (item.installedAppNames) {
            item.installedAppNames.forEach(appName => {
                urlItemMap.set(appName.toLowerCase(), {
                    installedAppNames: item.installedAppNames,
                    pluginNames: item.pluginNames
                });
            });
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

    // Collect plugin names to remove
    const pluginsToRemove = new Set<string>();

    // First, collect plugins based on programs being uninstalled
    programsToUninstall.forEach(program => {
        const programLower = program.toLowerCase();
        // Find matching URL item
        for (const [appName, urlItem] of urlItemMap.entries()) {
            if (programLower === appName || programLower.includes(appName)) {
                if (urlItem.pluginNames) {
                    urlItem.pluginNames.forEach(pluginName => pluginsToRemove.add(pluginName));
                }
            }
        }
    });

    // Also check for installed plugins that match our cared-about names
    // This handles cases where only plugins are installed (no registry entry)
    if (caredAboutPluginNames.size > 0) {
        const installedPlugins = await listInstalledPlugins(Array.from(caredAboutPluginNames));
        if (pattern) {
            // If pattern provided, filter by pattern
            installedPlugins.forEach(pluginName => {
                if (pluginName.toLowerCase().includes(pattern.toLowerCase())) {
                    pluginsToRemove.add(pluginName);
                }
            });
        } else {
            // If no pattern, add all installed plugins we care about
            installedPlugins.forEach(pluginName => {
                pluginsToRemove.add(pluginName);
            });
        }
    }

    if (programsToUninstall.length === 0 && pluginsToRemove.size === 0) {
        console.log('No matching programs or plugins found to uninstall.');
        return;
    }

    if (programsToUninstall.length > 0) {
        console.log(`Found ${programsToUninstall.length} program(s) to uninstall:\n`);
        programsToUninstall.forEach((program, index) => {
            console.log(`  ${index + 1}. ${program}`);
        });
        console.log('');
    }

    if (pluginsToRemove.size > 0) {
        console.log(`Found ${pluginsToRemove.size} plugin(s) to remove:\n`);
        Array.from(pluginsToRemove).forEach((plugin, index) => {
            console.log(`  ${index + 1}. ${plugin}`);
        });
        console.log('');
    }

    // Create display for all items (programs + plugins)
    const allItems = [
        ...programsToUninstall.map(name => ({ name })),
        ...Array.from(pluginsToRemove).map(name => ({ name }))
    ];
    const display = new StatusDisplay(allItems);
    display.start();

    // Uninstall all programs (sequential or concurrent based on option)
    const results = await uninstallAll(programsToUninstall, {
        silent: options.silent ?? true,
        timeout: options.timeout ?? 300000,
        concurrent: options.concurrent ?? false,
        onStatusChange: (name, status, elapsed) => {
            display.setStatus(name, status, elapsed);
        },
    });

    // Remove plugins
    let pluginResults: { removed: number; errors: string[] } = { removed: 0, errors: [] };
    if (pluginsToRemove.size > 0) {
        pluginResults = await removePlugins(Array.from(pluginsToRemove));
        pluginsToRemove.forEach(pluginName => {
            // Check if this specific plugin was removed (simplified - if any were removed, mark as completed)
            display.setStatus(pluginName, pluginResults.removed > 0 ? 'completed' : 'failed');
        });
    }

    display.finalize();

    // Final reporting
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    console.log('\nUninstall completed.');
    console.log(`Successful: ${successful}, Failed: ${failed}`);
    if (pluginsToRemove.size > 0) {
        console.log(`Plugins removed: ${pluginResults.removed}`);
        if (pluginResults.errors.length > 0) {
            console.log('\nPlugin removal errors:');
            pluginResults.errors.forEach(error => {
                console.log(`  ✗ ${error}`);
            });
        }
    }

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

    // Get all installed programs from registry
    const allPrograms = await listInstalledPrograms();

    // Check if user wants to see all programs
    const showAll = pattern === '--all' || pattern === '*';

    let programs: string[];

    if (showAll) {
        // Show all programs without filtering
        programs = allPrograms;
    } else {
        // Extract app names and plugin names we care about from urls.json
        const caredAboutNames = new Set<string>();
        const caredAboutPluginNames = new Set<string>();
        urls.urls.forEach(item => {
            if (item.installedAppNames && Array.isArray(item.installedAppNames)) {
                item.installedAppNames.forEach(name => caredAboutNames.add(name));
            }
            if (item.pluginNames && Array.isArray(item.pluginNames)) {
                item.pluginNames.forEach(name => caredAboutPluginNames.add(name));
            }
        });

        // Filter to only show programs we care about from registry
        // Match if the program name exactly matches or contains a cared-about name
        programs = allPrograms.filter(program =>
            Array.from(caredAboutNames).some(caredName => {
                const programLower = program.toLowerCase();
                const caredNameLower = caredName.toLowerCase();
                return programLower === caredNameLower || programLower.includes(caredNameLower);
            })
        );

        // Also check for plugins and add them to the list
        if (caredAboutPluginNames.size > 0) {
            const installedPlugins = await listInstalledPlugins(Array.from(caredAboutPluginNames));
            // Add plugin names to the programs list
            installedPlugins.forEach(pluginName => {
                programs.push(pluginName);
            });
        }

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


import { downloadAll } from './download';
import { installAll, listInstalledPlugins, removePlugins } from './install';
import { deleteAllDownloads, getDownloadedFiles, uninstallAll, listInstalledPrograms } from './cleanup';
import { StatusDisplay } from './ui';
import { Product, InstallOptions, products, InstallItem, DownloadItem } from './models';

/**
 * Downloads and installs all items from URLs
 */
export async function downloadAndInstall(
    items: DownloadItem[],
    options: InstallOptions = {},
): Promise<void> {
    const { downloadDir = 'C:\\Users\\ccart\\Downloads', concurrent = false } = options;
    const { successful, failed } = await downloadAll(items, { downloadDir });

    if (successful.length === 0) {
        return;
    }

    const installItems: InstallItem[] = successful.map(d => {
        const product = products.find(item => item.name === d.name);
        return {
            name: d.name,
            path: d.path,
            installedAppNames: product?.installedAppNames,
            requiresManualInstallation: product?.requiresManualInstallation ?? false,
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
): Promise<void> {
    const results = await deleteAllDownloads(downloadDir);
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
 * Also removes plugins matching installedAppNames from all plugin directories
 */
export async function uninstallAllMatching(
    options: { silent?: boolean; timeout?: number; concurrent?: boolean } = {},
): Promise<void> {
    const relevantNames = new Set<string>();

    products.forEach(product => {
        if (product.installedAppNames && Array.isArray(product.installedAppNames)) {
            product.installedAppNames.forEach(name => relevantNames.add(name));
        }
    });

    const allPrograms = await listInstalledPrograms();

    const programsToUninstall = allPrograms.filter(program =>
        Array.from(relevantNames).some(relevantName => {
            const programLower = program.toLowerCase();
            const relevantNameLower = relevantName.toLowerCase();
            return programLower === relevantNameLower || programLower.includes(relevantNameLower);
        })
    );

    const pluginsToRemove = new Set<string>();

    if (relevantNames.size > 0) {
        const installedPlugins = await listInstalledPlugins(Array.from(relevantNames));
        installedPlugins.forEach(pluginName => {
            pluginsToRemove.add(pluginName);
        });
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

    const allItems = [
        ...programsToUninstall.map(name => ({ name })),
        ...Array.from(pluginsToRemove).map(name => ({ name }))
    ];
    const display = new StatusDisplay(allItems);
    display.start();

    const results = await uninstallAll(programsToUninstall, {
        silent: options.silent ?? true,
        timeout: options.timeout ?? 300000,
        concurrent: options.concurrent ?? false,
        onStatusChange: (name, status, elapsed) => {
            display.setStatus(name, status, elapsed);
        },
    });

    let pluginResults: { removed: number; errors: string[] } = { removed: 0, errors: [] };
    if (pluginsToRemove.size > 0) {
        pluginResults = await removePlugins(Array.from(pluginsToRemove));
        pluginsToRemove.forEach(pluginName => {
            display.setStatus(pluginName, pluginResults.removed > 0 ? 'completed' : 'failed');
        });
    }

    display.finalize();

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
 */
export async function listInstalled(pattern?: string): Promise<void> {
    console.log('Installed programs:\n');

    const allPrograms = await listInstalledPrograms();

    const showAll = pattern === '--all' || pattern === '*';

    let programs: string[];

    if (showAll) {
        programs = allPrograms;
    } else {
        const caredAboutNames = new Set<string>();
        products.forEach((item: Product) => {
            if (item.installedAppNames && Array.isArray(item.installedAppNames)) {
                item.installedAppNames.forEach(name => caredAboutNames.add(name));
            }
        });

        programs = allPrograms.filter(program =>
            Array.from(caredAboutNames).some(caredName => {
                const programLower = program.toLowerCase();
                const caredNameLower = caredName.toLowerCase();
                return programLower === caredNameLower || programLower.includes(caredNameLower);
            })
        );

        if (caredAboutNames.size > 0) {
            const installedPlugins = await listInstalledPlugins(Array.from(caredAboutNames));
            installedPlugins.forEach(pluginName => {
                programs.push(pluginName);
            });
        }

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


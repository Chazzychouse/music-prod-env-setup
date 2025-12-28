import * as fs from 'fs';
import { downloadAll } from './download';
import { installAll, listInstalledPlugins, removePlugins } from './install';
import { deleteAllDownloads, getDownloadedFiles, uninstallAll, listInstalledPrograms, uninstallByPath } from './cleanup';
import { StatusDisplay } from './ui';
import { Product, InstallOptions, products, InstallItem, DownloadItem } from './models';
import { getProductsByName } from './products';

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
 * @param productNames Optional array of product names to uninstall. If not provided, uninstalls all enabled products.
 */
export async function uninstallAllMatching(
    options: { silent?: boolean; timeout?: number; concurrent?: boolean; productNames?: string[] } = {},
): Promise<void> {
    const productsToProcess = getProductsByName(options.productNames);

    if (productsToProcess.length === 0) {
        console.log('No products found to uninstall.');
        return;
    }

    const relevantNames = new Set<string>();
    const productUninstallerMap = new Map<string, string>(); // product name -> uninstaller path
    const productExecutableMap = new Map<string, string>(); // product name -> executable path

    productsToProcess.forEach(product => {
        if (product.installedAppNames && Array.isArray(product.installedAppNames)) {
            product.installedAppNames.forEach(name => relevantNames.add(name));
        }
        if (product.uninstallerPath) {
            productUninstallerMap.set(product.name, product.uninstallerPath);
        }
        if (product.installedExecutablePath) {
            productExecutableMap.set(product.name, product.installedExecutablePath);
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

    const productsWithExecutables: Array<{ name: string; uninstallerPath?: string }> = [];
    productExecutableMap.forEach((executablePath, productName) => {
        if (fs.existsSync(executablePath)) {
            const product = productsToProcess.find(p => p.name === productName);
            productsWithExecutables.push({
                name: productName,
                uninstallerPath: product?.uninstallerPath,
            });
        }
    });

    const pluginsToRemove = new Set<string>();

    if (relevantNames.size > 0) {
        const installedPlugins = await listInstalledPlugins(Array.from(relevantNames));
        installedPlugins.forEach(pluginName => {
            pluginsToRemove.add(pluginName);
        });
    }

    if (programsToUninstall.length === 0 && pluginsToRemove.size === 0 && productsWithExecutables.length === 0) {
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

    if (productsWithExecutables.length > 0) {
        console.log(`Found ${productsWithExecutables.length} product(s) with executable paths to uninstall:\n`);
        productsWithExecutables.forEach((product, index) => {
            console.log(`  ${index + 1}. ${product.name}`);
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
        ...productsWithExecutables.map(p => ({ name: p.name })),
        ...Array.from(pluginsToRemove).map(name => ({ name }))
    ];
    const display = new StatusDisplay(allItems);
    display.start();

    // Uninstall registry-based programs
    const results = await uninstallAll(programsToUninstall, {
        silent: options.silent ?? true,
        timeout: options.timeout ?? 300000,
        concurrent: options.concurrent ?? false,
        onStatusChange: (name, status, elapsed) => {
            display.setStatus(name, status, elapsed);
        },
    });

    // Uninstall products with direct uninstaller paths
    const productResults = await Promise.all(
        productsWithExecutables.map(async (product) => {
            if (product.uninstallerPath && fs.existsSync(product.uninstallerPath)) {
                display.setStatus(product.name, 'uninstalling');
                const result = await uninstallByPath(product.uninstallerPath, {
                    silent: options.silent ?? true,
                    timeout: options.timeout ?? 300000,
                    onProgress: (elapsed) => {
                        display.setStatus(product.name, 'uninstalling', elapsed);
                    },
                });
                display.setStatus(product.name, result.success ? 'completed' : 'failed');
                return {
                    name: product.name,
                    success: result.success,
                    error: result.error,
                };
            } else {
                display.setStatus(product.name, 'failed');
                return {
                    name: product.name,
                    success: false,
                    error: `Uninstaller not found at ${product.uninstallerPath || 'specified path'}`,
                };
            }
        })
    );

    let pluginResults: { removed: number; errors: string[] } = { removed: 0, errors: [] };
    if (pluginsToRemove.size > 0) {
        pluginResults = await removePlugins(Array.from(pluginsToRemove));
        pluginsToRemove.forEach(pluginName => {
            display.setStatus(pluginName, pluginResults.removed > 0 ? 'completed' : 'failed');
        });
    }

    display.finalize();

    const allResults = [...results, ...productResults];
    const successful = allResults.filter(r => r.success).length;
    const failed = allResults.filter(r => !r.success).length;

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
        allResults.filter(r => !r.success).forEach(r => {
            console.log(`  ✗ ${r.name}: ${r.error || 'Unknown error'}`);
        });
        if (allResults.some(r => !r.success && r.error?.includes('Access denied'))) {
            console.log(`\nTip: Try running this command as administrator (right-click PowerShell and select "Run as Administrator").`);
        }
    }
}

/**
 * Lists installed programs matching a pattern
 */
export async function listInstalled(pattern?: string, productNames?: string[]): Promise<void> {
    console.log('Installed programs:\n');

    const allPrograms = await listInstalledPrograms();
    const productsToCheck = productNames ? getProductsByName(productNames) : getProductsByName();

    const showAll = pattern === '--all' || pattern === '*';

    let programs: string[];

    if (showAll) {
        programs = allPrograms;
    } else {
        const caredAboutNames = new Set<string>();
        productsToCheck.forEach((item: Product) => {
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

        // Check for products with installedExecutablePath
        productsToCheck.forEach((product: Product) => {
            if (product.installedExecutablePath && fs.existsSync(product.installedExecutablePath)) {
                programs.push(product.name);
            }
        });

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


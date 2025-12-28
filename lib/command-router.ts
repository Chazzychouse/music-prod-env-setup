import {
    downloadAndInstall,
    cleanupDownloads,
    listDownloads,
    uninstallAllMatching,
    listInstalled,
} from './commands';
import { Product } from './models';
import { getProductsByName } from './products';


/**
 * Checks if help flag is present in arguments
 */
function hasHelpFlag(args: string[]): boolean {
    return args.includes('-h') || args.includes('--help');
}

/**
 * Executes a command with given arguments
 */
export async function executeCommand(command: string, args: string[]): Promise<boolean> {
    try {
        switch (command) {
            case 'install':
            case 'i': {
                if (hasHelpFlag(args)) {
                    printInstallHelp();
                    return true;
                }

                const productNames = args.filter(arg => !arg.startsWith('--') && arg !== '-c' && arg !== '-h' && arg !== '--help');

                const productsToInstall = productNames.length > 0
                    ? getProductsByName(productNames)
                    : getProductsByName([]);

                if (productsToInstall.length === 0) {
                    console.log('No products found to install.');
                    if (productNames.length > 0) {
                        console.log(`Products requested: ${productNames.join(', ')}`);
                        console.log('Available products:');
                        getProductsByName([]).forEach((p: Product) => console.log(`  - ${p.name}`));
                    }
                    return true;
                }

                await downloadAndInstall(productsToInstall, {
                    downloadDir: 'C:\\Users\\ccart\\Downloads',
                    concurrent: args.includes('--concurrent') || args.includes('-c'),
                });
                return true;
            }

            case 'cleanup':
            case 'clean': {
                if (hasHelpFlag(args)) {
                    printCleanupHelp();
                    return true;
                }
                const cleanupDir = args[0] || 'C:\\Users\\ccart\\Downloads';
                await cleanupDownloads(cleanupDir);
                return true;
            }

            case 'list-downloads':
            case 'ld': {
                if (hasHelpFlag(args)) {
                    printListDownloadsHelp();
                    return true;
                }
                const listDir = args[0] || 'C:\\Users\\ccart\\Downloads';
                await listDownloads(listDir);
                return true;
            }

            case 'uninstall':
            case 'u': {
                if (hasHelpFlag(args)) {
                    printUninstallHelp();
                    return true;
                }

                const flagArgs = args.filter(arg => arg.startsWith('--') || arg === '-c');
                const productNames = args.filter(arg => !arg.startsWith('--') && arg !== '-c' && arg !== '-h' && arg !== '--help');

                await uninstallAllMatching({
                    silent: !flagArgs.includes('--no-silent'),
                    timeout: flagArgs.includes('--timeout')
                        ? parseInt(flagArgs[flagArgs.indexOf('--timeout') + 1]) || 300000
                        : 300000,
                    concurrent: flagArgs.includes('--concurrent') || flagArgs.includes('-c'),
                    productNames: productNames.length > 0 ? productNames : undefined,
                });
                return true;
            }

            case 'list-installed':
            case 'li': {
                if (hasHelpFlag(args)) {
                    printListInstalledHelp();
                    return true;
                }

                const nonFlagArgs = args.filter(arg => !arg.startsWith('--') && arg !== '-h');

                let searchPattern: string | undefined;
                let productNames: string[] | undefined;

                if (nonFlagArgs.length > 0) {
                    const firstArg = nonFlagArgs[0];
                    if (firstArg === '--all' || firstArg === '*') {
                        searchPattern = firstArg;
                        productNames = nonFlagArgs.slice(1).length > 0 ? nonFlagArgs.slice(1) : undefined;
                    } else {
                        const allProductNames = getProductsByName([]).map((p: Product) => p.name.toLowerCase());
                        const matchingProducts = nonFlagArgs.filter(arg =>
                            allProductNames.map(name => name.toLowerCase()).includes(arg.toLowerCase())
                        );

                        productNames = matchingProducts;
                    }
                }

                await listInstalled(searchPattern, productNames);
                return true;
            }

            case 'help':
            case '--help':
            case '-h':
                printHelp();
                return true;

            case 'exit':
            case 'quit':
            case 'q':
                console.log('Goodbye!');
                return false;

            case 'clear':
            case 'cls':
                console.clear();
                return true;

            default:
                if (command) {
                    console.error(`Unknown command: ${command}`);
                    console.log('Type "help" for usage information.');
                } else {
                    printHelp();
                }
                return true;
        }
    } catch (error) {
        console.error('Error:', error);
        return true;
    }
}

/**
 * Prints help for install command
 */
function printInstallHelp(): void {
    console.log(`
install, i - Download and install products

Usage:
  install [product-names...] [options]

Options:
  --concurrent, -c    Install concurrently instead of sequentially

Examples:
  install                           Install all products
  install native-access             Install only native-access
  install native-access waves-central  Install multiple products
  install --concurrent              Install all products concurrently
  install native-access --concurrent  Install specific product concurrently

Product names are case-insensitive. If no product names are provided, all products will be installed.
`);
}

/**
 * Prints help for cleanup command
 */
function printCleanupHelp(): void {
    console.log(`
cleanup, clean - Delete downloaded installer files

Usage:
  cleanup [download-dir]

Arguments:
  download-dir    Directory containing downloaded files (default: C:\\Users\\ccart\\Downloads)

Examples:
  cleanup                              Clean up default download directory
  cleanup "C:\\Users\\ccart\\Downloads"  Clean up specific directory
`);
}

/**
 * Prints help for list-downloads command
 */
function printListDownloadsHelp(): void {
    console.log(`
list-downloads, ld - List all downloaded installer files

Usage:
  list-downloads [download-dir]

Arguments:
  download-dir    Directory to search for downloaded files (default: C:\\Users\\ccart\\Downloads)

Examples:
  list-downloads                              List downloads in default directory
  list-downloads "C:\\Users\\ccart\\Downloads"  List downloads in specific directory
`);
}

/**
 * Prints help for uninstall command
 */
function printUninstallHelp(): void {
    console.log(`
uninstall, u - Uninstall products

Usage:
  uninstall [product-names...] [options]

Options:
  --concurrent, -c    Uninstall concurrently instead of sequentially
  --no-silent         Show uninstaller UI (default: silent)
  --timeout <ms>      Set timeout in milliseconds (default: 300000)

Examples:
  uninstall                         Uninstall all products
  uninstall native-access           Uninstall only native-access
  uninstall native-access waves-central  Uninstall multiple products
  uninstall --concurrent            Uninstall all products concurrently
  uninstall native-access --no-silent  Uninstall with UI visible
  uninstall --timeout 600000        Uninstall with 10 minute timeout

Product names are case-insensitive. If no product names are provided, all products will be uninstalled.
`);
}

/**
 * Prints help for list-installed command
 */
function printListInstalledHelp(): void {
    console.log(`
list-installed, li - List installed programs

Usage:
  list-installed [pattern] [product-names...]

Arguments:
  pattern         Search pattern to filter results (case-insensitive)
  product-names   Specific product names to check (case-insensitive)

Special Patterns:
  --all, *        List all installed programs on the system (not just tracked products)

Examples:
  list-installed                    List all installed tracked products
  list-installed "native"           List installed programs matching "native"
  list-installed native-access     List only native-access if installed
  list-installed --all              List all installed programs on system
  list-installed native-access waves-central  List multiple specific products

If product names are provided, only those products will be checked. Otherwise, all tracked products are checked.
`);
}

/**
 * Prints help information for all available commands
 */
export function printHelp(): void {
    console.log(`
Music Production Installer - CLI Commands

Interactive Mode:
  Run "npm start" to enter interactive mode. Commands can be entered repeatedly.
  Type "exit" or "quit" to exit.

Commands:
  install, i              Download and install products
                          Usage: install [product-names...] [options]
                          Options:
                            --concurrent, -c    Install concurrently instead of sequentially
                          Examples:
                            install                           (install all products)
                            install native-access              (install only native-access)
                            install native-access waves-central (install multiple products)
                            install --concurrent               (install all products concurrently)
                            install native-access --concurrent (install specific product concurrently)

  cleanup, clean          Delete downloaded installer files
                          Usage: cleanup [download-dir]
                          Example: cleanup "C:\\Users\\ccart\\Downloads"

  list-downloads, ld      List all downloaded installer files
                          Usage: list-downloads [download-dir]

  uninstall, u            Uninstall products
                          Usage: uninstall [product-names...] [options]
                          Options:
                            --concurrent, -c    Uninstall concurrently instead of sequentially
                            --no-silent         Show uninstaller UI
                            --timeout <ms>      Set timeout in milliseconds
                          Examples:
                            uninstall                         (uninstall all products)
                            uninstall native-access           (uninstall only native-access)
                            uninstall native-access waves-central (uninstall multiple products)
                            uninstall --concurrent            (uninstall all products concurrently)

  list-installed, li      List installed programs
                          Usage: list-installed [pattern] [product-names...]
                          Examples:
                            list-installed                    (list all installed products)
                            list-installed "native"           (list installed programs matching "native")
                            list-installed native-access      (list only native-access if installed)
                            list-installed --all              (list all installed programs on system)

  help, --help, -h        Show this help message
                          Use [command] -h or [command] --help for command-specific help

  exit, quit, q           Exit the interactive mode

  clear, cls              Clear the console

Examples (Interactive Mode):
  > install
  > install native-access
  > install native-access waves-central --concurrent
  > cleanup
  > list-downloads
  > uninstall native-access
  > uninstall --concurrent
  > list-installed
  > list-installed "native"
`);
}


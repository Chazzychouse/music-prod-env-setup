import {
    downloadAndInstall,
    cleanupDownloads,
    listDownloads,
    uninstallAllMatching,
    listInstalled,
} from './commands';
import products from './products';


/**
 * Executes a command with given arguments
 */
export async function executeCommand(command: string, args: string[]): Promise<boolean> {
    try {
        switch (command) {
            case 'install':
            case 'i':
                await downloadAndInstall(products, {
                    downloadDir: 'C:\\Users\\ccart\\Downloads',
                    concurrent: args.includes('--concurrent') || args.includes('-c'),
                });
                return true;

            case 'cleanup':
            case 'clean': {
                const cleanupDir = args[0] || 'C:\\Users\\ccart\\Downloads';
                await cleanupDownloads(cleanupDir);
                return true;
            }

            case 'list-downloads':
            case 'ld': {
                const listDir = args[0] || 'C:\\Users\\ccart\\Downloads';
                await listDownloads(listDir);
                return true;
            }

            case 'uninstall':
            case 'u':
                const flagArgs = args.filter(arg => arg.startsWith('--'));

                await uninstallAllMatching({
                    silent: !flagArgs.includes('--no-silent'),
                    timeout: flagArgs.includes('--timeout')
                        ? parseInt(flagArgs[flagArgs.indexOf('--timeout') + 1]) || 300000
                        : 300000,
                    concurrent: flagArgs.includes('--concurrent') || flagArgs.includes('-c'),
                });
                return true;

            case 'list-installed':
            case 'li': {
                const searchPattern = args[0];
                await listInstalled(searchPattern);
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
 * Prints help information for all available commands
 */
export function printHelp(): void {
    console.log(`
Music Production Installer - CLI Commands

Interactive Mode:
  Run "npm start" to enter interactive mode. Commands can be entered repeatedly.
  Type "exit" or "quit" to exit.

Commands:
  install, i              Download and install all items from urls.json
                          Options:
                            --concurrent, -c    Install concurrently instead of sequentially

  cleanup, clean          Delete downloaded installer files
                          Usage: cleanup [download-dir] [pattern]
                          Example: cleanup "C:\\Users\\ccart\\Downloads" "fl-studio"

  list-downloads, ld      List all downloaded installer files
                          Usage: list-downloads [download-dir]

  uninstall, u            Uninstall programs and plugins matching installedAppNames from urls.json
                          Usage: uninstall [options]
                          Options:
                            --concurrent, -c    Uninstall concurrently instead of sequentially
                            --no-silent         Show uninstaller UI
                            --timeout <ms>      Set timeout in milliseconds
                          Example: uninstall --concurrent (uninstalls all programs concurrently)
                          Example: uninstall              (uninstalls all programs and plugins matching installedAppNames)

  list-installed, li      List installed programs
                          Usage: list-installed [pattern]
                          Example: list-installed "fl studio"

  help, --help, -h        Show this help message

  exit, quit, q           Exit the interactive mode

  clear, cls              Clear the console

Examples (Interactive Mode):
  > install
  > install --concurrent
  > cleanup
  > list-downloads
  > uninstall
  > list-installed "native"
`);
}


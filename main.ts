import { createREPL } from './lib/cli';
import { executeCommand } from './lib/command-router';

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Creates and runs the REPL loop
 */
function startREPL(): void {
    createREPL(executeCommand, {
        prompt: '> ',
        welcomeMessage: 'Music Production Installer\nType "help" for available commands or "exit" to quit.\n',
        onExit: () => {
            console.log('Goodbye!');
        },
    });
}

/**
 * Main entry point - supports both REPL mode and single command mode
 */
async function main(): Promise<void> {
    // If command line arguments are provided, run in single-command mode
    const command = process.argv[2];
    // Process arguments - remove any PowerShell escape characters (^) that might have been added
    const rawArgs = process.argv.slice(3);
    const args = rawArgs.map(arg => arg.replace(/\^/g, ''));

    if (command) {
        // Single command mode (backward compatibility)
        const shouldContinue = await executeCommand(command, args);
        process.exit(shouldContinue ? 0 : 0);
    } else {
        // REPL mode - default behavior
        startREPL();
    }
}

main().catch(console.error);

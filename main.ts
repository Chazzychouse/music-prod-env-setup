import { createREPL } from './lib/cli';
import { executeCommand } from './lib/command-router';

// ============================================================================
// Main Entry Point
// ============================================================================

/* Extension:
    - Implement a file sync for projects and raw audio files
    - GUI for install functionality, verification, sampling, etc.
    - Integrate the installer and new apps
*/

function main(): void {
    createREPL(executeCommand, {
        prompt: '> ',
        welcomeMessage: 'Music Production Installer\nType "help" for available commands or "exit" to quit.\n',
        onExit: () => {
            console.log('Goodbye!');
        },
    });
}

main();

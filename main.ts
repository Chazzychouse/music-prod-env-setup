import { createChatLoop } from './lib/cli';
import { executeCommand } from './lib/command-router';

function main(): void {
    createChatLoop(executeCommand, {
        prompt: '> ',
        welcomeMessage: 'Music Production Installer\nType "help" for available commands or "exit" to quit.\n',
        onExit: () => {
            console.log('Goodbye!');
        },
    });
}

main();

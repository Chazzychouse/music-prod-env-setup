import * as readline from 'readline';

/**
 * Parses a command line string into command and arguments
 * Handles quoted strings for arguments with spaces
 */
export function parseCommand(input: string): { command: string; args: string[] } {
    const trimmed = input.trim();
    if (!trimmed) {
        return { command: '', args: [] };
    }

    // Simple parsing - split by spaces, handle quoted strings
    const parts: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < trimmed.length; i++) {
        const char = trimmed[i];
        if (char === '"' || char === "'") {
            inQuotes = !inQuotes;
        } else if (char === ' ' && !inQuotes) {
            if (current) {
                parts.push(current);
                current = '';
            }
        } else {
            current += char;
        }
    }
    if (current) {
        parts.push(current);
    }

    const command = parts[0] || '';
    const args = parts.slice(1);
    return { command, args };
}

/**
 * Options for creating a REPL interface
 */
export interface REPLOptions {
    prompt?: string;
    welcomeMessage?: string;
    onExit?: () => void;
}

/**
 * Creates and runs a REPL loop
 * @param commandExecutor Function that executes commands and returns whether to continue
 * @param options Configuration options for the REPL
 */
export function createREPL(
    commandExecutor: (command: string, args: string[]) => Promise<boolean>,
    options: REPLOptions = {},
): void {
    const { prompt = '> ', welcomeMessage, onExit } = options;

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt,
    });

    if (welcomeMessage) {
        console.log(welcomeMessage);
    }

    rl.prompt();

    rl.on('line', async (input: string) => {
        const { command, args } = parseCommand(input);
        try {
            const shouldContinue = await commandExecutor(command, args);

            if (!shouldContinue) {
                rl.close();
                return;
            }

            console.log(); // Add blank line after command
            rl.prompt();
        } catch (error) {
            console.error('Error:', error);
            console.log(); // Add blank line after error
            rl.prompt(); // Continue loop even on error
        }
    });

    rl.on('close', () => {
        if (onExit) {
            onExit();
        }
        process.exit(0);
    });
}


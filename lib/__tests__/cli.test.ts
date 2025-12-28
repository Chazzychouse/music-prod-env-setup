// Mock readline before importing the module under test
const mockCreateInterface = jest.fn();
jest.mock('readline', () => ({
    createInterface: mockCreateInterface,
}));

import { parseCommand, createChatLoop, ChatLoopOptions } from '../cli';
import * as readline from 'readline';

describe('cli', () => {
    describe('parseCommand', () => {
        it('should parse a simple command without arguments', () => {
            const result = parseCommand('help');
            expect(result.command).toBe('help');
            expect(result.args).toEqual([]);
        });

        it('should parse a command with a single argument', () => {
            const result = parseCommand('install app1');
            expect(result.command).toBe('install');
            expect(result.args).toEqual(['app1']);
        });

        it('should parse a command with multiple arguments', () => {
            const result = parseCommand('install app1 app2 app3');
            expect(result.command).toBe('install');
            expect(result.args).toEqual(['app1', 'app2', 'app3']);
        });

        it('should handle quoted arguments with spaces', () => {
            const result = parseCommand('uninstall "FL Studio"');
            expect(result.command).toBe('uninstall');
            expect(result.args).toEqual(['FL Studio']);
        });

        it('should handle single quotes', () => {
            const result = parseCommand("uninstall 'FL Studio'");
            expect(result.command).toBe('uninstall');
            expect(result.args).toEqual(['FL Studio']);
        });

        it('should handle multiple quoted arguments', () => {
            const result = parseCommand('install "FL Studio" "Native Instruments"');
            expect(result.command).toBe('install');
            expect(result.args).toEqual(['FL Studio', 'Native Instruments']);
        });

        it('should handle mixed quoted and unquoted arguments', () => {
            const result = parseCommand('install app1 "FL Studio" app2');
            expect(result.command).toBe('install');
            expect(result.args).toEqual(['app1', 'FL Studio', 'app2']);
        });

        it('should handle empty input', () => {
            const result = parseCommand('');
            expect(result.command).toBe('');
            expect(result.args).toEqual([]);
        });

        it('should handle whitespace-only input', () => {
            const result = parseCommand('   ');
            expect(result.command).toBe('');
            expect(result.args).toEqual([]);
        });

        it('should trim leading and trailing whitespace', () => {
            const result = parseCommand('  install app1  ');
            expect(result.command).toBe('install');
            expect(result.args).toEqual(['app1']);
        });

        it('should handle arguments with quotes inside', () => {
            const result = parseCommand('install "App with \'nested\' quotes"');
            expect(result.command).toBe('install');
            // The parser strips quotes inside quoted strings, which is expected behavior
            expect(result.args).toEqual(["App with nested quotes"]);
        });

        it('should handle flags and options', () => {
            const result = parseCommand('install --concurrent --timeout 5000');
            expect(result.command).toBe('install');
            expect(result.args).toEqual(['--concurrent', '--timeout', '5000']);
        });

        it('should handle quoted flags', () => {
            const result = parseCommand('install "--concurrent"');
            expect(result.command).toBe('install');
            expect(result.args).toEqual(['--concurrent']);
        });

        it('should handle multiple spaces between arguments', () => {
            const result = parseCommand('install  app1    app2');
            expect(result.command).toBe('install');
            expect(result.args).toEqual(['app1', 'app2']);
        });

        it('should handle empty quoted string', () => {
            const result = parseCommand('install ""');
            expect(result.command).toBe('install');
            // Empty quoted strings result in no argument (empty string is filtered)
            expect(result.args).toEqual([]);
        });

        it('should handle unclosed quotes', () => {
            const result = parseCommand('install "unclosed');
            expect(result.command).toBe('install');
            expect(result.args).toEqual(['unclosed']);
        });
    });

    describe('createChatLoop', () => {
        let mockRl: any;
        let originalExit: typeof process.exit;
        let exitSpy: jest.SpyInstance;
        let consoleLogSpy: jest.SpyInstance;
        let consoleClearSpy: jest.SpyInstance;
        let lineHandlers: Array<(input: string) => void>;
        let closeHandlers: Array<() => void>;

        beforeEach(() => {
            // Reset handlers
            lineHandlers = [];
            closeHandlers = [];
            jest.clearAllMocks();

            // Mock readline interface
            mockRl = {
                prompt: jest.fn(),
                close: jest.fn(),
                on: jest.fn((event: string, handler: any) => {
                    if (event === 'line') {
                        lineHandlers.push(handler);
                    } else if (event === 'close') {
                        closeHandlers.push(handler);
                    }
                }),
            };

            // Setup mock to return our mock interface
            mockCreateInterface.mockReturnValue(mockRl);

            // Mock process.exit
            originalExit = process.exit;
            exitSpy = jest.spyOn(process, 'exit').mockImplementation((code?: number | string | null) => {
                throw new Error(`process.exit(${code})`);
            });

            // Mock console methods
            consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
            consoleClearSpy = jest.spyOn(console, 'clear').mockImplementation();
        });

        afterEach(() => {
            exitSpy.mockRestore();
            consoleLogSpy.mockRestore();
            consoleClearSpy.mockRestore();
        });

        it('should create a readline interface with default prompt', () => {
            const commandExecutor = jest.fn().mockResolvedValue(true);
            createChatLoop(commandExecutor);

            expect(mockCreateInterface).toHaveBeenCalledWith({
                input: process.stdin,
                output: process.stdout,
                prompt: '> ',
            });
            expect(mockRl.prompt).toHaveBeenCalled();
        });

        it('should create a readline interface with custom prompt', () => {
            const commandExecutor = jest.fn().mockResolvedValue(true);
            createChatLoop(commandExecutor, { prompt: 'custom> ' });

            expect(mockCreateInterface).toHaveBeenCalledWith({
                input: process.stdin,
                output: process.stdout,
                prompt: 'custom> ',
            });
        });

        it('should display welcome message if provided', () => {
            const commandExecutor = jest.fn().mockResolvedValue(true);
            createChatLoop(commandExecutor, { welcomeMessage: 'Welcome!' });

            expect(consoleLogSpy).toHaveBeenCalledWith('Welcome!');
        });

        it('should not display welcome message if not provided', () => {
            const commandExecutor = jest.fn().mockResolvedValue(true);
            consoleLogSpy.mockClear();
            createChatLoop(commandExecutor);

            expect(consoleLogSpy).not.toHaveBeenCalled();
        });

        it('should execute command when line is entered', async () => {
            const commandExecutor = jest.fn().mockResolvedValue(true);
            createChatLoop(commandExecutor);

            // Simulate line input
            lineHandlers.forEach(handler => handler('install'));

            // Wait for async command execution
            await new Promise(resolve => setImmediate(resolve));

            expect(commandExecutor).toHaveBeenCalledWith('install', []);
            expect(consoleLogSpy).toHaveBeenCalledWith(); // Blank line
            expect(mockRl.prompt).toHaveBeenCalledTimes(2); // Initial + after command
        });

        it('should parse command and arguments correctly', async () => {
            const commandExecutor = jest.fn().mockResolvedValue(true);
            createChatLoop(commandExecutor);

            lineHandlers.forEach(handler => handler('install app1 app2'));

            await new Promise(resolve => setImmediate(resolve));

            expect(commandExecutor).toHaveBeenCalledWith('install', ['app1', 'app2']);
        });

        it('should handle quoted arguments', async () => {
            const commandExecutor = jest.fn().mockResolvedValue(true);
            createChatLoop(commandExecutor);

            lineHandlers.forEach(handler => handler('uninstall "FL Studio"'));

            await new Promise(resolve => setImmediate(resolve));

            expect(commandExecutor).toHaveBeenCalledWith('uninstall', ['FL Studio']);
        });

        it('should continue loop when command executor returns true', async () => {
            const commandExecutor = jest.fn().mockResolvedValue(true);
            createChatLoop(commandExecutor);

            lineHandlers.forEach(handler => handler('help'));
            await new Promise(resolve => setImmediate(resolve));

            lineHandlers.forEach(handler => handler('install'));
            await new Promise(resolve => setImmediate(resolve));

            expect(commandExecutor).toHaveBeenCalledTimes(2);
            expect(mockRl.close).not.toHaveBeenCalled();
        });

        it('should exit loop when command executor returns false', async () => {
            const commandExecutor = jest.fn().mockResolvedValue(false);
            createChatLoop(commandExecutor);

            lineHandlers.forEach(handler => handler('exit'));
            await new Promise(resolve => setImmediate(resolve));

            expect(commandExecutor).toHaveBeenCalledWith('exit', []);
            expect(mockRl.close).toHaveBeenCalled();
        });

        it('should call onExit callback when REPL closes', () => {
            const commandExecutor = jest.fn().mockResolvedValue(false);
            const onExit = jest.fn();
            createChatLoop(commandExecutor, { onExit });

            expect(() => {
                closeHandlers.forEach(handler => handler());
            }).toThrow('process.exit(0)');
            expect(onExit).toHaveBeenCalled();
        });

        it('should not call onExit if not provided', () => {
            const commandExecutor = jest.fn().mockResolvedValue(false);
            createChatLoop(commandExecutor);

            // process.exit will still be called, but onExit won't be
            expect(() => {
                closeHandlers.forEach(handler => handler());
            }).toThrow('process.exit(0)');
        });

        it('should handle command executor errors gracefully', async () => {
            const commandExecutor = jest.fn().mockRejectedValue(new Error('Test error'));
            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

            createChatLoop(commandExecutor);

            lineHandlers.forEach(handler => handler('install'));
            await new Promise(resolve => setImmediate(resolve));

            expect(commandExecutor).toHaveBeenCalled();
            expect(consoleErrorSpy).toHaveBeenCalledWith('Error:', expect.any(Error));
            expect(mockRl.close).not.toHaveBeenCalled(); // Should continue on error
            expect(mockRl.prompt).toHaveBeenCalledTimes(2); // Initial + after error

            consoleErrorSpy.mockRestore();
        });

        it('should handle multiple commands in sequence', async () => {
            const commandExecutor = jest.fn().mockResolvedValue(true);
            createChatLoop(commandExecutor);

            lineHandlers.forEach(handler => handler('help'));
            await new Promise(resolve => setImmediate(resolve));

            lineHandlers.forEach(handler => handler('list-downloads'));
            await new Promise(resolve => setImmediate(resolve));

            lineHandlers.forEach(handler => handler('install'));
            await new Promise(resolve => setImmediate(resolve));

            expect(commandExecutor).toHaveBeenCalledTimes(3);
            expect(commandExecutor).toHaveBeenNthCalledWith(1, 'help', []);
            expect(commandExecutor).toHaveBeenNthCalledWith(2, 'list-downloads', []);
            expect(commandExecutor).toHaveBeenNthCalledWith(3, 'install', []);
        });

        it('should handle empty input', async () => {
            const commandExecutor = jest.fn().mockResolvedValue(true);
            createChatLoop(commandExecutor);

            lineHandlers.forEach(handler => handler(''));
            await new Promise(resolve => setImmediate(resolve));

            expect(commandExecutor).toHaveBeenCalledWith('', []);
        });

        it('should exit process when REPL closes', () => {
            const commandExecutor = jest.fn().mockResolvedValue(false);
            createChatLoop(commandExecutor);

            expect(() => {
                closeHandlers.forEach(handler => handler());
            }).toThrow('process.exit(0)');
        });
    });
});


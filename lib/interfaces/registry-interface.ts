import { exec } from 'child_process';
import { promisify } from 'util';

/**
 * Registry access abstraction interface for testability
 */
export interface IRegistryAccess {
    exec(command: string): Promise<{ stdout: string; stderr: string }>;
}

/**
 * Default implementation using Node.js child_process.exec
 */
export class NodeRegistryAccess implements IRegistryAccess {
    async exec(command: string): Promise<{ stdout: string; stderr: string }> {
        const execAsync = promisify(exec);
        return execAsync(command);
    }
}


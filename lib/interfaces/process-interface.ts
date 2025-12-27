import { spawn, ChildProcess } from 'child_process';

/**
 * Process execution abstraction interface for testability
 */
export interface IProcessExecutor {
    spawn(command: string, args: string[], options?: { stdio?: any; shell?: boolean }): ChildProcess;
}

/**
 * Default implementation using Node.js child_process
 */
export class NodeProcessExecutor implements IProcessExecutor {
    spawn(command: string, args: string[], options?: { stdio?: any; shell?: boolean }): ChildProcess {
        return spawn(command, args, options);
    }
}


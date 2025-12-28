/**
 * Result of a delete operation
 */
export type DeleteResult = {
    name: string;
    path: string;
    deleted: boolean;
    error?: Error;
}

/**
 * Options for creating a REPL interface
 */
export type ChatLoopOptions = {
    prompt?: string;
    welcomeMessage?: string;
    onExit?: () => void;
}


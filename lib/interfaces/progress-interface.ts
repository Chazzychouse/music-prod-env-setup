/**
 * Progress bar abstraction interface for testability
 */
export interface IProgressBar {
    setTotal(total: number): void;
    update(value: number): void;
    stop(): void;
}

export interface IProgressMultiBar {
    create(total: number, startValue: number, payload: { name: string }): IProgressBar;
    stop(): void;
}

export interface IProgressBarFactory {
    createMultiBar(options?: any): IProgressMultiBar;
}


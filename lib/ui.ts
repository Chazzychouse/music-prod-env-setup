import * as cliProgress from 'cli-progress';
import { IProgressBar, IProgressMultiBar, IProgressBarFactory } from './interfaces/progress-interface';

// ============================================================================
// Progress Bar
// ============================================================================

interface IProgressBarProps {
    format?: string;
    barCompleteChar?: string;
    barIncompleteChar?: string;
    hideCursor?: boolean;
    clearOnComplete?: boolean;
    stopOnComplete?: boolean;
    preset?: cliProgress.Preset;
}

/**
 * Wrapper for cli-progress progress bar to match our interface
 */
class CliProgressBarWrapper implements IProgressBar {
    private bar: cliProgress.SingleBar;

    constructor(bar: cliProgress.SingleBar) {
        this.bar = bar;
    }

    setTotal(total: number): void {
        this.bar.setTotal(total);
    }

    update(value: number): void {
        this.bar.update(value);
    }

    stop(): void {
        this.bar.stop();
    }
}

/**
 * Wrapper for cli-progress multi-bar to match our interface
 */
class CliProgressMultiBarWrapper implements IProgressMultiBar {
    private multibar: cliProgress.MultiBar;

    constructor(multibar: cliProgress.MultiBar) {
        this.multibar = multibar;
    }

    create(total: number, startValue: number, payload: { name: string }): IProgressBar {
        const bar = this.multibar.create(total, startValue, payload);
        return new CliProgressBarWrapper(bar);
    }

    stop(): void {
        this.multibar.stop();
    }
}

/**
 * Default progress bar factory implementation
 */
export class CliProgressBarFactory implements IProgressBarFactory {
    createMultiBar(options?: IProgressBarProps): IProgressMultiBar {
        const multibar = new cliProgress.MultiBar({
            format: options?.format ?? '{name} |{bar}| {percentage}% | {value}/{total} bytes | ETA: {eta}s',
            barCompleteChar: options?.barCompleteChar ?? '\u2588',
            barIncompleteChar: options?.barIncompleteChar ?? '\u2591',
            hideCursor: options?.hideCursor ?? true,
            clearOnComplete: options?.clearOnComplete ?? true,
            stopOnComplete: options?.stopOnComplete ?? true,
        }, options?.preset ?? cliProgress.Presets.shades_classic);

        return new CliProgressMultiBarWrapper(multibar);
    }
}

/**
 * Creates a multi-progress bar for displaying multiple download progress bars
 * @deprecated Use CliProgressBarFactory instead for better testability
 */
export function createProgressMultiBar(props: IProgressBarProps): cliProgress.MultiBar {
    const factory = new CliProgressBarFactory();
    const wrapper = factory.createMultiBar(props);
    // Return the underlying multibar for backward compatibility
    return (wrapper as any).multibar;
}

// ============================================================================
// Status Display
// ============================================================================

type Status = 'pending' | 'installing' | 'uninstalling' | 'completed' | 'failed';

interface StatusInfo {
    status: Status;
    elapsed?: number;
}

/**
 * Displays status updates for installation/uninstallation operations
 */
export class StatusDisplay {
    private statusLines: Map<string, StatusInfo> = new Map();
    private spinnerChars = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    private spinnerIndex = 0;
    private items: Array<{ name: string }> = [];
    private updateInterval: NodeJS.Timeout | null = null;

    constructor(items: Array<{ name: string }>) {
        this.items = items;
        items.forEach(item => {
            this.statusLines.set(item.name, { status: 'pending' });
        });
    }

    setStatus(name: string, status: Status, elapsed?: number): void {
        this.statusLines.set(name, { status, elapsed });
    }

    private updateDisplay(): void {
        const total = this.items.length;
        // Clear previous lines (move cursor up and clear each line)
        // Only move up if we have items to display
        if (total > 0) {
            process.stdout.write('\x1b[' + total + 'A');
        }

        this.items.forEach((item, index) => {
            const status = this.statusLines.get(item.name)!;
            let icon = '○';
            let text = '';

            if (status.status === 'pending') {
                icon = '○';
                text = 'Pending';
            } else if (status.status === 'installing') {
                icon = this.spinnerChars[this.spinnerIndex % this.spinnerChars.length];
                const elapsed = status.elapsed ? Math.floor(status.elapsed / 1000) : 0;
                text = `Installing... (${elapsed}s)`;
            } else if (status.status === 'uninstalling') {
                icon = this.spinnerChars[this.spinnerIndex % this.spinnerChars.length];
                const elapsed = status.elapsed ? Math.floor(status.elapsed / 1000) : 0;
                text = `Uninstalling... (${elapsed}s)`;
            } else if (status.status === 'completed') {
                icon = '✓';
                text = 'Completed';
            } else if (status.status === 'failed') {
                icon = '✗';
                text = 'Failed';
            }

            const prefix = total > 1 ? `[${index + 1}/${total}]` : '';
            // Clear the line and write new content
            process.stdout.write('\x1b[K'); // Clear from cursor to end of line
            process.stdout.write(`  ${icon} ${prefix} ${item.name.padEnd(25)} ${text}\n`);
        });

        // Only increment spinner if there are items still installing or uninstalling
        const hasInstalling = Array.from(this.statusLines.values()).some(s => s.status === 'installing' || s.status === 'uninstalling');
        if (hasInstalling) {
            this.spinnerIndex++;
        }
    }

    start(): void {
        // Initial display
        const total = this.items.length;
        this.items.forEach((item, index) => {
            const prefix = total > 1 ? `[${index + 1}/${total}]` : '';
            process.stdout.write(`  ○ ${prefix} ${item.name.padEnd(25)} Pending\n`);
        });

        this.updateInterval = setInterval(() => {
            this.updateDisplay();
        }, 100);
    }

    stop(): void {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
        // Final update to show final status (no spinner)
        const total = this.items.length;
        if (total > 0) {
            process.stdout.write('\x1b[' + total + 'A');
        }

        this.items.forEach((item, index) => {
            const status = this.statusLines.get(item.name)!;
            let icon = '○';
            let text = '';

            if (status.status === 'pending') {
                icon = '○';
                text = 'Pending';
            } else if (status.status === 'installing') {
                icon = '○'; // Use static icon instead of spinner
                const elapsed = status.elapsed ? Math.floor(status.elapsed / 1000) : 0;
                text = `Installing... (${elapsed}s)`;
            } else if (status.status === 'uninstalling') {
                icon = '○'; // Use static icon instead of spinner
                const elapsed = status.elapsed ? Math.floor(status.elapsed / 1000) : 0;
                text = `Uninstalling... (${elapsed}s)`;
            } else if (status.status === 'completed') {
                icon = '✓';
                text = 'Completed';
            } else if (status.status === 'failed') {
                icon = '✗';
                text = 'Failed';
            }

            const prefix = total > 1 ? `[${index + 1}/${total}]` : '';
            // Clear the line and write new content
            process.stdout.write('\x1b[K'); // Clear from cursor to end of line
            process.stdout.write(`  ${icon} ${prefix} ${item.name.padEnd(25)} ${text}\n`);
        });

        process.stdout.write('\n');
    }

    finalize(): void {
        this.stop();
    }
}


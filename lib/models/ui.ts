import * as cliProgress from 'cli-progress';

/**
 * Options for configuring a progress bar
 */
export type ProgressBarProps = {
    format?: string;
    barCompleteChar?: string;
    barIncompleteChar?: string;
    hideCursor?: boolean;
    clearOnComplete?: boolean;
    stopOnComplete?: boolean;
    preset?: cliProgress.Preset;
}


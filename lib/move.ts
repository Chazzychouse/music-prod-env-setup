import * as fs from 'fs';
import * as path from 'path';

const SPLICE_SAMPLES_PATH = "C:\\Users\\ccart\\Documents\\Splice\\Samples";
const SAMPLES_PATH = "C:\\Users\\ccart\\prod\\samples";

async function copyDirectory(src: string, dest: string): Promise<void> {
    // Ensure destination directory exists
    await fs.promises.mkdir(dest, { recursive: true });

    // Read all entries in the source directory
    const entries = await fs.promises.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
            // Recursively copy subdirectories
            await copyDirectory(srcPath, destPath);
        } else {
            // Copy files
            await fs.promises.copyFile(srcPath, destPath);
        }
    }
}

export async function copySpliceToSamples() {
    // Check if source exists
    try {
        const stats = await fs.promises.stat(SPLICE_SAMPLES_PATH);
        if (!stats.isDirectory()) {
            throw new Error(`Source path is not a directory: ${SPLICE_SAMPLES_PATH}`);
        }
    } catch (error: any) {
        if (error.code === 'ENOENT') {
            throw new Error(`Source directory does not exist: ${SPLICE_SAMPLES_PATH}`);
        }
        throw error;
    }

    // Create a "Splice" subdirectory in the samples directory
    const spliceDestPath = path.join(SAMPLES_PATH, 'Splice');
    await copyDirectory(SPLICE_SAMPLES_PATH, spliceDestPath);
}
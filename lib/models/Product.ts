export type Product = {
    /** The name identifier for the product */
    name: string;

    /** The download URL for the product installer */
    url: string;

    /** 
     * Array of application names to check for when verifying installation.
     * Used to detect if the product is already installed.
     */
    installedAppNames?: string[];

    /** 
     * If true, the installer requires manual user interaction and cannot be automated.
     * Defaults to false if not specified. Set this to true for any product you do not
     * want to install silently.
     */
    requiresManualInstallation?: boolean;

    /** 
     * Specific installer file names to look for in an extracted folder.
     * Useful for MSI files that are not named like the product name, 
     * or when needing to install multiple files.
     */
    installerPaths?: string[];
}
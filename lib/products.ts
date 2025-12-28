import { Product } from "./models/Product";

const products: Product[] = [
    {
        "name": "fl-studio",
        "url": "https://support.image-line.com/redirect/flstudio_win_installer?_gl=1*vzy17g*_gcl_au*MTYzNjA0NTQwNS4xNzY2Nzc2OTY0",
        "installedAppNames": [
            "FL Studio",
            "FL Cloud"
        ]
    },
    {
        name: "native-instruments",
        url: "https://www.native-instruments.com/fileadmin/downloads/Native-Access_2.exe",
        requiresManualInstallation: true,
        installedAppNames: [
            "Native Instruments"
        ],
    },
    {
        name: "waves-central",
        url: "https://cf-installers.waves.com/WavesCentral/Install_Waves_Central.exe",
        installedAppNames: [
            "Waves Central"
        ]
    },
    {
        name: "kilohearts",
        url: "https://khs-files.becdn.net/installer/Kilohearts%20Installer.exe?filename=Kilohearts%20Installer.exe",
        requiresManualInstallation: true,
        installedAppNames: [
            "Kilohearts",
            "kHs"
        ]
    },
    {
        name: "gullfoss",
        url: "https://www.soundtheory.com/static/Soundtheory%20Gullfoss%201.11.9.zip",
        requiresManualInstallation: true,
        installedAppNames: [
            "Gullfoss"
        ]
    },
    {
        name: "tokyo-compressor",
        url: "https://www.tokyodawn.net/labs/Kotelnikov/1.6.5/TDR%20Kotelnikov%20(installer).zip",
        requiresManualInstallation: true,
        installedAppNames: [
            "TDR Kotelnikov",
            "TDR "
        ]
    },
    {
        "name": "tal-chorus",
        "url": "https://tal-software.com/downloads/plugins/install_TAL-Chorus-LX.zip",
        "requiresManualInstallation": true,
        "installedAppNames": [
            "TAL-"
        ],
        "installerPaths": [
            "installer_aax_64.msi",
            "installer_vst3_64.msi"
        ]
    },
    {
        "name": "valhalla-supermassive",
        "url": "https://valhallaproduction.s3.us-west-2.amazonaws.com/supermassive/ValhallaSupermassiveWin_V5_0_0.zip",
        "installedAppNames": [
            "ValhallaSupermassive"
        ]
    },
    {
        "name": "pro-q-4",
        "url": "https://cdn-b.fabfilter.com/downloads/ffproq402x64.exe",
        "installedAppNames": [
            "FabFilter"
        ]
    }
];

export default products;


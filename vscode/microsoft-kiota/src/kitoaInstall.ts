import * as path from 'path';
import * as https from 'https';
import * as fs from 'fs';
import {createHash} from 'crypto';
import * as admZip from 'adm-zip';
import * as vscode from "vscode";


export async function ensureKiotaIsPresent(context: vscode.ExtensionContext) {
    const runtimeDependencies = getRuntimeDependenciesPackages(context);
    const currentPlatform = getCurrentPlatform();
    const packageToInstall = runtimeDependencies.find((p) => p.platformId === currentPlatform);
    if (packageToInstall) {
        const installPath = context.asAbsolutePath(packageToInstall.installPath);
        if (!fs.existsSync(installPath)) {
            fs.mkdirSync(installPath, { recursive: true });
            const zipFilePath = `${installPath}.zip`;
            await downloadFileFromUrl(packageToInstall.url, zipFilePath);
            if (await doesFileHashMatch(zipFilePath, packageToInstall.sha256)) {
                unzipFile(zipFilePath, installPath.substring(0, installPath.length - currentPlatform.length)); // the unzipping already uses file name
            } else {
                fs.rmdirSync(installPath, { recursive: true });
            }
        }
    }
}

let kiotaPath: string | undefined;

export function getKiotaPath(context: vscode.ExtensionContext): string {
    if (!kiotaPath) {
        kiotaPath = getKiotaPathInternal(context);
        if(!kiotaPath) {
            throw new Error("Could not find kiota");
        }
    }
    return kiotaPath;
}

function getKiotaPathInternal(context: vscode.ExtensionContext): string | undefined {
    const fileName = process.platform === 'win32' ? 'kiota.exe' : 'kiota';
    const runtimeDependencies = getRuntimeDependenciesPackages(context);
    const currentPlatform = getCurrentPlatform();
    const packageToInstall = runtimeDependencies.find((p) => p.platformId === currentPlatform);
    if (packageToInstall) {
        const installPath = context.asAbsolutePath(packageToInstall.installPath);
        return path.join(installPath, fileName);
    }
    return undefined;
}

function unzipFile(zipFilePath: string, destinationPath: string) {
    const zip = new admZip(zipFilePath);
    zip.extractAllTo(destinationPath, true);
}

async function doesFileHashMatch(destinationPath: string, hashValue: string) : Promise<boolean> {
    const hash = createHash('sha256');
    return new Promise((resolve, reject) => {
        fs.createReadStream(destinationPath).pipe(hash).on('finish', () => {;
            const computedValue = hash.digest('hex');
            hash.destroy();
            resolve(computedValue.toUpperCase() === hashValue.toUpperCase());
        });
    });
}

function downloadFileFromUrl(url: string, destinationPath: string) {
    return new Promise((resolve, reject) => {
        https.get(url, (response) => {
            if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                resolve(downloadFileFromUrl(response.headers.location, destinationPath));
            } else {
                const filePath = fs.createWriteStream(destinationPath);
                response.pipe(filePath);
                filePath.on('finish', () => {
                    filePath.close();
                    resolve(undefined);
                });
            }
        });
    });
}

function getRuntimeDependenciesPackages(context: vscode.ExtensionContext): Package[] {
    const packageJSON = context.extension.packageJSON;
    if (packageJSON.runtimeDependencies) {
        return JSON.parse(JSON.stringify(<Package[]>packageJSON.runtimeDependencies));
    }
    throw new Error("No runtime dependencies found");
}

export interface Package {
    id: string;
    description: string;
    url: string;
    installPath: string;
    platformId: string;
    sha256: string;
}

export function getCurrentPlatform(): string {
    const binPathSegmentOS = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'osx' : 'linux';
    return `${binPathSegmentOS}-${process.arch}`;
}
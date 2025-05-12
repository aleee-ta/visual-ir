import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as util from 'util';

const readdir = util.promisify(fs.readdir);
const stat = util.promisify(fs.stat);

export interface CacheQuickPickItem extends vscode.QuickPickItem {
    description: string;
    fullPath: string;
}

export async function showCacheQuickPick(cachePath: string): Promise<string | undefined> {
    if (!fs.existsSync(cachePath)) {
        vscode.window.showErrorMessage('Cache directory does not exist');
        return;
    }

    const items = await Promise.all(
        (await readdir(cachePath)).map(async item => {
            const fullPath = path.join(cachePath, item);
            const isDir = (await stat(fullPath)).isDirectory();

            const timestamp = parseInt(item, 10);
            const date = new Date(timestamp/1e6);
            
            return {
                label: date.toLocaleString(),
                description: item,
                fullPath: fullPath
            } as CacheQuickPickItem;
        })
    );

    const validItems = items.filter(item => item !== null) as CacheQuickPickItem[];
    
    if (validItems.length === 0) {
        vscode.window.showInformationMessage('No cache entries found');
        return;
    }

    const selected = await vscode.window.showQuickPick(validItems.sort((a, b) => 
        parseInt(b.description, 10) - parseInt(a.description, 10)
    ), {
        placeHolder: 'Select cache entry'
    });

    return selected?.fullPath;
}
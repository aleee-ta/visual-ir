import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { IrExplorerProvider } from './explorer';
import { showCacheQuickPick } from './quickpick';
import { openFile } from './openfile';

export async function activate(context: vscode.ExtensionContext) {
    const config = vscode.workspace.getConfiguration('visual-ir');
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    const cachePath = path.join(workspaceRoot, config.get('cachePath', 'target/cache'));
    
    let initialPath = cachePath;
    try {
        const subDirs = await fs.promises.readdir(cachePath);
        const timestampDirs = subDirs.sort((a, b) => parseInt(b) - parseInt(a));
        
        if (timestampDirs.length > 0) {
            initialPath = path.join(cachePath, timestampDirs[0]);
        }
    } catch (error) {
        vscode.window.showErrorMessage(`Cache IR initialization failed: ${error}`);
    }
    const provider = new IrExplorerProvider(initialPath);

    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('irItems', provider),
        
        vscode.commands.registerCommand('visual-ir.refresh', () => {
            provider.refresh();
        }),
        
        vscode.commands.registerCommand('visual-ir.openFile', openFile),

        vscode.commands.registerCommand('visual-ir.selectCache', async () => {
            const selectedPath = await showCacheQuickPick(cachePath);
            if (selectedPath) {
                provider.refresh(selectedPath);
            }
        })
    );
}

export function deactivate() {}

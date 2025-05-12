import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as util from 'util';

const readdir = util.promisify(fs.readdir);
const stat = util.promisify(fs.stat);

export class IrExplorerProvider implements vscode.TreeDataProvider<IrItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<IrItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private cacheRoot: string) {}

    refresh(newPath?: string): void {
        if (newPath) {
            this.cacheRoot = newPath;
        }
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: IrItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: IrItem): Promise<IrItem[]> {
        if (!this.cacheRoot) { return []; }
        
        if (!element) {
            return this.getDirectoryItems(this.cacheRoot);
        } 
        return this.getDirectoryItems(element.resourcePath);
    }

    private async getDirectoryItems(dirPath: string): Promise<IrItem[]> {
        try {
            const items = await readdir(dirPath);
            const filtered = await Promise.all(items.map(async item => {
                const fullPath = path.join(dirPath, item);
                const stats = await stat(fullPath);

                if (stats.isDirectory()) {
                    return new IrItem(
                        item,
                        vscode.TreeItemCollapsibleState.Collapsed,
                        fullPath
                    );
                }

                const isTargetFile = ['.acir.txt', '.ssa.txt', '.nr'].some(ext => 
                    item.endsWith(ext)
                );
    
                if (isTargetFile) {
                    return new IrItem(
                        item,
                        vscode.TreeItemCollapsibleState.None,
                        fullPath,
                        {
                            command: 'visual-ir.openFile',
                            title: 'Open File',
                            arguments: [fullPath]
                        }
                    );
                }
                return null;
            }));

            return filtered.filter(item => item !== null) as IrItem[];
        } catch (error) {
            vscode.window.showErrorMessage(`Directory read error: ${error}`);
            return [];
        }
    }
}

export class IrItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly resourcePath: string,
        public readonly command?: vscode.Command
    ) {
        super(label, collapsibleState);
        this.tooltip = this.resourcePath;
        this.iconPath = this.getIcon();
    }

    private getIcon(): string | vscode.ThemeIcon {
        return this.collapsibleState === vscode.TreeItemCollapsibleState.None
            ? new vscode.ThemeIcon('file')
            : new vscode.ThemeIcon('folder');
    }
}
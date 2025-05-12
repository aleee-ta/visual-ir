import * as vscode from 'vscode';
import * as path from 'path';

interface CodeLocation {
    value: {
        span: { start: number; end: number };
        file: number;
    };
}

interface CodeData {
    call_stack_data: {
        locations: CodeLocation[];
    };
}

let ssaWebviewPanel: vscode.WebviewPanel | undefined;
const jsonCache = new Map<string, CodeData>();
const openEditors = new Map<string, vscode.TextEditor>();
const decorationCache = new Map<string, vscode.TextEditorDecorationType>();

export async function openFile(filePath: string) {
    const uri = vscode.Uri.file(filePath);
    const ext = path.basename(filePath);

    try {
        if (ext.endsWith('.acir.txt')) {
            await openAcirView(uri);
        } else if (ext.endsWith('.ssa.txt')) {
            await openSsaView(uri);
        } else if (ext.endsWith('.nr')) {
            await openNrFile(uri);
        } else {
            vscode.window.showErrorMessage(`Unsupported file type: ${ext}`);
        }
    } catch (error) {
        vscode.window.showErrorMessage(`Error opening file: ${error}`);
    }
}

async function openSsaView(uri: vscode.Uri) {
    const document = await vscode.workspace.openTextDocument(uri);
    const rawContent = document.getText();

    const jsonUri = vscode.Uri.file(uri.fsPath.replace(/\.txt$/, '.json'));
    let jsonData: CodeData;
    
    try {
        if (!jsonCache.has(jsonUri.fsPath)) {
            const jsonContent = await vscode.workspace.fs.readFile(jsonUri);
            jsonData = JSON.parse(jsonContent.toString());
            jsonCache.set(jsonUri.fsPath, jsonData);
        } else {
            jsonData = jsonCache.get(jsonUri.fsPath)!;
        }
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to load JSON data: ${error}`);
        return;
    }

    const processedContent = processSsaContent(rawContent);

    if (!ssaWebviewPanel) {
        ssaWebviewPanel = vscode.window.createWebviewPanel(
            'ssaViewer',
            'SSA Viewer',
            vscode.ViewColumn.One,
            { enableScripts: true }
        );
        
        setupWebviewMessageListener(ssaWebviewPanel, uri);
    }

    ssaWebviewPanel.reveal();
    ssaWebviewPanel.webview.html = getWebviewHtml(processedContent);
}

function processSsaContent(content: string): string {
    return content
        .split('\n')
        .map(line => {
            const match = line.match(/\/\/ L(\d+)/);
            if (match) {
                return line.replace(
                    /\/\/ L\d+/,
                    `<span class="location-marker" data-location-id="${match[1]}">// L${match[1]}</span>`
                );
            }
            return line.split('//')[0].trimEnd();
        })
        .join('\n');
}

function getWebviewHtml(content: string): string {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                .location-marker:hover {
                    background: rgba(255,255,0,0.3);
                    cursor: pointer;
                }
                pre { 
                    padding: 10px;
                    font-family: var(--vscode-editor-font-family);
                    font-size: var(--vscode-editor-font-size);
                }
            </style>
        </head>
        <body>
            <pre>${content}</pre>
            <script>
                const vscode = acquireVsCodeApi();
                document.querySelectorAll('.location-marker').forEach(element => {
                    element.addEventListener('mouseenter', () => {
                        vscode.postMessage({
                            type: 'hoverLocation',
                            locationId: element.dataset.locationId
                        });
                    });
                    element.addEventListener('mouseleave', () => {
                        vscode.postMessage({
                            type: 'clearHighlight'
                        });
                    });
                });
            </script>
        </body>
        </html>
    `;
}

function setupWebviewMessageListener(panel: vscode.WebviewPanel, ssaUri: vscode.Uri) {
    panel.webview.onDidReceiveMessage(async message => {
        switch (message.type) {
            case 'hoverLocation':
                handleLocationHover(message, ssaUri);
                break;
            case 'clearHighlight':
                clearHighlightDecorations();
                break;
        }
    });
}

async function handleLocationHover(message: any, ssaUri: vscode.Uri) {
    const locationId = parseInt(message.locationId);
    const jsonData = jsonCache.get(ssaUri.fsPath.replace(/\.txt$/, '.json'));

    if (!jsonData?.call_stack_data?.locations?.[locationId]) {
        console.error(`Location ${locationId} not found in JSON data`);
        return;
    }

    const location = jsonData.call_stack_data.locations[locationId];
    console.log(`Processing location:`, JSON.stringify(location, null, 2));

    // Получение абсолютного пути к целевому файлу
    const baseDir = path.dirname(ssaUri.fsPath);
    const targetPath = path.resolve(
        baseDir,
        '..',
        'src',
        `${location.value.file}.nr`
    );
    console.log(`Calculated target path: ${targetPath}`);

    try {
        const targetUri = vscode.Uri.file(targetPath);
        console.log(`Trying to open: ${targetUri.fsPath}`);

        // Открытие документа с проверкой существования
        let document: vscode.TextDocument;
        try {
            document = await vscode.workspace.openTextDocument(targetUri);
        } catch (error) {
            vscode.window.showErrorMessage(`File not found: ${targetUri.fsPath}`);
            return;
        }

        // Получение позиций с обработкой ошибок
        let startPos: vscode.Position;
        let endPos: vscode.Position;
        try {
            startPos = document.positionAt(location.value.span.start);
            endPos = document.positionAt(location.value.span.end);
        } catch (error) {
            console.error(`Invalid span positions: ${error}`);
            return;
        }

        console.log(`Calculated positions: ${startPos.line}:${startPos.character} - ${endPos.line}:${endPos.character}`);

        // Открытие редактора с проверкой
        let editor: vscode.TextEditor;
        if (openEditors.has(targetUri.fsPath)) {
            editor = openEditors.get(targetUri.fsPath)!;
            console.log(`Using cached editor for ${targetUri.fsPath}`);
        } else {
            editor = await vscode.window.showTextDocument(document, {
                viewColumn: vscode.ViewColumn.Two,
                preserveFocus: true
            });
            openEditors.set(targetUri.fsPath, editor);
            console.log(`Opened new editor for ${targetUri.fsPath}`);
        }

        // Обновление выделения
        editor.selections = [new vscode.Selection(startPos, endPos)];
        editor.revealRange(new vscode.Range(startPos, endPos), 
            vscode.TextEditorRevealType.InCenterIfOutsideViewport);

        // Яркая временная подсветка
        const decoration = vscode.window.createTextEditorDecorationType({
            backgroundColor: new vscode.ThemeColor('editor.selectionBackground'),
            border: '1px solid yellow',
            isWholeLine: true
        });

        editor.setDecorations(decoration, [new vscode.Range(startPos, endPos)]);
        console.log(`Applied decorations`);

        // Автоматическая очистка через 2 секунды
        setTimeout(() => {
            decoration.dispose();
            console.log(`Disposed decorations for ${targetUri.fsPath}`);
        }, 2000);

    } catch (error) {
        vscode.window.showErrorMessage(`Error: ${error instanceof Error ? error.message : String(error)}`);
        console.error('Full error:', error);
    }
}

function clearHighlightDecorations() {
    decorationCache.forEach((decoration, uri) => {
        decoration.dispose();
    });
    decorationCache.clear();
}

vscode.window.onDidChangeVisibleTextEditors(editors => {
    editors.forEach(editor => {
        if (!openEditors.has(editor.document.uri.fsPath)) {
            const decoration = decorationCache.get(editor.document.uri.fsPath);
            decoration?.dispose();
            decorationCache.delete(editor.document.uri.fsPath);
        }
    });
});


let acirWebviewPanel: vscode.WebviewPanel | undefined;


async function openAcirView(uri: vscode.Uri) {
    const document = await vscode.workspace.openTextDocument(uri);
    const content = document.getText();

    if (!acirWebviewPanel) {
        acirWebviewPanel = vscode.window.createWebviewPanel(
            'acirViewer',
            'ACIR Viewer',
            vscode.ViewColumn.One,
            {}
        );

        acirWebviewPanel.webview.html = `
            <!DOCTYPE html>
            <html>
            <body>
                <pre>${content}</pre>
            </body>
            </html>
        `;
    } else {
        acirWebviewPanel.reveal();
        acirWebviewPanel.webview.html = `
            <!DOCTYPE html>
            <html>
            <body>
                <pre>${content}</pre>
            </body>
            </html>
        `;
    }

    acirWebviewPanel.onDidDispose(() => {
        acirWebviewPanel = undefined;
    });
}

async function openNrFile(uri: vscode.Uri) {
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);
}

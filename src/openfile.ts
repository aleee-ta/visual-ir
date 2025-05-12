import * as vscode from 'vscode';
import * as path from 'path';

const SSAMapper: { [key: string]: string } = {
    initial: "Initial SSA",
    rm_unreachable_1: "Removing Unreachable Functions (1st)",
    defunc: "Defunctionalization",
    inlining_simple: "Inlining simple functions",
    mem2reg_1: "Mem2Reg (1st)",
    rm_rc_pairs: "Removing Paired rc_inc & rc_decs",
    preprocess: "Preprocessing Functions",
    inline_1: "Inlining (1st)",
    mem2reg_2: "Mem2Reg (2nd)",
    simplify_1: "Simplifying (1st)",
    as_slice: "`as_slice` optimization",
    rm_unreachable_2: "Removing Unreachable Functions (2nd)",
    assert: "`static_assert` and `assert_constant`",
    loop_invariant: "Loop Invariant Code Motion",
    unroll: "Unrolling",
    simplify_2: "Simplifying (2nd)",
    mem2reg_3: "Mem2Reg (3rd)",
    flatten: "Flattening",
    rm_big_shifts: "Removing Bit Shifts",
    mem2reg_4: "Mem2Reg (4th)",
    inline_2: "Inlining (2nd)",
    rm_ifelse: "Remove IfElse",
    fold_constraints: "Constant Folding",
    rm_enable_side_eff: "EnableSideEffectsIf removal",
    fold_constants: "Constraint Folding",
    add_not_equal: "Adding constrain not equal",
    rm_dead_1: "Dead Instruction Elimination (1st)",
    simplify_3: "Simplifying (3rd)",
    array_set_optimize: "Array Set Optimizations",
    check_undeconstrain: "Check for Underconstrained Values",
    check_missing_brillig: "Check for Missing Brillig Call Constraints",
    inline_brillig: "Brillig Calls Inlining",
    rm_dead_2: "Dead Instruction Elimination (2nd)",
};

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

        let document: vscode.TextDocument;
        try {
            document = await vscode.workspace.openTextDocument(targetUri);
        } catch (error) {
            vscode.window.showErrorMessage(`File not found: ${targetUri.fsPath}`);
            return;
        }

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

        editor.selections = [new vscode.Selection(startPos, endPos)];
        editor.revealRange(new vscode.Range(startPos, endPos), 
            vscode.TextEditorRevealType.InCenterIfOutsideViewport);

        const decoration = vscode.window.createTextEditorDecorationType({
            backgroundColor: new vscode.ThemeColor('editor.selectionBackground'),
            border: '1px solid yellow',
            isWholeLine: true
        });

        editor.setDecorations(decoration, [new vscode.Range(startPos, endPos)]);
        console.log(`Applied decorations`);

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

const locationDecorationType = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(255,229,100,0.3)',
    overviewRulerColor: 'rgba(255,229,100,0.8)',
    overviewRulerLane: vscode.OverviewRulerLane.Right
});

const locationIdDecorationType = vscode.window.createTextEditorDecorationType({
});


async function openNrFile(uri: vscode.Uri) {
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document);

    try {
        const baseDir = path.dirname(uri.fsPath);
        const jsonPath = path.join(baseDir, '..', 'ssa', SSAMapper);
        const jsonUri = vscode.Uri.file(jsonPath);

        const rawData = await vscode.workspace.fs.readFile(jsonUri);
        const jsonData = JSON.parse(rawData.toString());

        const ssaFunction = jsonData?.functions?.[0]?.[1];
        if (!ssaFunction) {
            throw new Error("Function structure not found in JSON");
        }

        const callStackData = ssaFunction.dfg?.call_stack_data;
        if (!callStackData?.locations) {
            throw new Error("Call stack locations not found in DFG data");
        }

        const locations = callStackData.locations;

        const ranges: vscode.Range[] = [];
        const locationDecorations: vscode.DecorationOptions[] = [];

        locations.forEach((loc: any, index: number) => {
            if (!loc?.value?.span?.start || !loc?.value?.span?.end) return;

            const startOffset = Number(loc.value.span.start);
            const endOffset = Number(loc.value.span.end);
            
            if (isNaN(startOffset) || isNaN(endOffset)) return;

            const range = new vscode.Range(
                document.positionAt(startOffset),
                document.positionAt(endOffset)
            );
            ranges.push(range);

            const line = document.positionAt(endOffset).line;
            const lineEnd = document.lineAt(line).range.end;
            
            locationDecorations.push({
                range: new vscode.Range(lineEnd, lineEnd),
                renderOptions: {
                after: {
                    contentText: `//L${index}`,
                    color: 'rgba(128,128,128,0.7)',
                    fontStyle: 'italic',
                    margin: '0 0 0 2em'
                }
            }
            });
        });

        if (ranges.length > 0) {
            editor.setDecorations(locationDecorationType, ranges);
            editor.setDecorations(locationIdDecorationType, locationDecorations);
        } else {
            vscode.window.showWarningMessage("No valid locations found in data");
        }

    } catch (error) {
        vscode.window.showErrorMessage(`Data Error: ${error instanceof Error ? error.message : error}`);
    }
}
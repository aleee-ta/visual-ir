import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';

import { openFile, processSsaContent, getWebviewHtml, SSAMapper } from '../openfile';

const mockContext = {
    globalState: {
        get: () => '',
        update: () => Promise.resolve()
    }
} as unknown as vscode.ExtensionContext;

suite("Extension Test Suite", () => {
    test("SSA Content Processing", () => {
        const input = `
            fn main() {
                constrain x == y; // L0
            }
        `;
        
        const expected = `
            fn main() {
                <span class="location-marker" data-location-id="0">// L0</span>
                constrain x == y;
            }
        `;

        assert.strictEqual(
            processSsaContent(input).trim(),
            expected.trim()
        );
    });

    test("Webview HTML Generation", () => {
        const content = "test content";
        const html = getWebviewHtml(content);
        
        assert.ok(html.includes('<!DOCTYPE html>'));
        assert.ok(html.includes('test content'));
        assert.ok(html.includes('acquireVsCodeApi'));
    });

    test("SSA Mapper Validation", () => {
        assert.strictEqual(SSAMapper['initial'], 'Initial SSA');
        assert.strictEqual(SSAMapper['mem2reg_1'], 'Mem2Reg (1st)');
    });
});
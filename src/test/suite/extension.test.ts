// src/test/suite/extension.test.ts
import * as assert from 'assert';
import * as vscode from 'vscode';

suite('window-url-launcher (startup/shutdown URL lists)', () => {
  let calls: string[] = [];
  let api: any;
  let disp: vscode.Disposable | undefined;

  // 好きなテスト用URL（配列順で開かれることを検証）
  const START = ["http://localhost:5173/", "http://localhost:3000/"];
  const STOP  = ["http://localhost:5173/", "http://localhost:3000/"];

  suiteSetup(async () => {
    // URL受け取り用の受け口（拡張プロセス内で実行される）
    disp = vscode.commands.registerCommand('window-url-launcher.__test_onOpen', (url: string) => {
      calls.push(url);
    });

    // ★ 設定を先に上書き（activateより前）
    const cfg = vscode.workspace.getConfiguration('window-url-launcher');
    await cfg.update('startupUrls', START, vscode.ConfigurationTarget.Global);
    await cfg.update('shutdownUrls', STOP,  vscode.ConfigurationTarget.Global);

    // 拡張を取得→activate
    const ext = vscode.extensions.getExtension('your-publisher.window-url-launcher');
    if (!ext) { throw new Error('extension not found'); }
    await ext.activate();

    // openExternalImpl を「コマンド中継」に差し替え
    await vscode.commands.executeCommand('window-url-launcher.__test_setOpenExternalToCommand');

    // activate時の自動発火がもし走っていてもテストには使わないのでクリア
    await new Promise((r) => setTimeout(r, 10));
    calls = [];

    // Testモードでは activate() が API を返す
    api = ext.exports;
  });

  suiteTeardown(() => { disp?.dispose(); });

  test('起動時: startupUrls を順番に開く', async () => {
    await api.__test_fireOpen();           // 明示的に起動相当を発火
    await new Promise(r => setTimeout(r, 20));
    assert.deepStrictEqual(calls, START);
  });

  test('終了時: shutdownUrls を順番に開く', async () => {
    calls = [];
    await api.__test_fireClose();          // 明示的に終了相当を発火
    await new Promise(r => setTimeout(r, 20));
    assert.deepStrictEqual(calls, STOP);
  });
});

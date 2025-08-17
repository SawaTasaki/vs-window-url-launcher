import * as vscode from 'vscode';
import { spawn } from 'child_process';

const log = (...a: any[]) => console.log('[window-url-launcher]', ...a);

// --- URLオープンの実体（テストで差し替え可能にしておく） ---
let openExternalImpl: (url: string) => Thenable<void> = (url) =>
  vscode.env.openExternal(vscode.Uri.parse(url)).then(() => {});
export function __setOpenExternalImpl(fn: typeof openExternalImpl) {
  openExternalImpl = fn;
}

const TEST_CMD_SET = 'window-url-launcher.__test_setOpenExternalToCommand';
let testCmdRegistered = false;
let currentMode: vscode.ExtensionMode | undefined;

// === URLリスト保持 & ユーティリティ ===
let urlsOnStart: string[] = [];
let urlsOnQuit: string[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function sanitize(urls: string[]): string[] {
  return urls.filter((u) => {
    try {
      const x = new URL(u);
      return x.protocol === 'http:' || x.protocol === 'https:';
    } catch {
      return false;
    }
  });
}

// OS直叩き（確認ダイアログ回避・プロセス分離）
function openExternalDetached(url: string) {
  try {
    let cp;
    if (process.platform === 'darwin') {
      cp = spawn('open', [url], { detached: true, stdio: 'ignore' });
    } else if (process.platform === 'win32') {
      cp = spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true });
    } else {
      cp = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
    }
    cp.unref();
    log('detached-open ok', { url });
  } catch (e) {
    console.error('[window-url-launcher] detached-open failed', e);
  }
}

// 複数URLを順番に開く
// useDetached=true: 終了時など → 同期で一気に spawn（sleep なし）
// useDetached=false: VS Code 経由（テスト/起動時）→ 小休止を入れて丁寧に
async function openMany(urls: string[], useDetached: boolean) {
  const list = sanitize(urls);

  if (useDetached) {
    for (const url of list) {
      openExternalDetached(url);
    }
    return; // 同期完了
  }

  for (let i = 0; i < list.length; i++) {
    await openExternalImpl(list[i]);
    if (i < list.length - 1) {
      await sleep(80); // 連打防止
    }
  }
}

// --- 設定の再読込（onDidChangeConfiguration からも呼ぶ） ---
function reloadConfig() {
  const cfg = vscode.workspace.getConfiguration('window-url-launcher');
  urlsOnStart = sanitize(cfg.get<string[]>('startupUrls', ["http://localhost:5173/"]));
  urlsOnQuit = sanitize(cfg.get<string[]>('shutdownUrls', ["http://localhost:5173/"]));
}

// URLを1件追加するヘルパー（コマンドから呼ぶ）
async function promptAndAdd(settingKey: 'startupUrls' | 'shutdownUrls') {
  const url = await vscode.window.showInputBox({
    title: `Add ${settingKey === 'startupUrls' ? 'Startup' : 'Shutdown'} URL`,
    prompt: 'http(s):// で始まるURLを入力',
    validateInput: (v) => (/^https?:\/\/.+/.test(v) ? null : 'http(s):// で始まるURLを入力してください'),
    ignoreFocusOut: true,
  });
  if (!url) return;

  const cfg = vscode.workspace.getConfiguration('window-url-launcher');
  const list = cfg.get<string[]>(settingKey, []);
  await cfg.update(settingKey, [...list, url], vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage(`Added to ${settingKey}: ${url}`);
}

export function activate(context: vscode.ExtensionContext): any {
  currentMode = context.extensionMode;
  log('activate', { mode: currentMode });

  // 起動時に一度ロード
  reloadConfig();

  // 設定変更をホットリロード
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration('window-url-launcher.startupUrls') ||
        e.affectsConfiguration('window-url-launcher.shutdownUrls')
      ) {
        reloadConfig();
        vscode.window.showInformationMessage('window-url-launcher settings reloaded.');
      }
    })
  );

  // 設定画面を開くコマンド
  context.subscriptions.push(
    vscode.commands.registerCommand('window-url-launcher.openSettings', () =>
      vscode.commands.executeCommand('workbench.action.openSettings', 'window-url-launcher')
    )
  );

  // URL追加コマンド
  context.subscriptions.push(
    vscode.commands.registerCommand('window-url-launcher.addStartupUrl', () => promptAndAdd('startupUrls')),
    vscode.commands.registerCommand('window-url-launcher.addShutdownUrl', () => promptAndAdd('shutdownUrls'))
  );

  // テスト用差し替えコマンド（1回だけ登録）
  if (currentMode === vscode.ExtensionMode.Test && !testCmdRegistered) {
    context.subscriptions.push(
      vscode.commands.registerCommand(TEST_CMD_SET, () => {
        openExternalImpl = (url: string) =>
          Promise.resolve(vscode.commands.executeCommand('window-url-launcher.__test_onOpen', url)).then(() => {});
      })
    );
    testCmdRegistered = true;
  }

  // 起動時に開く
  if (currentMode === vscode.ExtensionMode.Test) {
    // テストは差し替え後に起動URLを発火
    setTimeout(() => void openMany(urlsOnStart, false), 0);
    // テスト用APIを返す
    return {
      __test_fireOpen: () => openMany(urlsOnStart, false),
      __test_fireClose: () => openMany(urlsOnQuit, false),
    };
  } else {
    // 本番：OS直叩きでまとめて開く
    void openMany(urlsOnStart, true);
    return;
  }
}

export function deactivate(): Thenable<void> | void {
  log('deactivate called');
  if (currentMode === vscode.ExtensionMode.Test) {
    return openMany(urlsOnQuit, false);
  }
  void openMany(urlsOnQuit, true);
}

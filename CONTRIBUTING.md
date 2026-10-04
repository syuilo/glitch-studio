## Electronで起動する

依存関係を `pnpm install` でインストールしてから実行します。

- `pnpm dev:desktop`: ViteとElectronを起動します。UIの変更はHMRで反映されます。main/preloadの変更時は再起動してください。
- `pnpm build:desktop`: Electron用UIを `packages/glitch-studio/ui/dist-electron` にビルドします。
- `pnpm start:desktop`: ビルド済みUIをElectronで起動します。
- `pnpm dist:desktop`: UIをビルドし、Windows x64向けNSISインストーラーを生成します。

Windowsでは、このインストーラーでインストールすると `.gsproj` がGlitch Studioに関連付けられ、アプリのアイコンが表示されます。ファイルをダブルクリックすると、そのプロジェクトを新しいウィンドウで開きます。起動済みウィンドウの編集中のプロジェクトは維持します。別アプリが既定に設定されている場合は、Windowsの「プログラムから開く」でGlitch Studioを既定に選んでください。

関連付けはインストーラーが登録するため、開発起動では登録されません。読み込み処理だけを確認するには、UIのビルド後に `pnpm start:desktop "C:\path\to\project.gsproj"` を実行します。

Web版は `pnpm dev` / `pnpm build` を使用します。

Electron用のコマンドでは `BUILD_TARGET=electron` により、UIのビルド時定数 `__ELECTRON__` がtrueになります（Web版ではfalse）。

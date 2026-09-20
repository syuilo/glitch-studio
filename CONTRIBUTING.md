## Electronで起動する

依存関係を `pnpm install` でインストールしてから実行します。

- `pnpm dev:desktop`: ViteとElectronを起動します。UIの変更はHMRで反映されます。main/preloadの変更時は再起動してください。
- `pnpm build:desktop`: Electron用UIを `packages/ui/dist-electron` にビルドします。
- `pnpm start:desktop`: ビルド済みUIをElectronで起動します。
- `pnpm dist:desktop`: UIをビルドし、Windows x64向けNSISインストーラーを生成します。

Web版は `pnpm dev` / `pnpm build` を使用します。

Electron用のコマンドでは `BUILD_TARGET=electron` により、UIのビルド時定数 `__ELECTRON__` がtrueになります（Web版ではfalse）。

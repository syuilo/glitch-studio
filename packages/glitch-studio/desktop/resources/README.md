# デスクトップ版のアイコン

`icon.ico` は `packages/glitch-studio/ui/public/icon-512.png` から変換したWindows用アイコンです。16・24・32・48・64・128・256pxの画像を含みます。

実行ファイルへの埋め込みと、開発版・配布版のウィンドウおよびタスクバーのアイコンに使用します。配布時はOSが直接参照できるように、`app.asar` の外の `resources/icon.ico` に配置します。

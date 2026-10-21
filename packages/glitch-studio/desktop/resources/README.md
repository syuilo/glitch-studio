# デスクトップ版の画像

## アイコン

`icon.ico` は `packages/glitch-studio/ui/public/icon-512.png` から変換したWindows用アイコンです。16・24・32・48・64・128・256pxの画像を含みます。

実行ファイルへの埋め込みと、開発版・配布版のウィンドウおよびタスクバーのアイコンに使用します。配布時はOSが直接参照できるように、`app.asar` の外の `resources/icon.ico` に配置します。

## スプラッシュ

`startup-splash.png`は、従来のHTML版スプラッシュを画像化した400×280pxの静的画像です。黒背景・ロゴ・アプリ名・起動中の文言を含みます。`ImageView`で直接表示するため、表示内容を変更するときはこの画像を差し替えます。配布時は`app.asar`内の`resources/startup-splash.png`に配置します。

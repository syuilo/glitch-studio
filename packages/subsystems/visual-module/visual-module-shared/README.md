# Visual Module Shared

Visual Moduleのノード・入出力・公開カスタムパラメータ・接続の契約を定義する。パラメータ自体の定義とBindingは共通基盤を組み合わせ、カスタムパラメータのID・参照名・主入力などの役割はこのドメインが所有する。

`expression.ts`はVisual Module内で公開する変数名、`parameter-evaluation.ts`は呼び出し側から受け取る評価済みカスタムパラメータのCPU値を定義する。`PARAM`・外部カスタムパラメータ参照・ノード参照の評価はVisual Module Rendererが担当する。

レイヤーやLIVEから渡される引数は`ValueParameterBinding`に限定する。`canNode: true`のカスタムパラメータはInノードで参照し、`PARAM`と直接参照の対象には含めない。

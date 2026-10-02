# Timeline Shared

Scene・レイヤー・クリップと、その時間・合成・音声設定の契約を定義する。キーフレームの補間や式エンジンは共通基盤を利用し、Scene時刻で評価することや許可するBindingなどの規約をこのドメインで決める。

`expression.ts`はレイヤーに公開する変数名、`evaluation-scope.ts`は映像と音声で共通のScene時刻の評価スコープを定義する。Visual Module内部の変数・カスタムパラメータ・グラフ一覧は継承しない。

`parameter-binding.ts`で保存データの制約を検証し、`TimelineParameterBindingEvaluator`はCPU値として扱えるBindingだけを共通評価器へ渡す。`layerInput`はTimeline Renderer内のエフェクトレイヤーが下層の合成結果として解決する。

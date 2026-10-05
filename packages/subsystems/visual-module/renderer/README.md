# Visual Module Renderer

RendererはWeb Worker内で動作し、DOM・UIの実装にアクセスできないため、意図しないそれらへの参照/依存が原理的に発生しないように別パッケージとする

ただし、必要に応じて(別スレッドとして動かすとかえってパフォーマンスが悪化する環境で動かす場合)メインスレッドから直接利用することもできる設計

`VisualModuleParameterBindingEvaluator`はノード出力参照・外部カスタムパラメータ参照・`PARAM`関数を解決する。`canNode: false`で音声以外の公開パラメータだけを式の評価環境に渡し、CPU値の評価は共通の`ParameterBindingEvaluator`へ委ねる。解決済みの値をエフェクト入力へ変換する処理はEffect Rendererを利用する。

`audioSource`は静的な音声取得元の指定で、ノードの画像配線・式・キー・automationへは流さない。LIVEでは`literal`の`null`または`{ type: 'player', playerId }`を解決し、Playerの保持PCMを描画ごとに固定する。公開音声パラメータは`externalCustomParameterInput`で内部エフェクトへ渡せる。Timelineなどが提供する音声は`audioParamInputs`で受け取り、Scene・レイヤー・デコーダーの解決をこのパッケージへ持ち込まない。

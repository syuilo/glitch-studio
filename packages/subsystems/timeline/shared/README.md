# Timeline Shared

Scene・レイヤー・クリップと、その時間・合成・音声設定の契約を定義する。キーフレームの補間や式エンジンは共通基盤を利用し、Scene時刻で評価することや許可するBindingなどの規約をこのドメインで決める。

`expression.ts`はレイヤーに公開する変数名、`evaluation-scope.ts`は映像と音声で共通のScene時刻の評価スコープを定義する。Visual Module内部の変数・カスタムパラメータ・グラフ一覧は継承しない。

`parameter-binding.ts`は共通方式だけの`TimelineParameterBinding`、音声入力用の`lowerLayerAudio` / `layerAudio`を加えた`TimelineVisualModuleParameterBinding`、さらに画像入力用の`layerInput`を加えた`TimelineEffectParameterBinding`を定義する。合成設定・音量は共通方式だけを使う。音声入力Bindingは`audioSource`型だけで選択できる。`layerAudio`は`layerId: string | null`を保存し、引数を所有するレイヤーと同じSceneの直下から音声・動画・Sceneレイヤーを選ぶ。`null`や削除・欠落した参照先は入力なしとして扱うが、保存したIDは維持する。TimelineではPlayerを指定できず、音声入力の式・キー・automationも扱わない。

同じファイルで保存データの制約を配列・構造体内部まで検証し、`TimelineParameterBindingEvaluator`はCPU値として扱えるBindingだけを共通評価器へ渡す。`layerInput`はTimeline Renderer内のエフェクトレイヤーが下層の合成結果として解決する。他ドメインの入力方式を列挙せず、このスコープが扱える方式だけを受け入れる。

`getSceneAudioClips(scenes, sceneId, selection)`は音声計画を作る。選択は`{ type: 'all' }`（既定値）、`{ type: 'belowLayer', layerId }`、`{ type: 'layer', layerId }`。下層指定では自分と上層を除外し、レイヤー指定では並び順によらず指定レイヤー単体の出力を使う。範囲は取得元Sceneの直下に適用し、選んだSceneレイヤーはその配置のトリムと音量を適用した子Scene全体を含める。子Scene内部のレイヤーは直接選べない。無効レイヤー・音声無効の動画を除外し、各階層の音量はミックス側へ渡す。`primaryAudioInputParameter` / `primaryAudioInputId`を持つエフェクト・Visual Moduleの主音声入力は、初期値・リセット時に`lowerLayerAudio`になる。画像の主入力と合成設定は独立する。

`motion-blur.ts`はシャッター角・サンプル数の設定と検証、Sceneの端と映像クリップ境界の収集、中央露光のサンプル時刻計算を担当する。子Sceneの境界は配置の内容オフセットを反映し、表示区間内だけ親へ渡す。切り詰めた露光区間へ指定数のサンプルを等間隔で再配置するため、重みは均等で合計1となる。0・1サンプル、角度0、無効時は基準時刻を1回評価する。時間は整数msに丸めない。

描画用途ごとのサンプル数は呼び出し側が選ぶ。プレビュー品質の選択肢・プロジェクトの既定fps・既定ブラー設定はUIが所有し、このパッケージには含めない。

`render-history-effects.ts`は配置されたエフェクトとVisual Moduleの定義から`dependsOnRenderHistory`を調べる。これは警告用の検査であり、実行制限や履歴リセットの方針ではない。

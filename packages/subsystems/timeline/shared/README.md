# Timeline Shared

`layer-transform.ts`は、合成前の素材寸法・Scene寸法・評価済みtransformから素材座標をScene座標へ写す純粋関数を持つ。fitの規則はGPU共通基盤の`input-fit.ts`を使い、透明な余白・origin・負のscale・画面アスペクト比を合成シェーダーと揃える。ポインター・ハンドル・スナップ・選択状態はUIが所有する。

`src/layers/`にレイヤー種別固有の定義・初期値・検証をまとめる。`effect`・`visual-module`・`text`・`shape`の各ディレクトリに既存の実装を置き、Scene・クリップ・Binding・合成・音声などの共通契約は`src/`直下に置く。

Scene・レイヤー・クリップと、その時間・合成・音声設定の契約を定義する。キーフレームの補間や式エンジンは共通基盤を利用し、Scene時刻で評価することや許可するBindingなどの規約をこのドメインで決める。

`TimelineTextLayer`は本文・フォントAsset参照・サイズ・最大幅とoverflow・色・輪郭・影・位置・整列・行間を`textParamValues`に所有し、クリップは時間情報だけを持つ。`layers/text/text.ts`が定義・初期値・評価済み型を所有し、既存のTextエフェクトとは定義・描画処理を共有しない。サイズはScene高さ比、最大幅はScene幅比、輪郭・影・行間は文字サイズ比。入力は共通の値Bindingだけを許可し、式・automation・キーは所属Scene時刻で評価する。合成設定の変形・不透明度は文字の配置と独立する。

`TimelineShapeLayer`は一つの形状を所有し、クリップは時間情報だけを持つ。初期対応は楕円と角丸を含む長方形で、作成後に種類は変更しない。`layers/shape/shape.ts`が形状の種類別パラメータ定義と保存用・評価済みの型を所有し、Sceneやレイヤーの情報には依存しない。将来の多角形・シンボル・パスも同じレイヤー種別へ追加する。

シェイプの位置・寸法・回転・塗り・輪郭は合成設定から独立したBindingで、式・automation・キーを所属Scene時刻で評価する。寸法は輪郭を付ける前の全幅・全高。寸法・輪郭幅・角丸半径は縦横ともScene高さを1とし、位置は画面中央が[0, 0]、画面端が±1。回転の1は形状中心を支点とした時計回り180度。輪郭は内側・中央（既定）・外側から選び、寸法を変えても輪郭幅は保つ。非正の寸法は透明、非正の輪郭幅は輪郭なし、角丸半径は0から短辺の半分までに制限する。塗り・輪郭は個別に有効化できるRGBA色で、輪郭を塗りの上へ合成する。

シェイプの初期値は中央、寸法[0.5, 0.5]、白い塗り、輪郭無効（色は黒、幅0.01）。`layers/shape/shape-layer.ts`は共通の値Bindingだけを受け入れ、ノード・下層画像・音声入力を拒否する。複数形状・グラデーション・任意パス・プレビュー上の直接編集は未対応。

`strokeProgress`は輪郭の描画割合で、0は輪郭なし、0.5は半周、1（既定値）は閉じた輪郭。`strokeStart`は描き始める位置で、0（既定値）と1が上中央、0.25が右中央、0.5が下中央、0.75が左中央。どちらも輪郭を付ける前の形状の周長を基準に時計回りに数え、評価値は0〜1へ制限する。起点を越える区間も連続して描き、部分描画の両端は輪郭の接線に垂直に切る。塗り・輪郭幅・輪郭配置は変えない。両パラメータとも通常の式・automation・キーを使う。

`expression.ts`はレイヤーに公開する変数名、`evaluation-scope.ts`は映像と音声で共通のScene時刻の評価スコープを定義する。Visual Module内部の変数・カスタムパラメータ・グラフ一覧は継承しない。

`parameter-binding.ts`は共通方式だけの`TimelineParameterBinding`、音声入力用の`lowerLayerAudio` / `layerAudio`を加えた`TimelineVisualModuleParameterBinding`、さらに画像入力用の`layerInput`を加えた`TimelineEffectParameterBinding`を定義する。合成設定・音量は共通方式だけを使う。音声入力Bindingは`audioSource`型だけで選択できる。`layerAudio`は`layerId: string | null`を保存し、引数を所有するレイヤーと同じSceneの直下から音声・動画・Sceneレイヤーを選ぶ。`null`や削除・欠落した参照先は入力なしとして扱うが、保存したIDは維持する。TimelineではPlayerを指定できず、音声入力の式・キー・automationも扱わない。

`timeline-audio.ts`の`resolveTimelineAudioLayerReference()`は、所属Scene直下の探索・自身の除外・音声出力の有無による参照可否を判定する純粋関数。Commandと描画側で同じ規則を使い、解決できない選択の拒否や入力なしへの変換はそれぞれの呼び出し側が行う。無効・空のレイヤーや音声無効の動画も有効な参照先として返す。

`parameter-binding.ts`で保存データの制約を配列・構造体内部まで検証し、`TimelineParameterBindingEvaluator`はCPU値として扱えるBindingだけを共通評価器へ渡す。`layerInput`はTimeline Renderer内のエフェクトレイヤーが下層の合成結果として解決する。他ドメインの入力方式を列挙せず、このスコープが扱える方式だけを受け入れる。

`getSceneAudioClips(scenes, sceneId, selection)`は音声計画を作る。選択は`{ type: 'all' }`（既定値）、`{ type: 'belowLayer', layerId }`、`{ type: 'layer', layerId }`。下層指定では自分と上層を除外し、レイヤー指定では並び順によらず指定レイヤー単体の出力を使う。範囲は取得元Sceneの直下に適用し、選んだSceneレイヤーはその配置のトリムと音量を適用した子Scene全体を含める。子Scene内部のレイヤーは直接選べない。無効レイヤー・音声無効の動画を除外し、各階層の音量はミックス側へ渡す。`primaryAudioInputParameter` / `primaryAudioInputId`を持つエフェクト・Visual Moduleの主音声入力は、初期値・リセット時に`lowerLayerAudio`になる。画像の主入力と合成設定は独立する。

`motion-blur.ts`はシャッター角・サンプル数の設定と検証、Sceneの端と映像クリップ境界の収集、中央露光のサンプル時刻計算を担当する。子Sceneの境界は配置の内容オフセットを反映し、表示区間内だけ親へ渡す。切り詰めた露光区間へ指定数のサンプルを等間隔で再配置するため、重みは均等で合計1となる。0・1サンプル、角度0、無効時は基準時刻を1回評価する。時間は整数msに丸めない。

描画用途ごとのサンプル数は呼び出し側が選ぶ。プレビュー品質の選択肢・プロジェクトの既定fps・既定ブラー設定はUIが所有し、このパッケージには含めない。

`render-history-effects.ts`は配置されたエフェクトとVisual Moduleの定義から`dependsOnRenderHistory`を調べる。これは警告用の検査であり、実行制限や履歴リセットの方針ではない。

## VOICEVOXレイヤー

`TimelineVoicevoxLayer`は発話キー（ID・Scene上の整数ms・字幕本文・任意の読み）と、声のスタイルID・話速、字幕装飾、合成設定、音量を所有する。クリップは音声と字幕の有効区間だけを持ち、移動・トリムで発話キーを動かさない。内容オフセットは発話の時計に適用しない。同じ本文のキーも独立した発話で、同一時刻のキーは許可しない。空文字キーは直前の音声と字幕を終了する。最初のキー前は無音・字幕なし。

音声はキーからの経過時間で読み出し、生成音声の末尾・次のキー・クリップ終端までに制限する。字幕は次のキーまたはクリップ終端まで表示する。`scene-audio.ts`は注入された`SpeechResolver`が返す準備済み音声だけを計画へ含める。音声計画の`sourceId`は素材と生成音声に共通の不透明な識別子であり、Blobの取得・VOICEVOXとの通信は扱わない。子Sceneの配置・下層音声・指定レイヤー音声にも同じ計画を使う。

字幕装飾は`layers/voicevox/voicevox-subtitle.ts`が専用の定義・既定値・型を所有し、`subtitleParamValues`に保存する。編集対象は`voicevoxSubtitle`。Textレイヤーの定義・検証・保存型を継承せず、それぞれ独立して変更できる。

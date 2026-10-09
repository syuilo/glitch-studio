# Timeline Renderer

各レイヤーのcompositorは任意の`onCompositing`で合成前の`UniformOrTexture`と評価済み設定を呼び出し側へ渡せる。opacity=0やreplaceの短絡経路でも通知する。通知の購読対象・Worker通信・プレビューのハンドルはGlitch Studio側が所有し、このパッケージはUIの選択状態を知らない。

`src/layers/`にレイヤー種別ごとの実装をまとめる。`group`・`effect`・`image`・`scene`・`video`・`visual-module`・`text`・`shape`の各ディレクトリに、レイヤーの描画処理と種別固有の補助処理・シェーダーを置く。Timeline全体の評価・合成・Scene出力・音声入力の解決など、複数種別で使う処理は`src/`直下に置く。

RendererはWeb Worker内で動作し、DOM・UIの実装にアクセスできないため、意図しないそれらへの参照/依存が原理的に発生しないように別パッケージとする

ただし、必要に応じて(別スレッドとして動かすとかえってパフォーマンスが悪化する環境で動かす場合)メインスレッドから直接利用することもできる設計

Textレイヤーは`TextParameters`でScene時刻の値を評価し、`createTextRenderer()`がOffscreenCanvasの本体・輪郭・影マスクを作成してWebGPUで色を合成する。出力はScene解像度・`intermediateTextureFormat`のpremultiplied RGBA。Textエフェクトへの参照は持たず、レイアウト・影・フォント読み込みもTimeline内で独立して所有する。色だけの変化ではマスクを再利用し、静止時も下層との合成は毎回行う。空文字やサイズ0は透明な出力を返す。フォントBlobは呼び出し側がAsset IDから解決し、読み込み完了をプレビュー・書き出しの双方で待つ。シークの中断・フォント変更・破棄より古い結果は描画へ使わず、クリップ区間外ではGPUリソースとFontFaceを解放する。

シェイプレイヤーは`ShapeParameters`で所属Scene時刻の値を評価し、`createShapeRenderer()`が評価済みの形状だけを受け取ってWebGPUで描画する。テクスチャは倍率適用後のScene解像度を保ち、形状の移動・寸法・回転はその内部で反映する。画面外は切り取り、出力は`intermediateTextureFormat`のpremultiplied RGBA。`createShapeTimelineLayer()`がその出力へ通常のレイヤー変形・不透明度・合成方法を適用するため、形状編集で合成設定を変更する必要はない。

楕円は実際の輪郭までの距離で太さを保ち、長方形は内外周を別々に構築して角丸0の直角を保つ。静止した形状のテクスチャは再利用するが、下層との合成は毎回行う。寸法0でも透明な出力を返して`replace`の意味を保ち、クリップ区間外ではリソースを破棄する。直接編集用のハンドルやUI状態は描画処理へ含めない。

輪郭の部分描画では`layers/shape/shape-stroke-progress.ts`が元の周長から両端の位置・接線を求める。楕円の弧長はCPUで数値積分し、長方形は直線と角丸の円弧を使う。シェーダーは画素の最近傍の輪郭点で区間内外を判定し、有限の切り口までの距離でアンチエイリアスを行う。画素自身の偏角で切らないため、楕円・長方形でも端が斜めにならず、0と1では切り口を適用しない。

エフェクトとVisual Moduleのレイヤーは音声Bindingを解決する関数を呼び出し側から受け取る。`timeline-audio-input-resolver.ts`で同じ評価内の同一参照だけを共有し、下層音声と指定レイヤー、異なるレイヤーの入力を混同しない。取得時刻は内容時刻ではなく所属Scene時刻を渡す。PCMのデコードや再生状態は所有しない。

`TimelineFrameRenderer`は1出力フレームに属するサブサンプルの直列評価・蓄積・中断を管理する。各サンプルでScene全体を合成し、最上位でだけ平均する。子Sceneは単一時刻で評価するため、入れ子でサンプル数は増殖しない。

`motion-blur-accumulator.ts`はpremultiplied RGBAを逐次平均する2枚のGPUテクスチャを所有する。内部計算用の精度設定に従い、rgba16float / rgba32floatを使う。借用出力を読むコマンドは、次の評価でその出力が上書きされる前にsubmitする。表示とエンコードは平均結果に対して1回だけ行う。

プレビューの露光時間はプロジェクトの`timelineFps`、動画書き出しでは書き出しfpsから求める。プレビュー倍率はUI側の描画要求の頻度だけに作用する。履歴依存エフェクトはモーションブラーの動作保証対象外で、サブサンプルごとに通常の更新を行い、重なる露光区間やシークのための特別な履歴復元・リセットは行わない。

VOICEVOXレイヤーは`layers/voicevox/`で発話キーからScene時刻の本文を選択し、専用の`VoicevoxSubtitleParameters`で装飾を評価する。Textレイヤーとは互いの実装を参照しない。生成済み音声の有無や再生履歴には依存しない。

両レイヤーが共有するテキスト描画部分は`src/text-rendering/`に置く。`TextRenderValues`は評価済みの文字列・装飾だけの契約で、レイヤー・Binding・パラメータ定義・発話キーを知らない。フォント読み込み・文字配置・マスク・シェーダーを共有し、評価・合成の呼出し・リソース寿命は各レイヤーが独立して管理する。


グループは`layers/group/group-timeline-layer.ts`が専用の`TimelineRenderer`を持ち、透明背景から子孫を合成する。親と同じScene時刻・解像度を使い、親の背景を子の入力へ流さない。`createSceneOutput()`で画面全体へ確定してから、グループ自身の変形・不透明度・合成方法を適用する。

`TimelineRenderEntry.clips`の省略は常時存在するコンテナを表し、実際のクリップや時計を合成しない。`evaluateAt().hasOutput`で子孫に映像出力があったかを伝え、空白区間と有効な透明出力を区別する。グループの設定取得関数は現在の設定を返し、子の再生成が不要な設定変更では描画履歴を維持する。無効化・削除時は内部のレイヤーとGPU資源を再帰的に破棄する。

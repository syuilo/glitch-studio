# VHS Playback

現在の入力画像からNTSC VHSの記録信号を生成し、テープ・ヘッドの読取異常を加えてから復調する画像加工エフェクト。輝度をFM変調し、カラーアンダー信号と混合した**実数のヘッド出力信号**を処理する。出力のRGBへノイズ帯や変形を重ねる方式ではない。

Visual Moduleとタイムラインのエフェクトレイヤーで利用できる。既存の`_def_.ts`／`_impl_.ts`のglobで登録する。他のエフェクトの実装・上位ドメイン・素材のデコーダーへは依存しない。

## 対象と近似

NTSCの通常再生を対象とし、入力は1フィールドの走査中に一定とみなす。525/59.94方式の262.5Hで時計を進め、計算領域には末尾の半ラインを覆う263行を確保する。フィールドの有効240行から補間して画像を再構成するため、入力の縦横比を維持したまま任意の出力解像度を使用できる。4:3への変形・クロップは行わない。

各物理要素は次の範囲でモデル化する。

- 輝度：作業RGBへNTSCのYIQ行列を適用し、Gaussianで約2.4 MHzの帯域を近似。一次の高域強調とクリップを通し、同期先端3.4 MHz・白ピーク4.4 MHzのFMへ変調する。厳密なNTSC色度・伝達特性への変換や、特定機種の非線形エンファシス特性は再現しない。
- 色：輝度より狭い約0.3 MHzの帯域、約629 kHzのカラーアンダー搬送波、ヘッドごとに逆方向のライン位相回転を使用する。
- テープ・ヘッド：記録トラックと読取ヘッドの幅を等しいものとして重なりから振幅を求める。時間軸の乱れ、走査中の伸縮、ヘッド切替の時刻差・接触低下を加える。ヘッドの浮きによる高域損失は短い対称FIRで近似し、磁性体の履歴・飽和・詳細なギャップ損失は扱わない。
- 再生：共通の実数信号から複素FIRで輝度FMと色信号を分離する。FMは隣接サンプルの位相差から復調し、録画時の高域強調を逆フィルタで戻す。
- 欠損補償：輝度FMの包絡が閾値より低い区間を復調前に1H前の信号で置き換える。連続欠損では補償した信号を再利用する。最初の行には前フィールドの履歴がない。
- 同期と色補正：復調した水平同期パルスから受像側のライン位相を推定する。カラーバーストから色相・ACCのゲインを求め、バーストが弱いときは色を消去する。長期間のサーボ履歴やフィールドをまたぐPLLの状態は保持しない。

PAL、SP/EPによるプロファイルの切り替え、隣接トラックの別フィールドの混入、走査時刻ごとの動画入力、動きによるインターレース、特殊再生、コンポジット出力のY/C再分離、CRTの表示特性は対象外。

## 設定

| 設定 | 意味 |
| --- | --- |
| Amount | 元の入力と再生結果のpremultiplied RGBA合成。0では信号処理を省略し、HDRを含めて入力をそのまま返す。 |
| Time (s) | 仮想テープの再生位置。**動かす場合は式に`TIME`を指定する**。既定値0では静止する。 |
| Tracking Offset (Tracks) | トラック幅を単位にした横断方向のずれ。±1以上では、その位置の記録トラックとの重なりがなくなる。 |
| Track Alignment Error (Tracks) | フィールドの走査開始から終了までに変化する横断量。Offsetと組み合わせ、読めない区間の位置・幅が決まる。 |
| Time Base Error (μs) | 相関を持つ読取時刻の揺れ。実際のRF信号を読む時刻を変動させる。 |
| Tape Deformation (μs / Field) | フィールド内の読取時刻誤差の変化量。正なら走査後半ほど記録信号を先に読む。 |
| Head Contact | RF信号の読取振幅。低下しても画像の明るさを直接減らさず、電気的雑音に対するS/Nが悪くなる。 |
| Head Spacing Loss | RFの高域損失。輝度FMと低域色信号へ異なる影響を与える。 |
| Head Switching | 次の垂直同期の約6.5H前でヘッドを切り替える。下端付近に接触低下が生じる。 |
| Head Timing Difference (μs) | ヘッドAからBへ切り替えた際の読取時刻の差。次のフィールドでは逆方向へ切り替える。 |
| Dropout Rate (/s) | 1Hごとの発生確率を`Rate × H周期`として設定する、平均欠損開始数。1Hあたり最大1事象。 |
| Dropout Duration (μs) | 欠損の長さの基準値。各事象は0.5〜1.5倍の長さを持ち、行の境界をまたぐ。 |
| Dropout Depth | 欠損中の読取振幅の減衰。1で中心区間の信号がなくなる。 |
| RF Noise Floor (dB) | 正常な輝度FMの振幅1に対する電気的雑音の振幅。読取信号の減衰後に加算する。 |
| Dropout Compensation | 輝度FMの1H欠損補償。色信号は置き換えない。 |
| Chroma Correction | バーストに基づく色相補正とACCの強さ。色消去はバーストの強さから常に判断する。 |
| Time Base Correction | 受像側の遅い水平同期追従から、各行で測定した同期位置への補正へ移行する。ライン内の伸縮を完全に補正するTBCではなく、位相補正のみ。同期が検出できない区間では推定時計を維持する。 |
| Seed | テープの損傷、走行の乱れ、電気的雑音の再現を固定する。 |

数値は有限値を必要とし、Time・Seed以外の数値パラメータはUIの範囲へ制限する。損傷を0にしても、正常なVHSの帯域制限・記録処理は残る。

## 透明度

VHSの映像信号にはalphaがないため、用途に応じた2つのモードを明示する。

- **Preserve Coverage**（既定）：coverageを別経路で保持するGlitch Studio向けの拡張。色のフィルタをcoverageで正規化し、完全透明な画素へ雑音色を生成しない。読取時刻と同期回復に対応する位置へalphaも移動する。画像とブランキングの境界ではcoverageの混合を分け、半透明にしただけで録画色が変わらないようにする。
- **Composite on Background**：背景色へ合成し、不透明な映像として録画する。背景色自身のalphaは黒の上へ合成して扱う。信号欠落やブランキングも不透明な出力になる。

通常のShaderInputとして定数・テクスチャを受け取り、入力のFit／Wrap／Filterを使用する。面積サンプリングと最終合成はpremultiplied alphaで行い、色の演算が必要な境界だけunpremultiplyする。

## 処理と責務

- `_def_.ts`：エフェクトの入出力、パラメータ。
- `signal.ts`：信号の定数、仮想テープ位置、各ラインの走行状態、FIR係数。GPU・画像・プロジェクト状態を知らない。
- `_impl_.ts`：ShaderInputの構成、GPUリソースと各passの管理。ステージごとに必要なバッファだけをbindする。
- `common.wgsl`：信号バッファ、色変換、決定的な乱数、サンプル参照。
- `record.wgsl`：入力取得、帯域制限、エンファシス、FM位相の積分、記録RFの生成。
- `playback.wgsl`：テープ読み取り、RF分離、1H補償、復調、同期と色の補正。
- `output.wgsl`：有効画像の再構成、coverageの位置変換、Amountの合成。

内部は1Hにつき512サンプルのベースバンドと2048サンプルのRF（約32.22 MS/s）を使用する。すべてf32のstorage bufferで保持し、符号付き信号や位相を画像テクスチャの0〜1へ丸めない。信号バッファは1インスタンスにつき約21.6 MBで、出力解像度とは独立。最終画像の形式は`intermediateTextureFormat`に従う。

FMの積分はworkgroup内の並列scanと行間の積分に分け、行境界でも位相をつなぐ。搬送波の位相はCPUで周期へ折り返し、長時間の絶対時刻をGPUのf32で位相へ変換しない。

時間は59.94 Hzのフィールド境界へ量子化する。欠損は仮想テープ上の位置へ固定し、電気的雑音はフィールドと信号サンプルから決める。前回描画の出力・描画回数・`timeDelta`・出力FPSを使わず、同じ入力・Time・Seed・設定ならシークや描画順によらず同じ結果になる。入力の縮小に使う面積サンプリングは各軸8点が上限で、極端な縮小の厳密な積分ではない。

## 検証

`test/vhs-playback.test.mjs`は走行モデルの再現性、トラックの重なり、切替点、FIR係数を確認する。`test/vhs-playback.gpu.test.mjs`はChromeのWebGPU上で変調・復調、色の帯域差、振幅変動への耐性、1H補償、同期補正、透明度、出力解像度・形式を確認する。

GPUテストには`CHROME_PATH`が必要。任意で`VHS_PLAYBACK_PREVIEW`へPNGの出力先を指定すると、元画像・通常の再生・劣化した再生を並べた確認画像を保存する。

## 参考資料

- [JVC Video Technical Guide — Video Circuit](https://decode-orc.github.io/analogue-video-specifications/vhs/JVC-Video-Technical-Guide-VTG82063/section-3/)：記録周波数、エンファシス、1H補償、カラーアンダー、色補正。
- [JVC Video Technical Guide — Servo Circuit](https://decode-orc.github.io/analogue-video-specifications/vhs/JVC-Video-Technical-Guide-VTG82063/section-4/)：トラッキングとRF出力の関係。
- [BAVC AV Artifact Atlas — Head Switching Noise](https://github.com/bavc/avaa/blob/master/_artifacts/head_switching_noise.md?plain=1)：ヘッド切替と下端の表示範囲。
- [EP0350731B1 — Method for determining the skew error on a magnetic tape](https://patents.google.com/patent/EP0350731B1/en)：テープ伸縮による時間軸誤差、ヘッド切替位置。

# Color Ramp

`Input`（scalar / canNode）の値を、`Ramp`（colorRamp）の対応表で乗算済みRGBAへ変換します。
Inputは定数・式・スカラー場を受け取り、自動解像度はInputのテクスチャ、定数の場合は描画先に従います。
Gradientやノイズのscalar出力を接続して配色でき、入力の範囲変更にはRemapを組み合わせます。

Rampの初期値は0の黒から1の白、Linear・sRGBです。
Constant・Linear・Smoothstep・Smootherstep・Ease In・Ease Out、およびsRGB・Linear sRGB・Oklab・OKLCHを選択できます。

`Mode`はRampを参照する前の入力値の扱いです。範囲はstopの配置によらず0〜1固定で、初期値はClampです。

| Mode | 動作 |
| --- | --- |
| Clamp | 0未満を0、1超を1に制限し、端の色を維持します。 |
| Wrap | 1を周期に繰り返します。1ちょうどは0へ戻り、−0.25は0.75になります。 |
| Ping-pong | 2を周期に0と1の間を往復します。1ちょうどは1を維持し、1.25は0.75、−0.25は0.25になります。 |

Modeは定数入力とノード接続の両方に適用します。色の補間方式や色空間とは独立し、入力接続のwrap（画像の参照座標）とも別の設定です。

CPUで位置をf32へ丸めてstable sortし、選択色空間の乗算済みの色と端点用sRGBをstorage bufferへ渡します。
画素ごとにupper_boundで区間を求め、同位置の最後のstopを採用します。stop数・補間方式・色空間の変更ではpipelineを再生成しません。
Modeごとの入力pipelineを必要時に作成・キャッシュし、対応表のbufferを共有します。対応表が変わったときだけbufferを書き換え、容量不足で拡張し、破棄時にはuniform・storage・全Modeの入力pipelineを解放します。
GPUのbuffer・bindingとWGSLの評価は、`@gs/shared/gpu/color-ramp.ts`の`createColorRampBindings()`で管理します。Vector Field Visualizationも同じ処理を使い、エフェクト同士は参照しません。

補間後はalphaを戻してからsRGBへ変換し、RGBを0〜1へclampしてalphaを再乗算します。
このclampは簡単なgamut処理であり、色相・彩度を保つgamut mappingではありません。UIプレビューも同じ処理を使います。
描画履歴への依存はありません。

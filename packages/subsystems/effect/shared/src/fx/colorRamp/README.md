# Color Ramp

`Input`（scalar / canNode）の値を、`Ramp`（colorRamp）の対応表で乗算済みRGBAへ変換します。
Inputは定数・式・スカラー場を受け取り、自動解像度はInputのテクスチャ、定数の場合は描画先に従います。
Gradientやノイズのscalar出力を接続して配色でき、入力の範囲変更にはRemapを組み合わせます。

Rampの初期値は0の黒から1の白、Linear・sRGBです。範囲外は端の色を維持します。
Constant・Linear・Smoothstep、およびsRGB・Linear sRGB・Oklabを選択できます。

CPUで位置をf32へ丸めてstable sortし、選択色空間の乗算済みの色と端点用sRGBをstorage bufferへ渡します。
画素ごとにupper_boundで区間を求め、同位置の最後のstopを採用します。stop数・補間方式・色空間の変更ではpipelineを再生成しません。
対応表が変わったときだけbufferを書き換え、容量不足で拡張し、破棄時にはuniform・storage・入力pipelineを解放します。

補間後はalphaを戻してからsRGBへ変換し、RGBを0〜1へclampしてalphaを再乗算します。
このclampは簡単なgamut処理であり、色相・彩度を保つgamut mappingではありません。UIプレビューも同じ処理を使います。
描画履歴への依存はありません。

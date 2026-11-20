# Color Ramp

`Input`（scalar / canNode）の値を、`Ramp`（colorRamp）の対応表で乗算済みRGBAへ変換します。
Inputは定数・式・スカラー場を受け取ります。自動解像度はInputとRepeat Countの接続テクスチャから決まり、両方とも定数の場合は描画先に従います。
Gradientやノイズのscalar出力を接続して配色でき、入力の範囲変更にはRemapを組み合わせます。

Constant・Linear・Smoothstep・Smootherstep・Ease In・Ease Out、およびsRGB・Linear sRGB・Oklab・OKLCHを選択できます。
Ramp自体のRepeat CountとRepeat Modeは、0〜1の中に配色を繰り返す設定です。小数回に対応し、Ping-pongも片道を1回と数えます。Wrapは整数回で終わる右端に終端色を残します。stopの保存位置は変更しません。

エフェクト側の`Repeat Count`（`repeatCount`、scalar / canNode）と`Repeat Mode`（`repeatMode`、enum）は、受け取った配色全体をこの利用箇所で繰り返すための設定です。Rampデータ側の設定とは独立しています。式やキーフレームから変更でき、Repeat Countはノード接続にも対応します。スカラー場を接続すると画素ごとに繰り返し数が変わり、Repeat Modeは描画全体に共通です。Repeat Countの接続にも個別のFit / Wrap / Filter設定を適用します。

- Repeat Countは小数回に対応し、0.5回は配色の前半、2.5回は3回目の途中までをたどります。0以下は0回として配色の先頭（位置0）を使います。GPUのf32でNaN・Infinityになる値も同じ扱いです。定数入力とノード接続に同じ規則を適用し、Rampデータ側の正の有限値という条件は変更しません。
- Repeat ModeはWrap／Ping-pongです。どちらも片道を1回とし、Ping-pongの2回は配色全体を順方向・逆方向に1回ずつたどります。
- Wrapの内部の継ぎ目は先頭に戻し、整数回で終わる位置1だけ終端を保持します。小数回は途中の色で終わります。端点規則はRampデータ側と共通です。

評価順序は`Input → Input Range Mode → エフェクト側の繰り返し → Rampデータ側の繰り返し・補間`です。両者の回数は掛け合わせず、設定を順に適用します。例えば黒白のRampデータが1.5回・Wrap、エフェクト側が2回・Wrapの場合、入力0.75はエフェクト側で0.5、データ側で0.75になります。合計3回として評価した場合の0.25とは異なります。

エフェクト側の設定変更でRampデータやstopは書き換えません。Ramp入力欄のバーはデータ側の結果までを表示し、エフェクト側も含む結果はノードのプレビューで確認します。

`Input Range Mode`（パラメータ名`mode`）は繰り返しを適用する前の入力値の扱いです。範囲はstopの配置によらず0〜1固定です。

| Input Range Mode | 動作 |
| --- | --- |
| Clamp | 0未満を0、1超を1に制限し、エフェクト側・データ側の繰り返し後の端の色を維持します。 |
| Wrap | 1を周期に繰り返します。1ちょうどは0へ戻り、−0.25は0.75になります。 |
| Ping-pong | 2を周期に0と1の間を往復します。1ちょうどは1を維持し、1.25は0.75、−0.25は0.25になります。 |

Input Range Modeは定数入力とノード接続の両方に適用します。エフェクト側・データ側の繰り返し、補間方式・色空間とは独立し、入力接続のwrap（画像の参照座標）とも別の設定です。Input Range ModeがWrapの場合は入力1が0へ戻るため、繰り返しの右端保持より先に入力が先頭へ移ります。

CPUで位置をf32へ丸めてstable sortし、選択色空間の乗算済みの色と端点用linear sRGBをstorage bufferへ渡します。
画素ごとにupper_boundで区間を求め、同位置の最後のstopを採用します。stop数・補間方式・色空間・繰り返し設定の変更ではpipelineを再生成しません。
配置の生成時に、Input・Repeat Countの定数／テクスチャの組み合わせに合わせたpipelineを作ります。Input Range Modeと繰り返し方法は専用のuniformで更新します。対応表が変わったときだけそのbufferを書き換え、容量不足で拡張し、破棄時には対応表と入力のbufferを解放します。
GPUのbuffer・bindingとWGSLの評価は、`@gs/shared/gpu/color-ramp.ts`の`createColorRampBindings()`で管理します。Vector Field Visualizationも同じ処理を使い、エフェクト同士は参照しません。

補間後はalphaを戻してからlinear sRGBへ変換し、alphaを再乗算します。RGBのHDR・負値を保持し、0〜1へclampしません。保存stopも未乗算linear sRGBです。
このclampは簡単なgamut処理であり、色相・彩度を保つgamut mappingではありません。UIプレビューも同じ処理を使います。
描画履歴への依存はありません。

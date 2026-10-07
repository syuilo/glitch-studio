# Effect Renderer

エフェクトの実行インスタンスとGPU出力を管理する。ノード・Visual Module・レイヤーなどの配置や式のスコープは呼び出し側が所有する。

`effect-parameter-value.ts`は評価済みの末端値を`ShaderInput`や素材リソースなどの実行時入力へ変換する。式の評価・ノード接続の解決・Playerの利用可否は扱わず、渡されたリソースを借用する。

自動解像度は素材の原寸（`getIntrinsicResolution`）、入力の計算用寸法、描画先の順に使う。入力寸法は実装の`getInputResolution`、定義の`resolutionInputParameter`の順に参照する。素材の原寸にはプレビュー倍率を適用するが、入力テクスチャには再適用しない。Selector 3種は全候補のうち画素数が最大のテクスチャの幅・高さを採用し、同数では先頭を優先する。定数だけ・空配列では描画先のサイズを使う。context・customAbsolute指定はこれらの自動判定より優先する。

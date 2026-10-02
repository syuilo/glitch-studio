# Effect Renderer

エフェクトの実行インスタンスとGPU出力を管理する。ノード・Visual Module・レイヤーなどの配置や式のスコープは呼び出し側が所有する。

`effect-parameter-value.ts`は評価済みの末端値を`ShaderInput`や素材リソースなどの実行時入力へ変換する。式の評価・ノード接続の解決・Playerの利用可否は扱わず、渡されたリソースを借用する。

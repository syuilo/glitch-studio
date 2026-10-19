# Apply LUT

`Input`（color / canNode）と`LUT`（assetReference / assetType: lut）を受け取り、未乗算RGBへ.cubeの数値表を適用して元のアルファを戻す。色空間変換・適用量は持たない。未選択では入力を通し、解析エラーでは既存のEffectStatusで描画を停止する。

`cube.ts`はDOM・GPU・Assetに依存しないパーサー。1D、3D、1D＋3Dに対応し、複合表は1Dの行を先に読む。3Dは赤が最速の並びをそのままX/Y/Zへ対応させる。TITLE・コメント・空行・BOM・改行差・指数表記に対応する。数値は有限f32、1Dは2〜65536点、3Dは1辺2〜128点、原本は128 MiBまで。

DOMAIN_MIN/MAXはRGB別の範囲、LUT_1D_INPUT_RANGE・LUT_3D_INPUT_RANGEは各段階のRGB共通範囲。省略時は0〜1。単独表では同値の二重指定を許可し、矛盾は拒否する。複合表のDOMAIN指定はどちらの段階か曖昧なため拒否し、段階別のINPUT_RANGEを要求する。不明なヘッダー・重複・行数不一致・無効な範囲を行番号付きエラーにする。

`lut-loader.ts`はBlobの同一性と世代で読み込みを管理する。同じIDでもBlobの差し替えを再解析し、古い成功・失敗を公開しない。準備開始・完了でcacheVersionを更新し、書き出しを含む既存のprepare/waitUntilReady経路で完了を待つ。リソースはエフェクト単位で所有する。複数インスタンス間のGPUキャッシュ共有は行わない。

`lut-resources.ts`はenable32bitDataTexturesに従ってrgba16float / rgba32floatを使う。LUTは数値データなのでpremultiplyせず、sRGB形式も使用しない。16bitの表現範囲を超える値は黙ってInfinityにせず、32bit設定を案内する。読み込み時のみ転送し、失敗時の部分確保と破棄時の全リソースを解放する。

長い1D表はGPUの2D幅上限で折り返して格納し、各チャンネルの隣接点をテクセル中心でサンプリングして線形補間する。3D表はテクセル中心へ補正した座標で三線形補間し、LODは0固定。各段階で入力をそのdomainにクランプするが、出力値は0〜1へクランプしない。画像出力の保存形式はintermediateTextureFormatに従う。

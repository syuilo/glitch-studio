# Apply LUT

通常パラメータの`Input`（color / canNode）と静的設定の`LUT`（assetReference / assetType: lut）を受け取り、未乗算RGBへ.cubeの数値表を適用して元のアルファを戻す。LUT Input Color Space・LUT Output Color SpaceをそれぞれLinear sRGB／sRGBから指定する。表の境界で変換し、エフェクトの入出力は常にlinear sRGB。適用量は持たない。未選択では入力を通し、解析エラーは配置の初期化エラーとして報告する。

`cube.ts`はDOM・GPU・Assetに依存しないパーサー。1D、3D、1D＋3Dに対応し、複合表は1Dの行を先に読む。3Dは赤が最速の並びをそのままX/Y/Zへ対応させる。TITLE・コメント・空行・BOM・改行差・指数表記に対応する。数値は有限f32、1Dは2〜65536点、3Dは1辺2〜128点、原本は128 MiBまで。

DOMAIN_MIN/MAXはRGB別の範囲、LUT_1D_INPUT_RANGE・LUT_3D_INPUT_RANGEは各段階のRGB共通範囲。省略時は0〜1。単独表では同値の二重指定を許可し、矛盾は拒否する。複合表のDOMAIN指定はどちらの段階か曖昧なため拒否し、段階別のINPUT_RANGEを要求する。不明なヘッダー・重複・行数不一致・無効な範囲を行番号付きエラーにする。

`_impl_.ts`の`init()`は`resources.lut`から配置に固定された素材を一度だけ読み込む。読み込み後に中断を確認し、初期化の完了を待って描画を開始する。静的設定・同じIDのAssetの差し替えでは配置を作り直す。GPUリソースは配置ごとに所有・解放する。

`lut-resources.ts`はenable32bitDataTexturesに従ってrgba16float / rgba32floatを使う。LUTは数値データなのでpremultiplyせず、sRGB形式も使用しない。16bitの表現範囲を超える値は黙ってInfinityにせず、32bit設定を案内する。読み込み時のみ転送し、失敗時の部分確保と破棄時の全リソースを解放する。

長い1D表はGPUの2D幅上限で折り返して格納し、各チャンネルの隣接点をテクセル中心でサンプリングして線形補間する。3D表はテクセル中心へ補正した座標で三線形補間し、LODは0固定。各段階で入力をそのdomainにクランプするが、出力値は0〜1へクランプしない。画像出力の保存形式はINTERMEDIATE_TEXTURE_FORMATに従う。

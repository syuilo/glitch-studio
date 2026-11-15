# エフェクト実装の規約

このディレクトリでは、ルートの[AGENTS.md](../../../../AGENTS.md)に加えて以下を適用する。

## 配置と責務

- 1エフェクトを`src/fx/<effectId>/`に置き、`_def_.ts`で`defineEffect(...)`、`_impl_.ts`で`implementEffect<typeof definition>(...)`をdefault exportする。ディレクトリ名と定義の`id`を一致させる。一覧は`import.meta.glob`で自動登録される。
- `_def_.ts`はUIからも参照するため、GPU処理や実装への依存を持たせない。WGSL・補助処理・内蔵アセット・固有仕様のREADMEは同じエフェクトのディレクトリで所有し、内蔵アセットは静的importする。
- 他のエフェクトや上位のVisual Module・Timeline・Glitch Studio層へ依存しない。別パッケージは`@gs/`経由で参照し、共通化は責務が一致する範囲に限る。

## 定義とパラメータ

- [EffectDefinition](src/effect-definition.ts)に従い、表示名、日本語・英語の`description`、`kind`（`generate` / `modify`）、既存の分類に沿った`tags`を指定する。
- `paramDefs`では`dataType`・`ui`・`defaultValue`・`canNode`の責務を分ける。通常の既定値は`{ inputSource: 'literal', value: ... }`。配列・構造体では子の型・UI・設定を分離し、保存用Bindingと評価済みの値を混同しない。詳細は[DataTypeとParameter](../../../../docs/data-type-and-parameter.md)を参照する。
- `primaryInputParameter`、`resolutionInputParameters`、`outputDefs`、`primaryOutput`を明示する。主入出力なしは`null`、解像度入力なしは`[]`。主入力・解像度入力・`kind`は役割が異なるため、それぞれ仕様に合わせて選ぶ。素材の原寸を使う場合は`intrinsicResolutionSetting`を指定する。
- 素材・Player参照など、インスタンスの寿命中に固定する値は`staticSettingDefs`で定義する。静的設定の既定値はBindingで包まず、実装では`init.resources`から受け取る。式・キー・ノード接続で変化する通常パラメータと分ける。

## 入力とWGSL

- `canNode: true`のパラメータは、定数でも接続でも`ShaderInput`として受け取る。配列・構造体の内部も同じ。`uniform`と`texture`の両方を扱い、定数を不要な1×1テクスチャへ変換しない。
- 通常の描画は`createShaderInputPipeline()`を使い、`update()`にはそのパスの実際の出力寸法を渡す。WGSLの`read_<入力名>(position)`は中央原点・+Yが上の各軸`[-1, +1]`を受け取り、接続ごとのFit / Wrap / Filterを適用する。
- computeや画素ごとに異なる分岐から入力を読む場合は`sampling: 'level0'`を指定する。厳密な整数画素参照などの専用処理は必要に応じて直接実装する。配列入力や低レベルAPIも含め、[SHADER_INPUTS.md](SHADER_INPUTS.md)に従う。
- バッファ配置が必要なWGSLは`?shader`で読み、生成された配置情報と`createShaderBuffer()`を使う。配置を手書きしたり実行時に解析したりしない。文字列だけなら`?raw`を使える。
- 複数のWGSL・定数を組み立てる場合は`*.shader.ts`から完成した文字列をexportし、`?shader`で読み込む。ビルド時にNodeで実行されるため、DOM・GPU・実行時パラメータへ依存させない。詳細は[WGSLの事前解析](../../../shared/build/README.md)を参照する。

## 座標・時間・色

- 原則として解像度・フレームレート・アスペクト比によらず見た目や変化速度を保ち、同じ時刻・入力・パラメータから同じ結果を生成する。乱数には明示的なseedを使う。
- 公開する位置・移動ベクトル・距離・SDFは「長辺全体=1」、中央`[0, 0]`、右が+X、上が+Y。正方形の端は±0.5。画像参照用の内部座標との境界で`@gs/shared/spatial-coordinate.ts`を使って換算する。SDFは内側が負、外側が正。詳細は[空間座標](../../../../docs/spatial-coordinate.md)を参照する。
- 見た目の寸法の換算には専用型`sizeReference`と`getSizeReferenceLength()`を使い、既定値は`longSide`とする。位置・ベクトル・SDFの単位は変えない。詳細は[Size Reference](../../../../docs/size-reference.md)を参照する。
- 角度は1を1周とするturn単位。`ctx.time`は秒、`ctx.timeDelta`はミリ秒なので混同しない。ポインターの位置・移動量も長辺全体=1の共通単位。
- 画像の入出力はpremultiplied alphaのlinear sRGB、形式は`INTERMEDIATE_TEXTURE_FORMAT`（`rgba16float`）。保存色・通常の色パラメータは未乗算linear sRGBだが、色の`ShaderInput`は既に乗算済みなので再乗算しない。色を生成する境界では一度だけpremultiplyする。
- HDR・負のRGBを保持し、仕様上必要な場合以外は0〜1へclampしない。透明・半透明も正しく扱う。知覚色空間や映像信号で計算する場合も出力をlinearへ戻す。詳細は[色空間](../../../../docs/color-management.md)を参照する。
- `scalar` / `vector` / `any`は色ではなく、色変換・alpha乗算を行わない。出力はそれぞれ`r` / `rg` / `rgba`のfloat形式で、`enable32bitDataTextures`に応じて16bit / 32bitを選ぶ。画像の形式にはこの設定を適用しない。

## 実行とリソース管理

- [EffectImplementation](src/effect-implementation.ts)の`init()`で準備し、同期の`render(ctx)`でコマンドを記録し、`dispose()`で所有リソースを解放する。解像度・静的設定の変更はインスタンスの再作成で扱う。
- 出力は`outputTextureFactories`で定義し、確保・破棄はレンダラーに任せる。入力・素材・fallbackなどの借用テクスチャは破棄しない。自前のbuffer・中間textureと`createShaderInputPipeline()`の管理リソースは`dispose()`で解放する。
- 複数出力では`usedOutputPorts`を考慮する（省略時は全出力）。`canLazyAllocation: true`の出力は未使用時に存在しないため、`outputDataMap`の値を確認してから参照する。
- パスは`ctx.createPassEncoderFor()` / `ctx.createPassEncoder()` / `ctx.createComputePassEncoder()`を通して作り、統計とタイル描画に対応させる。標準頂点シェーダーは`triangle-list`と`draw(3)`で全画面を覆う。
- 非同期準備は`init()` / `prepare()`から開始し、`reportStatus()`でloading / ready / errorを通知する。破棄後の結果を反映しない。非同期更新など、パラメータだけでは追跡できない変化には`cacheVersion`や`disableCache`で描画キャッシュを対応させる。
- 自身の過去の描画・蓄積状態に依存する場合は`dependsOnRenderHistory: true`にする。一部の設定でのみ使う場合も含む。共通の前フレーム出力が必要なら`needsPreviousFrame`を指定する。単なるリソース再利用や外部履歴の読み取りとは区別する。
- 重いRender Passには`canHaveLongRunningRenderPass: true`を指定し、必要に応じて`getRenderWorkloadHint()`を実装する。タイル分割はレンダラーが担当し、Compute Passは分割されない。詳細は[Effect Renderer](../renderer/README.md)を参照する。

## 検証

- 変更に応じて定数／テクスチャ入力、透明・半透明・HDR、異なる解像度・縦横比、時間・seedの再現性、未使用出力やリソース解放を確認する。固有仕様は各エフェクトのREADMEに記す。
- 関連テストは`test/`にある。リポジトリルートから`pnpm --filter @gs/subsystems_effect_shared test`で実行できる。GPUテストには`CHROME_PATH`が必要で、未設定時はスキップされる。入力基盤・レンダラーを変更した場合は、そのパッケージの関連テストも確認する。

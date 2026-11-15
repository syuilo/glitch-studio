# Visual Module

画像処理用の、ノードを組み合わせてカプセル化したものを「Visual Module」と呼びます。

Visual Moduleは、In/Outノードを含むほか、外部に対するパラメータ定義(Public Parameter)も行えるので、タイムライン上でレイヤーとして使用可能です。

Public Parameterは、`canNode: true` ならInノード経由で配線し、`canNode: false` ならVisual Module内のノードのパラメータに直接アサインしたり、expression上からPUBLIC関数を通じて参照したりできます。

Visual Module内で別のVisual Moduleを通常のエフェクトのように使用するなど、再帰的な使用も将来実装予定です。

Visual Module内の式では、`POINTER_POSITION`でポインタ位置を2要素の配列`[x, y]`として参照できます。位置パラメータの式にそのまま指定でき、成分は`POINTER_POSITION[0]`（X）・`POINTER_POSITION[1]`（Y）で取得できます。入力元を「環境変数」に切り替え、「ポインタ位置 (POINTER_POSITION)」を選ぶことでも直接指定できます。座標は評価対象の描画領域の長辺全体を1とする共通単位で、中央が`[0, 0]`、正方形の端が各軸±0.5です。横長2:1ではXが±0.5、Yが±0.25です。Visual Module Live Previewではプレビュー領域内のポインタ移動に追従し、画像の外側では`-1`〜`1`を超える値も取ります。プレビュー領域を離れると最後の位置を保持します。Timeline内のVisual Moduleでは、既存のポインタ未指定値`[-99999, -99999]`になります。TimelineレイヤーやVisual Module Live PreviewのPublic Parameterを設定する式には公開しません。

レイヤーとして使う場合、下のレイヤーまでの合成結果がInノードの出力になります。Outノードの出力は、タイムライン側でレイヤーのtransform・opacity・合成方法を適用してから、上のレイヤーへの入力になります。

## カスタムパラメータ

エディタの「カスタムパラメータ」で、Visual Module内部の複数ノードから利用する共通の値を定義できます。公開入力やInノードのポートには追加されず、外部から上書きできません。`customParameterDefs`と`customParameterValues`はVisual Module本体の必須フィールドで、未使用時も`[]`と`{}`を保持します。定義と値はVisual Module本体に保存され、同じVisual Moduleを複数箇所で使う場合も、それぞれの利用インスタンスの時刻・公開引数で評価します。

ノードのパラメータメニューの「カスタムパラメータ化」で、現在の固定値から定義を作成し、元のパラメータをIDによる直接参照へ切り替えられます。型・編集UI・現在値を引き継ぎ、作成と参照切り替えは一つのUndo/Redoで扱います。配列・構造体内の末端も対象です。式・加工式や接続を持つ入力は、移動によって評価環境が変わる可能性があるため対象外です。

対応型は数値・真理値・文字列・色・ベクトル・enum・Color Ramp・Size Referenceです。固定値・環境変数・式・キー・Automation Graph・加工式は各型の通常の対応範囲に従います。画像・音声・ノード出力・配列・構造体は対象外です。

ノードとカスタムの基準式・加工式では、`PUBLIC("name")`で公開パラメータ、`CUSTOM("name")`でカスタムパラメータを参照します。`PARAM`は提供しません。公開とカスタムの間では同名を許可しますが、それぞれの種類の中では参照名を一意にします。例えばカスタムの`speed`を`PUBLIC("speed") * 2`と定義し、複数ノードから`CUSTOM("speed")`で利用できます。公開側は従来と同じく`canNode: false`で音声以外の値だけを式へ渡します。

入力方式からの直接アサインは、公開・カスタムの種類とIDで参照します。名前変更でID参照は変わらず、式中の文字列は自動変更しません。削除・型変更後も参照IDを残し、カスタムへの欠落・型違いの直接参照は利用時の描画エラーとして報告します。未選択の直接参照は受け取り側の既定値を使います。型の種類を変更すると所有する値Bindingを外して初期状態へ戻し、Undo/Redoでは定義と値をまとめて復元します。UI・既定値だけの編集では保存値を維持します。

カスタムの環境変数は`TIME`・`TIME_MS`・`END_TIME`・`END_TIME_MS`・`PROGRESS`・`IS_EXPORT`です。キー・Automation Graphも同じVisual Module内部の時刻を使います。`RESOLUTION`・`ASPECT_RATIO`・`POINTER_POSITION`などノード固有の変数は、式・加工式・環境変数入力のいずれでも利用できません。プロジェクトやTimelineのグラフを暗黙に継承せず、Visual Module自身のAutomation Graphだけを参照します。

カスタム同士の参照は定義の順序に依存せず、参照されたときに評価します。一回の描画評価内で結果を共有し、別の描画・時刻・利用インスタンスには持ち越しません。参照値はコピーして渡します。未使用の式エラーは描画を止めませんが、実行された参照経路の自己参照・相互参照は`a → b → a`のように経路付きで失敗します。条件分岐の循環も、その分岐が実行された評価で報告します。

カスタムの値編集はノードの履歴・GPUリソースを保持し、評価済みの値の変化を既存の描画キャッシュへ伝えます。定義の追加・削除・変更は、公開定義の変更と同じ再作成経路を使います。

## Visual Moduleファイル

- `.gsvm`はMessagePackで、種別・形式バージョン・Glitch Studioバージョン・表示名・`VisualModule`本体・依存するAsset原本・Player定義を保存する。プロジェクト内のVisual Module IDやAssetの元ファイルパス、Visual Module Live Previewの引数、配置先レイヤーの設定・実行時の再生状態は含めない。
- `glitch-studio/shared/src/visual-module-resources.ts`が依存収集を、`glitch-studio/ui/src/gsvm.ts`がエンコード／デコード・取り込み準備を担当する。Asset／Playerの収集はGlitch Studioの責務とし、Visual Module subsystemは所属プロジェクトを知らない。
- 依存収集はエフェクトの`staticSettingDefs`に従って`staticSettings`のAsset・Player IDを調べる。通常パラメータと公開パラメータは音声ルーティングのPlayer参照だけを収集し、配列・構造体・追加用の既定値も調べる。素材参照をBindingや加工式に含めることはできない。素材の原本は`Blob`から`Uint8Array`へ変換して保存する。
- 取り込み時はVisual Module・Asset・Playerに新しいプロジェクト内IDを生成し、素材・Playerの参照を書き換える。内部のノード・公開パラメータ・出力・Automation GraphのIDは、そのVisual Module内のスコープなので維持する。
- ファイル由来のPlayerは素材IDを付け替える。カメラ・マイク・ライブストリーム由来のPlayerは参照を保ったまま入力未指定に戻し、再指定が必要な名前をUIへ返す。現在のPlayer UIが再指定できる外部入力はWebcamだけ。
- `importVisualModule` Commandが準備済みのVisual Module・Asset・Playerを一括追加する。Undo/Redoの通知で`visualModuleRegistration`の追加・削除をVisual Module Live PreviewとTimelineの両レンダラーへ同期する。Visual Module Live Preview中のVisual ModuleをUndoで除去した場合はTimeline表示へ戻す。

## Webへの書き出し

Visual Moduleエディタの「その他」から、HTML + JavaScriptのZIPまたは単一HTMLとして書き出せます。Web Component・Worker・使用するCustom Shader Effect・参照Assetを同梱し、HTTPSまたはlocalhost上のWebGPU対応Chromeでエディタなしに再生します。

表示寸法は埋め込み先のCSS、描画寸法は表示先の物理ピクセル・描画倍率・最大画素数で決まります。公開値は`parameters`属性のJSONまたは`setParameter` / `setParameters` APIで設定できます。primary pointerの位置を既存の`POINTER_POSITION`へ渡します。Playerは未接続とし、タイルレンダリングは行いません。

生成物の構成、公開API、停止・リサイズ・再接続の規約、配信条件は[embedパッケージのREADME](../packages/glitch-studio/embed/README.md)を参照してください。`.gsvm`の保存・取り込みとは独立した配布形式です。

## ノードの解像度

- ノードの解像度設定は `auto` / `context` / `customAbsolute` です。contextはVisual Module Live Previewではプロジェクト、タイムラインではそのノードが所属するSceneの解像度です。autoは素材・入力の寸法を優先し、それらがなければcontextへフォールバックします。ノードにprojectモードはありません。
- `auto` / `context` は正の有限数の `scale`（既定値1）を保存し、基準となる幅・高さの両方に掛けます。UIは数値の自由入力で、式・アニメーションには対応しません。両モード間の切り替えでは倍率を維持し、`customAbsolute`から戻した場合は1にします。
- ノードの倍率はプレビュー・書き出し全体の解像度スケールとは独立です。全体倍率で計算用寸法を求めた後にノードの倍率を適用し、各軸を四捨五入して最低1pxにします。最終寸法がGPUの上限を超える場合はエラーにします。`customAbsolute`は全体倍率だけを適用します。
- `auto`で入力に追従する場合は、上流のノード倍率を反映済みの寸法に自身の倍率を掛けます。1920×1080の入力に`auto × 0.5`を二つ繋ぐと、全体倍率1では960×540 → 480×270になります。`context × 0.5`は上流にかかわらずコンテキストの半分です。
- Visual Module内のエフェクトの式は`RESOLUTION`を2要素の配列`[width, height]`で参照する。そのノード自身の倍率・丸めを反映した実際の計算用寸法で、最初の式評価から利用できる。成分は`RESOLUTION[0]`・`RESOLUTION[1]`で参照し、環境変数指定と加工式でも使える。`WIDTH`・`HEIGHT`は廃止する。公開引数の評価には公開しない。

- 解像度は設定変更時にグラフ全体を計画し、フレームの時刻・通常パラメータ・GPUアップロード・非同期準備で変わらない。`intrinsicResolutionSetting`で指定した素材メタデータ、`resolutionInputParameters`で宣言した全接続の最大画素数、contextの順で決める。Selectorの選択位置や入力画像の内容では変わらず、定数入力に固有寸法はない。
- 描画基準・プレビュー倍率の変更でも、Visual Module内の全エフェクトを再作成する。素材原寸・固定寸法によって実寸法が変わらないノードも履歴・準備済みリソースを失う。同じ倍率適用後の描画基準と同じ倍率の再通知では再作成しない。EffectRendererの解像度は生成から破棄まで固定する。
- Visual Module Live Previewでは、ファイルPlayerの原寸を参照素材のメタデータから取得し、Webcamなどのライブ入力はcontextに従う。Playerの選択は静的でも動画フレームは更新される。TimelineはPlayerを管理・解決せず、Player入力には対応しない。
- Playerのフレームが未到着・取得不能の場合、Videoエフェクトは透明画像として描画を続ける。Playerの実行時エラーはVisual Moduleの描画エラーへ伝播せず、現時点ではPlayer側のエラー表示も行わない。フレームの解除・復旧でも更新番号で出力キャッシュを更新する。
- Timelineからの画像入力は`source`を含む全出力段階を所属Sceneの寸法へ揃える。呼び出し側は入力ごとの寸法を宣言し、Visual Module側はScene・プロジェクトの定義を参照しない。

## エフェクトの静的設定

`EffectDefinition.staticSettingDefs`は通常の`paramDefs`と独立した定義で、各ノードは`staticSettings`に値を直接保存する。Imageの画像、Video Frameの動画素材、VideoのPlayer、Apply LUTのLUT、Text・Text Patternのフォントをここに指定する。Imageは通常のエフェクトとして維持する。

静的設定は式・キー・Automation Graph・加工式・Public Parameter参照・公開引数を持たない。素材参照型は通常パラメータとPublic Parameterから除外する。編集はCommand経由で保存・Undo/Redoされ、Visual Module内の全エフェクト・非同期準備・履歴・出力キャッシュを再作成する。通常パラメータの値だけの編集ではこれらを維持するが、接続・Bypass・解像度・構造の変更では未編集のノードも含めて再作成する。素材一覧・メタデータ・画像テクスチャはレンダラーの寿命中に固定する。同じ一覧からの素材選択変更はノード編集で扱い、素材自体の差し替え・再読み込み・追加・削除では両プレビューを再生成する。選択済み画像のテクスチャ欠落は読み込み失敗とし、準備待ちの透明表示にはしない。

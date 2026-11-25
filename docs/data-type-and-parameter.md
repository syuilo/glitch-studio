# DataTypeとParameterの定義

データの型・編集UI・パラメータとしての設定は、それぞれ独立した責務です。定義は `packages/shared/src/data-type/data-type.ts`・`packages/shared/src/data-type/data-type-ui.ts` と `packages/shared/src/parameter/parameter-definition.ts` にあります。

- **`DataType`** は `{ kind: 'scalar' }` のようなオブジェクトです。arrayは `elementType`、structは `fields`、enumは `options` に型に付随する情報を持ちます。UI・初期値・接続可否は持ちません。
- **`DataTypeUiDefinition<T>`** は型に対応する編集方法です。scalarの `controlType` や操作範囲、enumの選択肢の表示名などを持ち、array・structでは再帰します。パラメータ以外のリテラル値の編集にも使えます。
- **`ParameterSettings<T>`** は `defaultValue`・`canNode` と、子要素のパラメータ設定です。子設定に `dataType` やUIを重複して保存しません。
- **`ParameterDefinition<T>`** は上記を組み合わせ、`dataType`・`ui: { label, control }`・パラメータ設定を持ちます。

## 配列・構造体の再帰構造

| 情報 | array | struct |
| --- | --- | --- |
| 子の型 | `dataType.elementType` | `dataType.fields[key]` |
| 子のUI | `ui.control.element` | `ui.control.fields[key]`（`{ label, control }`） |
| 子のパラメータ設定 | `element` | `fields[key]` |

- 配列全体の `defaultValue` と、新規要素を追加するときの `element.defaultValue` は別です。`maxElements` は定義内の既定配列にも適用します。
- array・structの `ui.control.defaultExpanded` は編集UIの初期展開状態です。省略時は展開し、`false`で初期折り畳みにできます。子のstructや配列要素にも個別に指定できます。ユーザーが切り替えた状態は編集対象・パラメータパスごとにプロジェクトの編集セッション中だけ保持し、保存値・Undo/Redo・レンダリングには影響しません。
- 配列の定義では `defaultValue` に値の配列を置きます。配置側で保存するBindingの `value` は `ParameterArrayElement[]`（`{ id, binding }[]`）です。IDは同じ配列内で一意にし、編集対象は親まで含むIDのパスで指定します。未設定の配列の表示と初回編集は、順序から生成した同じIDを使います。追加・要素の複製では新しいIDを発行し、値やBindingの種類の変更・移動・Undo/RedoではIDを維持します。
- リセットは対象Binding内部の配列要素IDを再帰的に再発行します。対象要素自身のIDは親が所有するため維持し、Undo/Redoでは生成済みのIDを復元します。color/vectorの成分配列やキーフレームのIDはこの処理の対象外です。
- Native Effectの `init()` に渡る配列は `kind: 'array'` と `elements` を持ち、各要素は解決済みの `EffectParameterInput` です。配列の保存に使う要素IDとBindingは評価前のデータに属します。式から要素IDを指定する参照は提供しません。
- 例えば構造体の `defaultValue` は `{ myColor: [1, 0, 0, 1] }` と書きます。配置で使う構造体のBindingは、コンテナと子をそれぞれ包んで `{ inputSource: 'literal', value: { myColor: { inputSource: 'literal', value: [1, 0, 0, 1] } } }` になります。
- コンテナ自体への式・ノード接続は扱いません。配列・構造体の内部では、末端の設定に従って式や接続を扱います。

## エフェクトのパラメータセクション

`EffectDefinition.ui.parameterLayout`は、ノードとTimelineのエフェクト設定で共有する表示用ツリーです。文字列でトップレベルのパラメータキーを参照し、`{ type: 'section', id, label, children }`で入れ子のセクションを配置します。配列順が表示順になり、パラメータと子セクションを混在できます。struct・arrayはそれぞれの編集UIごと配置し、セクションによって値の構造や参照パスを変更しません。

```ts
ui: {
	parameterLayout: [
		'input',
		{
			type: 'section', id: 'lighting', label: 'Lighting',
			children: [
				{ type: 'section', id: 'direction', label: 'Direction', children: ['lightAngle', 'lightElevation'] },
				'lightIntensity',
			],
		},
	],
},
```

- レイアウトを省略すると`paramDefs`順に表示します。指定時は全パラメータを一度ずつ配置します。Native Effectでは`defineNativeEffect()`が未知の参照・配置漏れ・重複と、エフェクト内で重複するセクションIDを型検査で検出します。
- セクションは既定で展開し、`defaultExpanded: false`で初期折り畳みにできます。親を閉じても子のUIと開閉状態を維持します。
- 開閉状態は編集対象・エフェクト・セクションIDごとに編集セッション中だけ保持します。保存値・変更判定・Undo/Redoには含めません。
- 詳細パラメータの表示設定と既定Bindingの比較は通常の行と共通です。表示対象がないセクションは見出しも隠します。空のセクションも同様です。
- 折り畳んだ範囲のノード接続線は、表示中の最も近い見出しへ集約します。struct・array・セクション・ノード全体の折り畳みを組み合わせられ、見出しの仮想ポートは配線の表示だけに使用します。

## 型の判定・検証とUIへの受け渡し

- 種類の判定は `dataType.kind`、構造を含む型の等価判定は `areDataTypesEqual()` を使います。オブジェクトの `===` で型を比較しないでください。ノード接続の互換性判定は、anyの規約を含む `areNodeDataTypesCompatible()` を使います。
- パラメータ定義全体を種類で絞り込む場合は `isParameterType(def, 'scalar')` などを使えます。種類名だけ必要な選択UIやDOM属性では `DataType['kind']` / `dataType.kind` を使い、保存する型はオブジェクトのままにします。
- enumの `options` は文字列のみです。表示名は `ui.control.labels` に分離し、初期値も選択肢の文字列にします。数値計算やGPUで番号が必要なら利用側の境界で変換します。
- `GsLiteralLeafValueControl.vue` は `LeafDataType` と対応する `control`、リテラル値を受け取ります。パラメータ定義やBinding全体は渡しません。array・structの展開とフィールドラベルの表示は上位コンポーネントの責務です。enumの選択肢ラベルは末端コントロールでも使用します。

## Size Reference

サイズ指定には専用型`{ kind: 'sizeReference' }`を使用できます。Height・Width・Short Side・Long Sideから選び、共通の既定値はLong Sideです。汎用enumへ変換せずに保存・式評価・公開パラメータ・Holdのキーで扱います。[サイズ基準の規約と対象パラメータ](./size-reference.md)を参照してください。

## Color

`color`の保存値・式の戻り値・キーフレームは、未乗算linear sRGBのRGBAです。RGBはHDR・負値を許し、alphaは0〜1の被覆率として扱います。HEX・sRGB 0〜255・HSL・スポイトはUIの境界で変換します。`[0.5, 0.5, 0.5, 1]`はlinearの0.5で、標準sRGB表示では約`#BCBCBC`です。[色空間の規約](color-management.md)も参照してください。

## Color Ramp

`{ kind: 'colorRamp' }`は、scalarからcolorへの対応表を一つの末端値として扱います。
`packages/shared/src/color-ramp.ts`の`ColorRamp`は`stops`・`interpolation`・`colorSpace`・`repeatCount`・`repeatMode`を持ち、
各stopは`{ id, position, color }`です。stop内部にはBindingを持たせません。

- stopは1個以上。IDはランプ内で一意な空でない文字列、位置は0〜1の有限値とします。RGBAは未乗算linear sRGBの有限値で、alphaは0〜1です。
- 初期値は位置0の黒と位置1の白（不透明）、Linear・Linear sRGB・繰り返し1回・Wrapです。RGBの有限な範囲外値は保存・描画結果の両方に保持します。
- `repeatCount`は正の有限値で、GPUのf32で有限かつ正の値として表現できる必要があります。小数も許し、0.5回なら元の配色の前半だけを表示します。`repeatMode`は`wrap`または`pingPong`です。どちらも片道を1回とし、Ping-pongの2回は`0→1→0`、3回は`0→1→0→1`です。
- 繰り返しの領域はstopの配置によらず0〜1固定です。入力を0〜1へ制限して繰り返し位置へ変換し、その後にstopを評価します。Wrapの内部の継ぎ目は先頭へ戻しますが、整数回で終わる位置1では終端色を維持します。小数回では途中の色で終わります。0〜1の範囲外は、繰り返し後の端の色を延長します。入力・繰り返し数・その積はGPUと同じf32へ丸め、周期境界の選択を揃えます。
- 評価ではstop位置をGPUと同じf32へ丸め、保存順を保って位置順に並べます。同位置では保存順で最後のstopを採用し、左から近づく区間には最初のstopを使います。繰り返し後の参照位置がstopの範囲外ならその端の色、単一stopは全域でその色です。保存値の順序・位置は変更しません。
- 補間は`constant`・`linear`・`smoothstep`・`smootherstep`・`easeIn`・`easeOut`、補間色空間は`srgb`・`linearSrgb`・`oklab`・`oklch`です。色空間の設定変更で保存済みのRGBAを書き換えません。
- `linear`以外の連続補間は、隣接stop間の進行率`t`（0〜1）を変換してから色・alpha・OKLCHの色相へ同じ進行率を適用します。`smoothstep`は`t²(3−2t)`、`smootherstep`は`t³(6t²−15t＋10)`で、後者は両端の1階・2階微分が0です。`easeIn`は`t²`で始点の色を長く保ち、`easeOut`は`t(2−t)`で早めに終点の色へ移る二次補間です。
- 選択した色空間へ変換してからalphaを乗算して補間します。OKLCHではCSS Color 4と同様にL・Cだけへalphaを乗算し、色相はalphaと独立に補間します。完全透明な有彩色stopも色相を保持するため、alphaの0と微小な正値で色相の経路が切り替わりません。補間後は乗算した成分を未乗算へ戻し、linear sRGBへ変換して再びalphaを乗算します。RGBはclampしません。alphaが0の場合は透明色を返します。端点とConstantでは色空間変換の往復を省略します。
- OKLCHの色相経路は省略可能な`hueInterpolation`で指定します。`shorter`（既定）・`longer`・`increasing`・`decreasing`に対応し、他の色空間ではこの設定を使いません。変換後のCが0.000004以下の場合は無彩色としてCを0に揃え、補間区間の相手の色相を借ります。色相経路はalphaを乗算する前に区間ごとに準備し、CPUプレビューとGPUで共有します。
- 固定値・環境変数・ランプ全体を返す基準式と加工式・Nodes Effectの公開入力で利用できます。キーフレーム・Curve Animation・テクスチャとしてのノード接続は扱いません。
- 式は各stopのIDを安定した文字列で返してください。加工式の`VALUE`もランプ全体で、式の内部変更は保存値へ書き戻されません。不正な構造や非有限値はエラーとして報告します。

専用UIはプレビューをクリックすると編集用ポップアップを開き、stopの追加・削除・選択・色・位置と繰り返し設定を編集します。バーは繰り返し後の結果を表示しますが、stopのハンドルは繰り返し前の位置を保ちます。「繰り返し前を表示」はエディタのバーだけを切り替え、保存値やUndoには影響しません。プリセットのプレビューにも現在の繰り返し設定を反映し、適用時は設定を維持してstopだけを置き換えます。

OKLCHを選択したときだけ色相の補間経路を表示します。バーのダブルクリックでその位置へ追加し、追加色は表示切替によらず繰り返し前の補間色から取得します。重複stopは選択欄から個別に選べます。左右キーで0.01、Shift併用で0.1移動し、Delete/Backspaceで削除します。最後のstopは削除できません。外側のクリック・Escape・閉じるボタンでポップアップを閉じ、開いている間の変更を一つのUndoにまとめます。

```aiscript
// ランプ全体を返す式
{
  interpolation: "linear"
  colorSpace: "oklch"
  hueInterpolation: "shorter"
  repeatCount: 2.5
  repeatMode: "pingPong"
  stops: [
    { id: "start", position: 0, color: [1, 0, 0, 1] }
    { id: "end", position: 1, color: [0, 0, 1, 1] }
  ]
}
```

```aiscript
// 固定値で編集したランプを加工する式
VALUE.stops[0].color = [1, 0, 0, 0.5]
VALUE.colorSpace = "linearSrgb"
VALUE
```

## パラメータの参照スコープ

- Nodes Effectの公開パラメータの `id` は接続・引数・直接参照の識別子、`nameForReference` は `PUBLIC` 式から参照する名前、`ui.label` は表示名です。IDと参照名のブランド型を相互に代用せず、表示名を接続のキーにしないでください。Timelineの公開パラメータIDはTimeline固有の型で、Nodes EffectのIDとは区別します。
- コードで用意する `nameForReference` の初期値・自動生成名・テストデータは、`my_input`・`my_param_2`・`scene_time` のようなsnake caseに統一します。
- 共有定義の `SharedFunctionCurve` はIDと `nameForReference` を持ちます。式の `FUNCTION_CURVE("curve_name", x, "clamp")` は参照名で検索します。Curve Animationの `curveBinding` はインラインのFunction Curveか共有定義のIDを保持します。IDで参照している場合は、参照名を変更しても接続が維持されます。
- Nodes Effectの公開パラメータの `canNode: true` はInノードの出力として公開することを表します。内部からはInノードへの配線で参照し、`nodesEffectPublicParameterReference` や `PUBLIC` による直接参照は `canNode: false` の公開パラメータに限定する仕様です。ただし音声は`nodesEffectPublicParameterReference`だけで参照し、`PUBLIC`には公開しません。入力が定数かテクスチャかによって参照方法を変えません。
- レイヤーの引数・合成設定と、Nodes Effect内部の式は別の評価スコープです。変数・Function Curve・参照可能なパラメータを呼び出し側から明示し、親スコープを暗黙に継承しません。Curve Animationの再生時刻を渡すことと、同名の変数を式に公開することも別です。

Nodes Effect内部の共通値には、公開入力と独立したカスタムパラメータを使います。`PUBLIC(name)`と`CUSTOM(name)`で参照先を明示し、`PARAM`による優先順位の探索は行いません。カスタム同士の参照・評価環境・エラーの扱いは[Nodes Effect](./nodes-effect.md#カスタムパラメータ)を参照してください。Timelineの公開パラメータも関数名は`PUBLIC`とし、以下の参照スコープは維持します。Timelineに`CUSTOM`は公開しません。

## Timelineレイヤーの公開パラメータ

フォルダ以外の全レイヤーに、`publicParameterDefs`（定義）と`publicParameterValues`（IDをキーにしたBinding）を持たせられます。未定義のレイヤーでは省略できます。Inspectorの「レイヤーの公開パラメータ」から追加し、定義内で表示名・参照名・型・編集UI・初期値を設定します。値は通常のパラメータと同じ方式で編集し、キーの表示・選択・コピー・コンテナ全体の時間移動にも含めます。

対応する型は数値・真理値・文字列・色・ベクトル・enum・Color Ramp・Size Referenceです。画像・Asset・音声・配列・構造体やノード入力は公開しません。固定値・環境変数・式・キー・Curve Animation・加工式の対応範囲は、それぞれの型の通常の値Bindingに従います。

型の種類を変更すると、所有する保存Bindingを外して新しい定義の既定値へ戻します。Undo/Redoでは定義と保存Bindingをまとめて復元します。表示名・編集UI・既定値だけの変更では保存Bindingを維持し、enumの選択肢の削除・改名も既存の値を残して評価時に検証します。Nodes Effectレイヤーの公開パラメータ値だけを編集する場合は、内部の履歴とインスタンスを維持します。

| 参照する場所 | 式の`PUBLIC("reference_name")` | 入力方式からの直接参照 |
| --- | --- | --- |
| 公開パラメータの値・加工式 | 直上の親だけ | すべての祖先 |
| 通常のパラメータの値・加工式 | 自身だけ | 自身とすべての祖先 |

親は、同じScene内でフォルダを除いた直近の祖先（パラメータコンテナ・Transform・Group）です。フォルダはスコープを作らず、その挿入で式の親が変わることはありません。空のパラメータコンテナもスコープとなり、目的の定義がなければ外側へ探索せずエラーです。Scene最上位には親がなく、同じレイヤーの別公開パラメータも参照できないため、公開パラメータ間の循環は構造的に発生しません。親の値を子で加工する場合、子の公開パラメータの式を`PUBLIC("speed") * 2`とし、子の通常のパラメータからその子自身の定義を参照できます。

直接参照は`{ inputSource: 'timelineLayerPublicParameterReference', layerId, parameterId }`を保存し、Nodes Effect内部の参照とは共有しません。未選択では両IDをnullにします。UIには所有レイヤーと表示名・参照名を表示し、型が一致する定義だけを候補にします。参照名はレイヤー内で一意とし、名前変更でも直接参照は維持します。`PUBLIC`内の文字列は自動変更せず、未知の名前・不正な引数は式エラーです。

直接参照先の削除・階層移動ではIDを保持し、UIに欠落・範囲外を表示します。未選択・未解決の参照は受け取り側のパラメータ定義の既定値を使い、存在する参照先の型不一致は評価エラーにします。Group複製では範囲内のレイヤーIDだけを付け替えます。直接参照Binding自体への加工式は提供せず、加工したい値は公開パラメータへ受けて通常の式から参照します。

値は所有レイヤーの式環境・Function Curveを使い、評価サンプルの所属Scene時刻で評価します。子のFunction Curveやクリップの内容時刻は継承しません。参照値はコピーして渡し、式から変更しても保存値や他の利用者へ漏らしません。評価値をシーク間で共有しません。

参照先Sceneの内部とNodes Effect内部は別スコープです。Scene最上位には呼び出し元Sceneレイヤーのパラメータを渡しません。Nodes Effectへはレイヤー側で評価した値を既存の公開入力へ渡します。合成・Transform・カメラと音量にも同じ参照規則を適用し、音声では参照先のキーも通常の音量キーと同じ時刻で評価します。

## 乱数とノイズの式関数

パラメータの式では、TimelineとNodes Effectに共通の数値関数を利用できます。

| 関数 | 引数 | 戻り値 |
| --- | --- | --- |
| `RANDOM(index, seed = 0)` | `index`と`seed`は安全な整数（`−(2^53 − 1)`〜`2^53 − 1`） | 0以上1未満の疑似乱数 |
| `NOISE(x, seed = 0)` | `x`は有限の数値、`seed`は安全な整数 | −1〜1の滑らかな1次元Perlin Noise |

負の座標・seedにも対応します。seedだけ省略でき、引数の暗黙変換や丸めは行いません。null・文字列・非有限値や余分な引数は式エラーになり、レンダリングを失敗させます。

両関数とも同じ引数なら常に同じ数値を返します。レイヤー・パラメータ・現在時刻・評価順・呼び出し回数によって変わらないため、シーク・プレビュー・書き出しで同じ値を再現できます。同じ動きを共有するには同じ座標とseedを使い、別の動きには異なるseedを使います。

時間による変化は`TIME`（秒）を明示的に渡して作ります。Timelineの`TIME`は所属Sceneの時刻です。

```aiscript
// 毎秒12回、−0.03〜0.03の範囲で不連続に切り替える
(RANDOM(Math:floor(TIME * 12), 1) * 2 - 1) * 0.03

// 滑らかな揺れ。3は時間方向の倍率で、一定周期の往復回数ではない
NOISE(TIME * 3, 1) * 0.03

// XとYをそれぞれ異なるseedで揺らす
[
  NOISE(TIME * 3, 1) * 0.03,
  NOISE(TIME * 3, 2) * 0.03
]
```

`RANDOM`の第1引数は最小値ではなくサンプル番号です。範囲`min`〜`max`へ変換するには`min + RANDOM(index, seed) * (max - min)`を使います。`NOISE`は整数座標で0になり、格子点の間を連続した勾配で繋ぎます。元のパラメータ値を加算する処理は含みません。

実装は整数ハッシュと勾配の5次補間で構成し、乱数生成器の状態や固定長の置換テーブルを保持しません。式のASTだけをキャッシュする既存の評価方式を維持します。

## 基準値を加工する式

固定値・環境変数・基準式・キーフレーム・Curve Animationによる基準値の取得に、加工式を独立して重ねられます。加工式はInspectorのパラメータメニューから追加します。式の初期値は、基準式では現在の固定値または定義の既定値、加工式では`VALUE`です。

基準式・加工式の本文は入力中のドラフトとして保持し、入力欄の保存ボタン・Ctrl+Enter・Ctrl+Sで適用します。MacではCtrlの代わりにCommandも使用できます。通常のEnterやフォーカス移動では適用しません。キャンセルボタン・Escで未保存の入力を破棄し、現在の適用済みの値へ戻せます。この操作でプロジェクトやUndo履歴は変更しません。構文エラーの表示は保存前の入力内容を対象に更新します。未保存の本文はプロジェクトやレンダラーへ送らず、明示的に適用した式のエラーは従来どおりレンダリング失敗として扱います。

```ts
{
  inputSource: 'expression',
  expression: 'Math:sin(TIME)',
  expressionModifier: {
    enabled: true,
    code: 'VALUE + NOISE(TIME * 3, 1) * 0.03',
  },
}
```

評価は「基準値 → 加工式 → 最終的な範囲の補正」の順です。`VALUE`はその時刻の加工前の基準値で、加工式だけに公開します。パラメータの型に従って数値文字列を数値へ変換してから加工し、式の結果の型・構造・数値の有限性は検証しません。不正な結果の動作は保証しません。stringに数値を表示する式は`Core:to_str(TIME_MS)`のように明示的に文字列化します。式へ渡す値はコピーするため、配列成分の変更が保存値やキーフレームへ漏れることはありません。

`expressionModifier`の未指定・nullは加工なし、`enabled: false`は本文を保持したまま無効化します。有効な基準式・加工式が空文字列または空白だけの場合はエラーです。構文・実行のエラーもフォールバックせず、そのフレームのレンダリングや書き出しを失敗させます。エラーには基準式／加工式と対象パラメータを含めます。キーが空などの正常な未設定状態に対する既定値の使用とは区別します。

パラメータ定義の `defaultValue` には、配列の初期要素・追加時の要素や構造体フィールドを含め、`DataType` に対応する値を直接指定します。式・キー・加工式は利用箇所のBindingに設定します。Live Previewで引数を省略した場合は定義の既定値を使います。

基準入力の値や方式を変更しても加工式は保持します。加工式の無効化・削除は基準値に影響せず、パラメータ全体のリセットでは両方を定義の既定値へ戻します。Commandを通した編集・Undo/Redo・保存・複製でも加工式を保持します。

キー追加時に保存する値は加工前の補間値です。プレビュー上のドラッグでは、位置・回転の操作量や拡縮率を基準値へ反映し、加工式を保持します。任意の式を逆算しないため、加工後の最終値がポインターの指定値になるとは限りません。操作終了後の枠は、最終編集が反映されたプレビュー応答で加工後の実際の位置・倍率・回転へ確定します。

加工対象は共通のCPU値の末端Bindingです。配列・構造体のコンテナ、音声、ノード接続・レイヤー画像参照・Nodes Effect公開パラメータ参照（`nodesEffectPublicParameterReference`）などのドメイン固有入力は対象外です。対応する入力方式から対象外の方式へ切り替えた場合、加工式は引き継ぎません。`VALUE_AT`・`WIGGLE`や式の多段適用は提供しません。

## Function CurveとCurve Animation

Function Curveは `type: "bezier"` のときに点とX・Yそれぞれの正規化フラグを持つ。固定カーブのX・Yは正規化座標で、Xの定義域は0〜1。Curve Animationは `inputSource: "curveAnimationInline"` のBindingに格納され、`curveBinding` と再生設定を持つ。`curveBinding` は `{ source: "inline", curve }` または `{ source: "reference", curveId }` で表す。共有定義はProject・Timelineレイヤー・Nodes Effectの `functionCurves` に格納する。

| 固定カーブ | 形と設定 |
| --- | --- |
| `linear` / `smoothstep` / `smootherstep` | 0から1へ向かう線形・3次・5次のカーブ。 |
| `easing` | `family`・`direction` で評価する。Backでは `overshootCoefficient`、Elasticでは `period` を設定できる。 |
| `smoothPulse` | X=0.5で1になり、両端の値と傾きが0になる。 |
| `pulse` | X=0.5を中心に、幅 `dutyCycle` の半開区間（始点を含む）で1になる。幅0は常に0、幅1は常に1。 |
| `steps` | `levelCount`（2以上の整数）の等幅区間で、Yが0から1へ段階的に増える。 |
| `sineWave` | Y=0.5から上昇を始める正弦波の一周期。 |
| `deadZone` | X=0.5を中心に、幅 `deadZoneWidth` の区間でYを0.5に固定し、両側は端点へ線形に接続する。幅0は線形、幅1は常に0.5。 |

Backの `overshootCoefficient` は0以上。既定値は1.70158で、0の場合はCubicと同じ曲線になる。Elasticの `period` は基準カーブの正規化Xでの一周期の長さで、有限の正数。既定値は0.3。InOutでは前半と後半をそれぞれ半分に縮めて配置するため、全区間上の実際の周期も半分になる。省略または `null` の設定は既定値を使う。

WorkspaceのFunction Curvesパネルでは設定タブ、インラインのFunction Curveでは編集ウィンドウで曲線の種類と設定を選べる。種類をBézierに切り替えると既定の点から始まり、Undoで切り替え前の定義を復元できる。

Curve Animationは評価スコープの時刻を使う。Xが正規化されている場合、Xの1は `trimmedDurationMs` に対応し、未指定の既定値は1000ms。非正規化Xはミリ秒単位で再生する。Timelineでは開始基準と所属Scene時刻を使い、Effect Live Previewの公開入力ではLive Previewの時刻を使う。

Yが正規化されている場合、曲線のサンプル値 `y` を `min + y * (max - min)` で変換する。`yRangeMin` / `yRangeMax` の `null` はそれぞれ0と1。逆順の範囲は無効で、同値は定数出力になる。Yの0〜1を越える値もそのまま変換する。空カーブのサンプル値は0なので、正規化Yでは範囲の最小値が出力される。

式の `FUNCTION_CURVE(nameForReference, x, wrapMode)` はFunction Curveの座標系のXで評価し、同じ座標系のYを返す。Timelineではローカル定義を名前で優先し、同名のProject共通定義もIDで選べる。Group・Transform・パラメータコンテナのローカル定義は各レイヤーのスコープに属する。Nodes Effect内部では自身の共有定義を使う。

Project共通定義の `nameForReference` はProject内で一意。削除後もBindingの参照IDを保持し、未解決のID参照にはパラメータの既定値を使う。式で参照名が見つからない場合は式エラーになる。Undoで同じID・参照名を復元すると再び解決される。

## Other

Bindingは利用可能な入力方式を所有するドメインで定義します。共通の `ValueParameterBinding` はliteral・環境変数・式・Curve Animation・キーフレームだけを扱います。Nodes Effect内部の `NodesEffectParameterBinding` は共通方式に `node` / `nodesEffectPublicParameterReference` を加えます。Timelineの `TimelineParameterBinding` は共通方式に `timelineLayerPublicParameterReference` を加えます。

Effect Layerは3種類のEffectすべてに `TimelineEffectParameterBinding` を使います。Timelineの入力方式に加え、音声用の `lowerLayerAudio` / `anotherLayerAudio` と画像用の `lowerLayerOutput` / `anotherLayerOutput` を持ちます。画像Bindingにはfit・wrap・filterを保存でき、Nodes Effect内のサンプリングは内部接続が指定します。Nodes Effect Live Previewから渡す `NodesEffectArgumentBindings` は共通方式だけを許可し、タイムラインの合成設定・音量にはTimelineの方式を許可します。

共通の `ParameterBindingBase` はツリー操作に必要な `inputSource` だけを持ち、保存用の全方式を集めたunionにはしません。共通の走査・IDパスによる編集処理はジェネリックにし、呼び出し側のBinding型を保持します。`walkParameters` は渡されたBindingを定義順でたどり、未設定のルートを飛ばします。ノード接続やレイヤー入力は利用ドメイン側で設定します。複数ドメインを扱う編集用unionはUI側に置き、各Commandへ渡す境界で対象を絞り込みます。literalの内部値の完全な静的型付けは行っていないため、配列・構造体内部の入力方式の実行時検証も維持します。

## 静的設定

`packages/shared/src/static-setting.ts`の`StaticSettingDefinition`は`dataType`・`ui.label`・Bindingで包まない`defaultValue`を持つ。値は`StaticSettingValues`に直接保存する。対応型は素材参照（image / video / font / lut）・scalar・bool・string・enum。具体的な設定名と定義はEffect・Timelineの各ドメインが所有し、共通層は利用先を知らない。

素材参照は通常の`DataType`から除外する。静的設定は式・加工式・キー・Curve Animation・ノード接続・Public Parameter参照・公開引数を受け取らない。`audioSource`は音声を受け取る型。定義の既定値は`null`で、実行時の入力は配置側で接続する。

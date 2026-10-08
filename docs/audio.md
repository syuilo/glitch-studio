## 音声パラメータと波形・スペクトラム

- `audioSource`は音声取得元の静的な指定です。`canNode: false`で、式・キー・automation・画像の配線には使いません。LIVEでは`literal`の`null`または`{ type: 'player', playerId }`、Timelineでは`literal: null`または専用Bindingの`lowerLayerAudio` / `{ inputSource: 'layerAudio', layerId: string | null }`を使います。
- 公開音声パラメータは`externalCustomParameterInput`経由で内部エフェクトへ渡し、`PARAM`には公開しません。`EffectDefinition.primaryAudioInputParameter` / `VisualModule.primaryAudioInputId`は主音声入力を指定し、Timelineでの初期割当・リセットを下層音声にします。画像の主入力・解像度・合成方法とは独立した役割です。
- `AudioInput`は取得元に依存しない描画時の契約で、PCMは保存データに含めません。`audioWaveform`と`audioSpectrum`はこの入力から音声窓を取得します。Timelineの窓は所属Scene時刻までの過去区間で48kHz固定、LIVEはPlayerの保持PCMを使います。モノラルは左右へ複製します。
- `AudioInput.sourceKey`は取得元・変更世代を、`cacheKey`は現在の窓も含めたスナップショットを識別します。通常の追記ではsourceKeyを維持します。`sampleRate`と半開区間の`startFrame`・`endFrame`を公開し、任意の過去を取得できる入力のstartFrameは-Infinityです。履歴の差し替えやPCMの編集ではsourceKeyを変更します。
- `audioSpectrum`はFFTサイズの1/4サンプル間隔で解析し、最大128区間まで追いつきます。初回・入力変更・逆方向シーク・窓関数/チャンネル変更では最新の1窓から再開し、平滑化の値を保持します。FFTサイズまたはサンプルレート変更では周波数binが変わるため初期化します。同じ位置の再描画では平滑化を進めず、入力未選択中は透明です。平滑化は描画履歴に依存する例外で、`dependsOnRenderHistory: true`を維持します。エフェクトの再作成時やクリップ区間外では通常どおり履歴を破棄します。
- Playerの指定形式・検証はGlitch Studio shared、履歴からの`AudioInput`生成と共有はGlitch Studio rendererが所有します。Visual Moduleには取得元の解決関数を注入し、共通パラメータ層へPlayerやTimelineのレイヤー参照を集めません。音声履歴は受信時に一度コピーした不変PCMブロックで保持します。同じPlayerの同じ履歴状態はノード・描画間で共有し、更新時も区間とブロック参照だけを固定してPCMを複製しません。
- 下層音声は同じScene内で自分より下の音声・音声有効の動画・子Sceneを含み、所属Scene時刻で各階層の音量を適用します。現在有効なクリップだけでなく窓内の過去のクリップも含め、区間外は無音にします。正規化・クリッピング・プレビュー出力音量は適用しません。音声入力の未選択は透明、入力があって無音なら基準線を描画します。
- 指定レイヤーの音声は、入力を所有するレイヤーと同じScene直下の音声・動画・Sceneレイヤーから選びます。上下の順序によらず指定レイヤー単体の出力を使い、Sceneレイヤーは配置のトリム・音量を適用した子Scene全体の音声を出力します。子Scene内部のレイヤーは直接指定できません。選択はIDで保存し、削除・欠落・不適合な参照先はIDを保持して入力なしとし、Undoで復旧します。空・無効のレイヤーや音声無効の動画は有効な参照先として無音を返します。Visual Moduleの共有定義にScene参照を保存せず、配置レイヤーの引数が所有します。
- `AudioWindow`は`frameCount`と`sample(frame, channel)`で読む固定区間のビューです。LIVEは必要な不変ブロックだけ、Timelineはミックス済みPCMを参照し、窓取得・モノラルの左右複製・無音補完のための配列を作りません。ブロックは有限の直近区間と参照中の窓だけが保持し、利用終了後はGCへ任せます。ブロックプール・独自参照カウント・シーク前の解析履歴再現は行いません。解析状態に不要な音声入力やPCMを保持しません。
- 非同期の音声準備は描画前に待機し、古い要求の完了・失敗は新しい入力へ反映しません。各モーションブラーサブサンプルは自身のScene時刻で取得します。PCMの取得はシーク履歴や再生Workerの時計に依存させません。Spectrumの平滑化は描画されたサブサンプルの順序に従います。
- 描画要求のキャンセルは読み出しキュー・ミックス・PCM読み出しへ伝え、待機中の要求を実行せず、実行中もクリップ・デコードブロック・窓の境界で終了します。中断した窓はキャッシュせず、デコーダー資源は実行中の読み出し完了後に解放します。

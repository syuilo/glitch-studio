import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import checker from '@gs/subsystems_effect_shared/fx/checker/_def_.ts';
import grid from '@gs/subsystems_effect_shared/fx/grid/_def_.ts';
import hexGrid from '@gs/subsystems_effect_shared/fx/hexGrid/_def_.ts';
import polkadot from '@gs/subsystems_effect_shared/fx/polkadot/_def_.ts';
import stripe from '@gs/subsystems_effect_shared/fx/stripe/_def_.ts';
import sineWaveWarp from '@gs/subsystems_effect_shared/fx/sineWaveWarp/_def_.ts';
import decoderCorruption from '@gs/subsystems_effect_shared/fx/decoderCorruption/_def_.ts';
import textPattern from '@gs/subsystems_effect_shared/fx/textPattern/_def_.ts';
import kaleidoscope from '@gs/subsystems_effect_shared/fx/kaleidoscope/_def_.ts';
import glass from '@gs/subsystems_effect_shared/fx/glass/_def_.ts';
import cellRepeater from '@gs/subsystems_effect_shared/fx/cellRepeater/_def_.ts';
import cellTransform from '@gs/subsystems_effect_shared/fx/cellTransform/_def_.ts';
import pointerTrail from '@gs/subsystems_effect_shared/fx/pointerTrail/_def_.ts';
import type { ParameterBindingBase } from '@gs/shared/parameter/parameter-binding.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { StaticSettingValues } from '@gs/shared/static-setting.ts';
import type { EffectResolution } from '@gs/subsystems_effect_shared/resolution.ts';
import type { VisualModule } from '@gs/subsystems_visual-module_shared/types.ts';
import { isTimelineContainerLayer } from '@gs/subsystems_timeline_shared/types.ts';
import type { TimelineLayer } from '@gs/subsystems_timeline_shared/types.ts';
import type { Project } from './gsproj.ts';

// 2026-10-22〜31の開発中の形式変更だけを救済する一時処理。
// 同じgsVersion内にも変更があるため、旧名と不足フィールドで判定する。
// 角度の単位変更、WIDTH・HEIGHTの廃止、削除済みliquidGlassの復元・置換は対象外とする。
const changedEffectDefinitions: Record<string, { paramDefs: Record<string, ParameterDefinition> }> = Object.fromEntries(
	[checker, grid, hexGrid, polkadot, stripe, sineWaveWarp, decoderCorruption, textPattern, kaleidoscope, glass,
		cellRepeater, cellTransform, pointerTrail]
		.map(definition => [definition.id, definition]),
);
const patternEffectIds = new Set(['checker', 'grid', 'hexGrid', 'polkadot', 'stripe']);
const effectReferenceSettingNames: Record<string, string> = {
	image: 'image', video: 'player', videoFrame: 'asset', applyLut: 'lut', text: 'font', textPattern: 'font',
};
const removedReferenceParameterTypes = new Set(['imageAssetTextureReference', 'assetReference', 'playerReference']);

function migrateStaticReference(parameters: Record<string, ParameterBindingBase>, parameterName: string, staticSettings: StaticSettingValues): string | null {
	let value = staticSettings[parameterName];
	// 新形式の明示的なnullも保持する。旧パラメータから移すのは設定キーが存在しない場合だけ。
	if (!Object.hasOwn(staticSettings, parameterName)) {
		const binding = parameters[parameterName] as (ParameterBindingBase & {
			value?: unknown; expressionModifier?: { enabled: boolean } | null;
		}) | null;
		// 動的な参照は静的設定で再現できないため、評価を試みず未選択にする。
		value = binding?.inputSource === 'literal' && binding.expressionModifier?.enabled !== true
			&& typeof binding.value === 'string' ? binding.value : null;
	}
	delete parameters[parameterName];
	return typeof value === 'string' ? value : null;
}

function renameParameter(parameters: Record<string, ParameterBindingBase>, previousName: string, currentName: string): void {
	if (parameters[previousName] == null) return;
	parameters[currentName] ??= parameters[previousName];
	delete parameters[previousName];
}

function migrateEffectParameters(effectId: string, parameters: Record<string, ParameterBindingBase>, resolution: EffectResolution, staticSettings: StaticSettingValues): string {
	if (resolution.mode === 'auto' || resolution.mode === 'context') resolution.scale ??= 1;
	if (effectId === 'waveDistort') effectId = 'sineWaveWarp';
	if (effectId === 'sineWaveWarp') renameParameter(parameters, 'strength', 'amplitude');
	if (patternEffectIds.has(effectId)) renameParameter(parameters, 'density', 'frequency');
	if (effectId === 'decoderCorruption') delete parameters.strength;
	const referenceSettingName = effectReferenceSettingNames[effectId];
	if (referenceSettingName != null) staticSettings[referenceSettingName] = migrateStaticReference(parameters, referenceSettingName, staticSettings);

	// 追加パラメータは現在の定義から補い、保存済みの値・式・接続は維持する。
	const definition = changedEffectDefinitions[effectId];
	if (definition != null) {
		for (const [parameterName, parameterDefinition] of Object.entries(definition.paramDefs)) {
			parameters[parameterName] ??= deepClone(parameterDefinition.defaultValue);
		}
	}
	return effectId;
}

function migrateVisualModuleCustomParameterReferences(value: unknown): void {
	if (value == null || typeof value !== 'object') return;
	if (Array.isArray(value)) {
		for (const item of value) migrateVisualModuleCustomParameterReferences(item);
		return;
	}
	const record = value as Record<string, unknown>;
	if (record.inputSource === 'externalCustomParameterInput') record.inputSource = 'visualModuleCustomParameterReference';
	// struct・array内のBindingにも旧参照が保存されるため、パラメータの木を辿る。
	for (const child of Object.values(record)) migrateVisualModuleCustomParameterReferences(child);
}

function migrateVisualModule(visualModule: VisualModule): Set<string> {
	// 素材参照型そのものが通常パラメータから廃止されたため、公開定義も取り除く。
	// 呼び出し側へIDを返し、Timelineに保存された対応する引数だけを除去する。
	const removedParameterIds = new Set(visualModule.paramDefs
		.filter(definition => removedReferenceParameterTypes.has(definition.dataType.kind))
		.map(definition => definition.id));
	visualModule.paramDefs = visualModule.paramDefs.filter(definition => !removedParameterIds.has(definition.id));
	for (const node of visualModule.nodes) {
		if (node.type !== 'effect') continue;
		node.staticSettings ??= {};
		node.effectId = migrateEffectParameters(node.effectId, node.params, node.resolution, node.staticSettings);
		migrateVisualModuleCustomParameterReferences(node.params);
	}
	return removedParameterIds;
}

function migrateTimelineLayer(layer: TimelineLayer, removedVisualModuleParameterIds: ReadonlyMap<string, ReadonlySet<string>>): void {
	let removedParameterIds: ReadonlySet<string> | null = null;
	if (layer.layerType === 'effect') {
		layer.effectStaticSettings ??= {};
		layer.effectId = migrateEffectParameters(layer.effectId, layer.effectParamValues, layer.resolution, layer.effectStaticSettings);
	} else if (layer.layerType === 'inlineVisualModule') {
		removedParameterIds = migrateVisualModule(layer.visualModule);
	} else if (layer.layerType === 'visualModule') {
		removedParameterIds = removedVisualModuleParameterIds.get(layer.visualModuleId) ?? null;
	} else if (layer.layerType === 'text') {
		layer.textStaticSettings = { font: migrateStaticReference(layer.textParamValues, 'font', layer.textStaticSettings ?? {}) };
	} else if (layer.layerType === 'voicevox') {
		layer.subtitleStaticSettings = { font: migrateStaticReference(layer.subtitleParamValues, 'font', layer.subtitleStaticSettings ?? {}) };
	}
	if (removedParameterIds != null && 'visualModuleParamValues' in layer) {
		for (const parameterId of removedParameterIds) delete layer.visualModuleParamValues[parameterId];
	}
	if (isTimelineContainerLayer(layer)) {
		for (const child of layer.layers) migrateTimelineLayer(child, removedVisualModuleParameterIds);
	}
}

/** MessagePackの復号直後、検証やレンダラーへの受け渡しより前に呼ぶ。素材のバイト列は触らない。 */
export function migrateProjectFile(project: Pick<Project, 'visualModules' | 'timelineScenes'>): void {
	const removedVisualModuleParameterIds = new Map(project.visualModules.map(visualModule => [visualModule.id, migrateVisualModule(visualModule)]));
	for (const scene of project.timelineScenes) {
		for (const layer of scene.layers) migrateTimelineLayer(layer, removedVisualModuleParameterIds);
	}
}

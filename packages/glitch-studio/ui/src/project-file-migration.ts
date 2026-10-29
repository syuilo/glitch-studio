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
import type { ParameterBindingBase } from '@gs/shared/parameter/parameter-binding.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { EffectResolution } from '@gs/subsystems_effect_shared/resolution.ts';
import type { VisualModule } from '@gs/subsystems_visual-module_shared/types.ts';
import { isTimelineContainerLayer } from '@gs/subsystems_timeline_shared/types.ts';
import type { TimelineLayer } from '@gs/subsystems_timeline_shared/types.ts';
import type { Project } from './gsproj.ts';

// 2026-10-22〜29の開発中の形式変更だけを救済する一時処理。
// 同じgsVersion内にも変更があるため、旧名と不足フィールドで判定する。
// 角度の単位変更と、削除済みliquidGlassの復元・置換は対象外とする。
const changedEffectDefinitions: Record<string, { paramDefs: Record<string, ParameterDefinition> }> = Object.fromEntries(
	[checker, grid, hexGrid, polkadot, stripe, sineWaveWarp, decoderCorruption, textPattern, kaleidoscope, glass]
		.map(definition => [definition.id, definition]),
);
const patternEffectIds = new Set(['checker', 'grid', 'hexGrid', 'polkadot', 'stripe']);

function renameParameter(parameters: Record<string, ParameterBindingBase>, previousName: string, currentName: string): void {
	if (parameters[previousName] == null) return;
	parameters[currentName] ??= parameters[previousName];
	delete parameters[previousName];
}

function migrateEffectParameters(effectId: string, parameters: Record<string, ParameterBindingBase>, resolution: EffectResolution): string {
	if (resolution.mode === 'auto' || resolution.mode === 'context') resolution.scale ??= 1;
	if (effectId === 'waveDistort') effectId = 'sineWaveWarp';
	if (effectId === 'sineWaveWarp') renameParameter(parameters, 'strength', 'amplitude');
	if (patternEffectIds.has(effectId)) renameParameter(parameters, 'density', 'frequency');
	if (effectId === 'decoderCorruption') delete parameters.strength;

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

function migrateVisualModule(visualModule: VisualModule): void {
	for (const node of visualModule.nodes) {
		if (node.type !== 'effect') continue;
		node.effectId = migrateEffectParameters(node.effectId, node.params, node.resolution);
		migrateVisualModuleCustomParameterReferences(node.params);
	}
}

function migrateTimelineLayer(layer: TimelineLayer): void {
	if (layer.layerType === 'effect') {
		layer.effectId = migrateEffectParameters(layer.effectId, layer.effectParamValues, layer.resolution);
	} else if (layer.layerType === 'inlineVisualModule') {
		migrateVisualModule(layer.visualModule);
	}
	if (isTimelineContainerLayer(layer)) {
		for (const child of layer.layers) migrateTimelineLayer(child);
	}
}

/** MessagePackの復号直後、検証やレンダラーへの受け渡しより前に呼ぶ。素材のバイト列は触らない。 */
export function migrateProjectFile(project: Pick<Project, 'visualModules' | 'timelineScenes'>): void {
	for (const visualModule of project.visualModules) migrateVisualModule(visualModule);
	for (const scene of project.timelineScenes) {
		for (const layer of scene.layers) migrateTimelineLayer(layer);
	}
}

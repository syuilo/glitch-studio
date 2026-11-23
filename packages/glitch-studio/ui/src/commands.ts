export type { CommandDef } from './commands/definition.ts';
import { NODES_EFFECT_COMMAND_DEFS } from './commands/nodes-effect.ts';
import { TIMELINE_PARAMETERS_COMMAND_DEFS } from './commands/timeline-parameters.ts';
import { TIMELINE_PARAMETER_API } from './commands/timeline-parameter-api.ts';
import { createTimelineCommandDefinitions } from './commands/timeline-api.ts';
import { RESOURCES_COMMAND_DEFS } from './commands/resources.ts';
import { NODES_EFFECT_PARAMETERS_COMMAND_DEFS } from './commands/nodes-effect-parameters.ts';
import { PROJECT_COMMAND_DEFS } from './commands/project.ts';
import { CUSTOM_SHADER_EFFECT_COMMAND_DEFS } from './commands/custom-shader-effect.ts';

export const COMMAND_DEFS = {
	...NODES_EFFECT_COMMAND_DEFS,
	...TIMELINE_PARAMETERS_COMMAND_DEFS,
	...TIMELINE_PARAMETER_API,
	...createTimelineCommandDefinitions(),
	...RESOURCES_COMMAND_DEFS,
	...NODES_EFFECT_PARAMETERS_COMMAND_DEFS,
	...PROJECT_COMMAND_DEFS,
	...CUSTOM_SHADER_EFFECT_COMMAND_DEFS,
};

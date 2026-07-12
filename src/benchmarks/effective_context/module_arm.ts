import {
  DEFAULT_MODULE_SELECTION,
  loadModules,
  parseModuleSelection,
  serializeModuleSelection,
} from '../../config/modules';

// Session 28 (the estimation-discipline positive control): the probe
// module-arm flag, in the TRELLIS_EXP_OMIT_CMT mold (experiment
// instrumentation ONLY). The effective-context probe pins the spawned
// agent's TRELLIS_MODULES to the default selection, so a paired
// module-on/module-off control could not run without new machinery.
// TRELLIS_EXP_MODULES, read ONLY by the probe script's spawn-env
// builder, REPLACES that pinned selection for a probe invocation:
//
//   unset          -> the default selection; the spawn env is
//                     byte-identical to the pre-Session-28 probe
//                     (pinned by module_arm.test.ts).
//   a JSON array   -> exactly that selection, validated against the
//                     module registry BEFORE any spawn (shape via
//                     parseModuleSelection; existence, active status,
//                     and addendum gates via the ordinary loadModules
//                     path — no new prompt or composition path exists).
//
// Guardrail 5: the flag has no config field, is never set by any
// default/worker/Compose configuration, and buildAgentEnv strips it
// unconditionally (rlm_job.ts) — only the probe runner's own
// environment can select a non-default module arm, and the spawned
// agent only ever sees the canonical TRELLIS_MODULES serialization.

export const MODULE_ARM_ENV_VAR = 'TRELLIS_EXP_MODULES';

/**
 * Resolves the probe's module selection from the raw flag value.
 * Undefined means the default selection (the probe's historical
 * behavior, byte-identical). Anything else must parse as a module
 * selection AND load through the ordinary registry path — an unknown,
 * contested, or malformed module refuses the whole invocation before
 * any spawn.
 */
export function resolveProbeModuleSelection(
  raw: string | undefined,
  modulesDir?: string
): string[] {
  if (raw === undefined) {
    return [...DEFAULT_MODULE_SELECTION];
  }
  let selection: string[];
  try {
    selection = parseModuleSelection(raw);
  } catch (err) {
    throw new Error(`Invalid ${MODULE_ARM_ENV_VAR}: ${(err as Error).message}`);
  }
  try {
    loadModules(selection, modulesDir);
  } catch (err) {
    throw new Error(
      `${MODULE_ARM_ENV_VAR} selection failed registry validation: ${(err as Error).message}`
    );
  }
  return selection;
}

/**
 * The canonical TRELLIS_MODULES value for the probe's spawn env. With
 * the flag unset this returns exactly the bytes the probe has always
 * set ('["spatial-flywheel"]') — the byte-identity pin lives on this
 * function.
 */
export function probeModulesJson(raw: string | undefined, modulesDir?: string): string {
  return serializeModuleSelection(resolveProbeModuleSelection(raw, modulesDir));
}

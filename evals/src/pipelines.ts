import { pipelineV1, type PipelineOptions } from "@slabwatch/server"

/**
 * Pipeline versions under evaluation. v2 changes exactly one thing from v1,
 * chosen after reading the v1 results.
 */
export const pipelines: Record<string, PipelineOptions> = {
  v1: pipelineV1
}

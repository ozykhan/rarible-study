/**
 * A stand-in for the model that plays a fixed script, so the agent loop,
 * the tools and the purchase policy can be tested without an API key. The
 * script plays a model that has been talked into misbehaving: it asks for
 * whatever it likes, and the tests check that code refuses.
 */
import type Anthropic from "@anthropic-ai/sdk"
import { Effect } from "effect"
import { Llm, type ConverseRequest } from "../src/llm/Llm.ts"

export interface ToolCall {
  readonly name: string
  readonly input: Record<string, unknown>
}

/** What the previous turn's tools returned, parsed, in call order. */
export type ToolReplies = ReadonlyArray<{ readonly isError: boolean; readonly body: Record<string, any> }>

/** One model turn: tool calls, or the final text. */
export type Step = (previous: ToolReplies) => ReadonlyArray<ToolCall> | string

const repliesIn = (req: ConverseRequest): ToolReplies => {
  const last = req.messages[req.messages.length - 1]
  if (last === undefined || typeof last.content === "string") return []
  return last.content.flatMap((block) => {
    if (block.type !== "tool_result") return []
    const text = typeof block.content === "string" ? block.content : ""
    let body: Record<string, any>
    try {
      body = JSON.parse(text) as Record<string, any>
    } catch {
      body = { error: text }
    }
    return [{ isError: block.is_error === true, body }]
  })
}

const usage = { inputTokens: 0, outputTokens: 0, costUsdMicros: 0, latencyMs: 0 }

export const scriptedLlm = (steps: ReadonlyArray<Step>) => {
  const requests: Array<ConverseRequest> = []
  const replies: Array<ToolReplies> = []
  let ids = 0
  const llm = Llm.of({
    model: "scripted",
    structured: () => Effect.die("the scripted model only converses"),
    converse: (req) =>
      Effect.sync(() => {
        requests.push({ ...req, messages: [...req.messages] })
        const previous = repliesIn(req)
        if (requests.length > 1) replies.push(previous)
        const step = steps[requests.length - 1]
        const out = step === undefined ? "Out of script." : step(previous)
        if (typeof out === "string") {
          return {
            content: [{ type: "text", text: out, citations: null }] as Array<Anthropic.ContentBlock>,
            stopReason: "end_turn" as const,
            usage
          }
        }
        return {
          content: out.map((c) => ({ type: "tool_use", id: `toolu_${++ids}`, name: c.name, input: c.input })) as never,
          stopReason: "tool_use" as const,
          usage
        }
      })
  })
  return {
    llm,
    /** Every request the loop sent, with the tools it offered. */
    requests,
    /** Tool replies the loop returned, one entry per turn after the first. */
    replies
  }
}

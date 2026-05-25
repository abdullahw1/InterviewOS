/**
 * Vapi orchestrator helpers.
 *
 * `buildAssistantConfig` turns a Drill (its `configJson`), the user's
 * Project_Summary rows for each selected Project, and up to ten
 * retrieved code chunks into a Vapi assistant payload. The assistant
 * registers a `fetchCodeChunk(repoName, query)` function tool that
 * routes back to InterviewOS at
 * `${PUBLIC_BASE_URL}/api/drills/${drillId}/voice/tools/fetch-code-chunk`.
 *
 * `mintEphemeralToken` creates the assistant on the Vapi server API
 * and then mints a single-use Web SDK token via
 * `POST https://api.vapi.ai/call/web` with the new `assistantId`. Both
 * server-side calls authenticate with `VAPI_API_KEY`; the secret never
 * leaves this module.
 *
 * Validates: Requirements 9.1, 9.3, 9.4, 20.1
 */

import type { Drill, Project, ProjectChunk, ProjectSummary } from '@prisma/client';

export type DrillPersona =
  | 'Friendly_Mentor'
  | 'Staff_Engineer'
  | 'Hostile'
  | 'Startup_Founder';

export type DrillDifficulty = 'Easy' | 'Medium' | 'Hard' | 'Staff';

export type DrillConfigSnapshot = {
  lengthMinutes: number;
  questionCount: number;
  repoScope: 'Single' | 'Multi' | 'Whole_Portfolio';
  selectedRepos: string[];
  difficultyTier: DrillDifficulty;
  questionTypes: string[];
  persona: DrillPersona;
};

export type ProjectWithSummary = Project & { summary: ProjectSummary | null };

export type AssistantConfig = {
  name: string;
  firstMessage: string;
  model: {
    provider: 'openai';
    model: string;
    systemPrompt: string;
    tools: Array<{
      type: 'function';
      function: {
        name: string;
        description: string;
        parameters: {
          type: 'object';
          properties: Record<string, { type: string; description: string }>;
          required: string[];
        };
      };
      server: { url: string };
    }>;
  };
  voice: { provider: string; voiceId: string };
  transcriber: { provider: string; model: string };
  serverUrl: string;
};

const PERSONA_PROMPTS: Record<DrillPersona, string> = {
  Friendly_Mentor:
    'You are a friendly, encouraging mentor. Ask probing but supportive questions, and gently guide the candidate when they get stuck.',
  Staff_Engineer:
    'You are a senior staff engineer conducting a rigorous technical interview. Press for precision, push back on hand-waving, and probe trade-offs.',
  Hostile:
    'You are a skeptical, hostile interviewer. Challenge every claim, interrupt when answers are vague, and demand concrete evidence.',
  Startup_Founder:
    'You are a startup founder hiring early engineers. Probe scrappiness, ownership, ability to ship, and willingness to wear multiple hats.',
};

const DIFFICULTY_GUIDANCE: Record<DrillDifficulty, string> = {
  Easy: 'Keep questions at an entry level. Focus on fundamentals and learning ability.',
  Medium:
    'Mid-level questions: practical experience, trade-off analysis, deeper technical depth.',
  Hard:
    'Senior-level: complex systems, architectural decisions, strategic thinking.',
  Staff:
    'Staff-level: cross-team scope, leverage, technical strategy, organizational impact.',
};

function getPublicBaseUrl(): string {
  return process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000';
}

function getVapiApiBaseUrl(): string {
  return process.env.VAPI_API_BASE_URL ?? 'https://api.vapi.ai';
}

function requireVapiApiKey(): string {
  const key = process.env.VAPI_API_KEY;
  if (!key) {
    throw new Error('VAPI_API_KEY is not configured');
  }
  return key;
}

/**
 * Build a transient Vapi assistant configuration from a Drill plus the
 * Projects + ProjectChunks the orchestrator has already fetched.
 *
 * Callers are expected to enforce `chunks.length <= 10` upstream
 * (the spec caps total retrieved chunks at 10). This function will
 * defensively slice the input as well.
 */
export function buildAssistantConfig(
  drill: Pick<Drill, 'id' | 'configJson'>,
  projects: readonly ProjectWithSummary[],
  chunks: readonly Pick<ProjectChunk, 'repoName' | 'filePath' | 'content'>[],
): AssistantConfig {
  const config = drill.configJson as unknown as DrillConfigSnapshot;
  const drillId = drill.id;

  const summaryBlock =
    projects.length === 0
      ? '(No project summaries available.)'
      : projects
          .map((p) => {
            if (!p.summary) {
              return `Project ${p.repoName}: (no summary indexed yet)`;
            }
            return [
              `Project ${p.repoName}: ${p.summary.description}`,
              `Tech: ${JSON.stringify(p.summary.techStack)}`,
              `Highlights: ${JSON.stringify(p.summary.highlights)}`,
            ].join('\n');
          })
          .join('\n\n');

  const cappedChunks = chunks.slice(0, 10);
  const chunkBlock =
    cappedChunks.length === 0
      ? '(No code chunks loaded; call fetchCodeChunk to retrieve code on demand.)'
      : cappedChunks
          .map(
            (c) =>
              `--- ${c.repoName}/${c.filePath} ---\n${c.content.slice(0, 600)}`,
          )
          .join('\n\n');

  const systemPrompt = `${PERSONA_PROMPTS[config.persona]}

Difficulty: ${config.difficultyTier}. ${DIFFICULTY_GUIDANCE[config.difficultyTier]}
Question types to cover: ${config.questionTypes.join(', ')}.
Plan to ask approximately ${config.questionCount} questions over ~${config.lengthMinutes} minutes.

You are interviewing the candidate on their own projects. Use the project summaries and code excerpts below as context.

PROJECT CONTEXT:
${summaryBlock}

CODE EXCERPTS:
${chunkBlock}

When you need more code than what is shown, call the fetchCodeChunk tool with a repoName and a search query. Do not invent file paths. Reference real files when asking code-grounded questions. Keep your questions concise and let the candidate speak.`;

  const baseUrl = getPublicBaseUrl();
  const toolUrl = `${baseUrl}/api/drills/${drillId}/voice/tools/fetch-code-chunk`;
  const webhookUrl = `${baseUrl}/api/drills/${drillId}/voice/webhook`;

  return {
    name: 'InterviewOS Drill',
    firstMessage:
      "Hello! I'm your interviewer today. Let's get started — could you give me a quick overview of one of the projects we'll be discussing?",
    model: {
      provider: 'openai',
      model: process.env.ANALYSIS_MODEL ?? 'gpt-4o-mini',
      systemPrompt,
      tools: [
        {
          type: 'function',
          function: {
            name: 'fetchCodeChunk',
            description:
              "Retrieve up to 3 code chunks from the candidate's repos. Use when you need to ground a question or follow-up in specific code.",
            parameters: {
              type: 'object',
              properties: {
                repoName: {
                  type: 'string',
                  description: 'Repository name to search within.',
                },
                query: {
                  type: 'string',
                  description:
                    'What to look for, e.g. function name, concept, file pattern.',
                },
              },
              required: ['repoName', 'query'],
            },
          },
          server: { url: toolUrl },
        },
      ],
    },
    voice: { provider: '11labs', voiceId: 'paula' },
    transcriber: { provider: 'deepgram', model: 'nova-2' },
    serverUrl: webhookUrl,
  };
}

/**
 * Create the assistant on Vapi and pre-create the web call server-side.
 *
 * Two server-side requests are made, both using `VAPI_API_KEY`:
 *   1. `POST /assistant` — registers the assistant, returns its id.
 *   2. `POST /call/web` with `{ assistantId }` — pre-creates the Daily call,
 *      returns a `webCallUrl` the browser passes to `vapi.reconnect()`.
 *
 * `VAPI_API_KEY` is never returned to the browser.
 */
export async function createVapiCall(
  assistant: AssistantConfig,
): Promise<{ assistantId: string; webCallUrl: string; callId: string | null }> {
  const apiKey = requireVapiApiKey();
  const baseUrl = getVapiApiBaseUrl();

  // 1. Create the assistant.
  const assistantRes = await fetch(`${baseUrl}/assistant`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(assistant),
  });
  if (!assistantRes.ok) {
    const detail = await assistantRes.text().catch(() => '');
    throw new Error(
      `Vapi assistant creation failed (${assistantRes.status}): ${detail.slice(0, 500)}`,
    );
  }
  const assistantBody = (await assistantRes.json()) as { id?: string };
  const assistantId = assistantBody.id;
  if (!assistantId) {
    throw new Error('Vapi assistant creation did not return an id');
  }

  // 2. Pre-create the web call. The response is a Vapi Call object whose
  //    `webCallUrl` field is the Daily.co room URL the client joins via
  //    `vapi.reconnect({ webCallUrl })`.
  const callRes = await fetch(`${baseUrl}/call/web`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ assistantId }),
  });
  if (!callRes.ok) {
    const detail = await callRes.text().catch(() => '');
    throw new Error(
      `Vapi web call creation failed (${callRes.status}): ${detail.slice(0, 500)}`,
    );
  }

  const callBody = (await callRes.json()) as Record<string, unknown>;
  const webCallUrl =
    (typeof callBody.webCallUrl === 'string' && callBody.webCallUrl) ||
    (typeof (callBody.transport as Record<string, unknown> | undefined)?.callUrl === 'string' &&
      ((callBody.transport as Record<string, unknown>).callUrl as string)) ||
    '';
  if (!webCallUrl) {
    throw new Error('Vapi web call response did not contain a webCallUrl');
  }

  const callId = typeof callBody.id === 'string' ? (callBody.id as string) : null;

  return { assistantId, webCallUrl, callId };
}

/** @deprecated Use createVapiCall instead */
export const mintEphemeralToken = createVapiCall;

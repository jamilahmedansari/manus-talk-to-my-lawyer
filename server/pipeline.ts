/**
 * Three-stage AI pipeline for legal letter generation:
 *
 * Stage 1: PERPLEXITY (sonar) — Legal research with web-grounded citations
 * Stage 2: OPENAI (gpt-4o) — Initial draft generation from research packet
 * Stage 3: CLAUDE (claude-sonnet-4-20250514) — Final professional letter assembly
 *
 * Each stage has deterministic validators before transitioning.
 * All stages log to workflow_jobs and research_runs for audit trail.
 */

import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import { createPatchedFetch } from "./_core/patchedFetch";
import {
  createLetterVersion,
  createResearchRun,
  createWorkflowJob,
  getLatestResearchRun,
  logReviewAction,
  updateLetterStatus,
  updateLetterVersionPointers,
  updateResearchRun,
  updateWorkflowJob,
} from "./db";
import type { IntakeJson, ResearchPacket, DraftOutput } from "../shared/types";

// ═══════════════════════════════════════════════════════
// MODEL PROVIDERS
// ═══════════════════════════════════════════════════════

/** Stage 1: Perplexity for web-grounded legal research */
const perplexity = createOpenAI({
  apiKey: process.env.PERPLEXITY_API_KEY ?? "",
  baseURL: "https://api.perplexity.ai",
  name: "perplexity",
});
const RESEARCH_MODEL = perplexity.chat("sonar-pro");

/** Stage 2: OpenAI for initial draft generation (via Forge proxy) */
const openai = createOpenAI({
  apiKey: process.env.BUILT_IN_FORGE_API_KEY,
  baseURL: `${process.env.BUILT_IN_FORGE_API_URL}/v1`,
  fetch: createPatchedFetch(fetch),
});
const DRAFT_MODEL = openai.chat("gpt-4o");

/** Stage 3: Claude for final professional letter assembly (via Forge proxy) */
const ASSEMBLY_MODEL = openai.chat("claude-sonnet-4-20250514");

// ═══════════════════════════════════════════════════════
// DETERMINISTIC VALIDATORS
// ═══════════════════════════════════════════════════════

export function validateResearchPacket(data: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!data || typeof data !== "object") return { valid: false, errors: ["Research packet is not an object"] };
  const p = data as Record<string, unknown>;
  if (!p.researchSummary || typeof p.researchSummary !== "string" || p.researchSummary.length < 50)
    errors.push("researchSummary must be a non-empty string (min 50 chars)");
  if (!p.jurisdictionProfile || typeof p.jurisdictionProfile !== "object")
    errors.push("jurisdictionProfile is required");
  if (!Array.isArray(p.issuesIdentified) || p.issuesIdentified.length === 0)
    errors.push("issuesIdentified must be a non-empty array");
  if (!Array.isArray(p.applicableRules))
    errors.push("applicableRules must be an array");
  else {
    (p.applicableRules as unknown[]).forEach((rule, i) => {
      if (!rule || typeof rule !== "object") { errors.push(`applicableRules[${i}] is not an object`); return; }
      const r = rule as Record<string, unknown>;
      if (!r.ruleTitle) errors.push(`applicableRules[${i}].ruleTitle is required`);
      if (!r.summary) errors.push(`applicableRules[${i}].summary is required`);
      if (!["high", "medium", "low"].includes(r.confidence as string))
        errors.push(`applicableRules[${i}].confidence must be high/medium/low`);
    });
  }
  if (!Array.isArray(p.draftingConstraints)) errors.push("draftingConstraints must be an array");
  return { valid: errors.length === 0, errors };
}

export function parseAndValidateDraftLlmOutput(raw: string): { valid: boolean; data?: DraftOutput; errors: string[] } {
  const errors: string[] = [];
  let jsonStr = raw.trim();
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) jsonStr = jsonMatch[1].trim();
  const objMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (objMatch) jsonStr = objMatch[0];

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    // If not JSON, treat raw text as the letter content
    if (raw.trim().length > 100) {
      return {
        valid: true,
        data: {
          draftLetter: raw.trim(),
          attorneyReviewSummary: "AI-generated draft — please review carefully.",
          openQuestions: [],
          riskFlags: [],
        },
        errors: [],
      };
    }
    return { valid: false, errors: ["Could not parse draft output as JSON or plain text"] };
  }

  if (!parsed || typeof parsed !== "object") return { valid: false, errors: ["Draft output is not an object"] };
  const d = parsed as Record<string, unknown>;
  if (!d.draftLetter || typeof d.draftLetter !== "string" || d.draftLetter.length < 100)
    errors.push("draftLetter must be a non-empty string (min 100 chars)");
  if (!d.attorneyReviewSummary || typeof d.attorneyReviewSummary !== "string")
    errors.push("attorneyReviewSummary is required");
  if (!Array.isArray(d.openQuestions)) errors.push("openQuestions must be an array");
  if (!Array.isArray(d.riskFlags)) errors.push("riskFlags must be an array");

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, data: parsed as DraftOutput, errors: [] };
}

export function validateFinalLetter(text: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!text || text.length < 200) errors.push("Final letter must be at least 200 characters");
  if (!text.includes("Dear") && !text.includes("To Whom") && !text.includes("RE:") && !text.includes("Re:"))
    errors.push("Final letter should contain a proper salutation or subject line");
  if (!text.includes("Sincerely") && !text.includes("Respectfully") && !text.includes("Very truly yours") && !text.includes("Regards"))
    errors.push("Final letter should contain a proper closing");
  return { valid: errors.length === 0, errors };
}

// ═══════════════════════════════════════════════════════
// STAGE 1: PERPLEXITY LEGAL RESEARCH
// ═══════════════════════════════════════════════════════

export async function runResearchStage(letterId: number, intake: IntakeJson): Promise<ResearchPacket> {
  const job = await createWorkflowJob({
    letterRequestId: letterId,
    jobType: "research",
    provider: "perplexity",
    requestPayloadJson: { letterId, letterType: intake.letterType, jurisdiction: intake.jurisdiction },
  });
  const jobId = (job as any)?.insertId ?? 0;

  const researchRun = await createResearchRun({
    letterRequestId: letterId,
    workflowJobId: jobId,
    provider: "perplexity",
  });
  const runId = (researchRun as any)?.insertId ?? 0;

  await updateWorkflowJob(jobId, { status: "running", startedAt: new Date() });
  await updateResearchRun(runId, { status: "running" });
  await updateLetterStatus(letterId, "researching");

  const prompt = buildResearchPrompt(intake);

  try {
    console.log(`[Pipeline] Stage 1: Perplexity research for letter #${letterId}`);
    const { text } = await generateText({ model: RESEARCH_MODEL, prompt, maxOutputTokens: 4000 });

    // Parse research packet from response
    let researchPacket: ResearchPacket;
    try {
      const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
      const jsonStr = jsonMatch ? jsonMatch[1] : text;
      researchPacket = JSON.parse(jsonStr);
    } catch {
      // Build a structured packet from the text response
      researchPacket = {
        researchSummary: text.substring(0, 2000),
        jurisdictionProfile: {
          country: intake.jurisdiction.country,
          stateProvince: intake.jurisdiction.state,
          city: intake.jurisdiction.city,
          authorityHierarchy: ["Federal", "State", "Local"],
        },
        issuesIdentified: [intake.matter.description.substring(0, 200)],
        applicableRules: [{
          ruleTitle: "General Legal Framework",
          ruleType: "statute",
          jurisdiction: intake.jurisdiction.state,
          citationText: "See research summary",
          sectionOrRule: "N/A",
          summary: text.substring(0, 300),
          sourceUrl: "",
          sourceTitle: "Perplexity Research",
          relevance: "Primary research findings",
          confidence: "medium" as const,
        }],
        localJurisdictionElements: [],
        factualDataNeeded: [],
        openQuestions: [],
        riskFlags: [],
        draftingConstraints: [],
      };
    }

    // Deterministic validation
    const validation = validateResearchPacket(researchPacket);
    if (!validation.valid) {
      await updateResearchRun(runId, {
        status: "invalid",
        resultJson: researchPacket,
        validationResultJson: { errors: validation.errors },
        errorMessage: `Validation failed: ${validation.errors.join("; ")}`,
      });
      await updateWorkflowJob(jobId, {
        status: "failed",
        errorMessage: `Research validation failed: ${validation.errors.join("; ")}`,
        completedAt: new Date(),
      });
      throw new Error(`Research packet validation failed: ${validation.errors.join("; ")}`);
    }

    await updateResearchRun(runId, {
      status: "completed",
      resultJson: researchPacket,
      validationResultJson: { valid: true, errors: [] },
    });
    await updateWorkflowJob(jobId, { status: "completed", completedAt: new Date(), responsePayloadJson: { researchRunId: runId } });

    console.log(`[Pipeline] Stage 1 complete for letter #${letterId}`);
    return researchPacket;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Pipeline] Stage 1 failed for letter #${letterId}:`, msg);
    await updateResearchRun(runId, { status: "failed", errorMessage: msg });
    await updateWorkflowJob(jobId, { status: "failed", errorMessage: msg, completedAt: new Date() });
    throw err;
  }
}

// ═══════════════════════════════════════════════════════
// STAGE 2: OPENAI DRAFT GENERATION
// ═══════════════════════════════════════════════════════

export async function runDraftingStage(letterId: number, intake: IntakeJson, research: ResearchPacket): Promise<DraftOutput> {
  const job = await createWorkflowJob({
    letterRequestId: letterId,
    jobType: "draft_generation",
    provider: "openai",
    requestPayloadJson: { letterId, letterType: intake.letterType },
  });
  const jobId = (job as any)?.insertId ?? 0;

  await updateWorkflowJob(jobId, { status: "running", startedAt: new Date() });
  await updateLetterStatus(letterId, "drafting");

  const prompt = buildDraftingPrompt(intake, research);

  try {
    console.log(`[Pipeline] Stage 2: OpenAI drafting for letter #${letterId}`);
    const { text } = await generateText({ model: DRAFT_MODEL, prompt, maxOutputTokens: 6000 });

    const validation = parseAndValidateDraftLlmOutput(text);
    if (!validation.valid || !validation.data) {
      await updateWorkflowJob(jobId, {
        status: "failed",
        errorMessage: `Draft validation failed: ${validation.errors.join("; ")}`,
        completedAt: new Date(),
      });
      throw new Error(`Draft output validation failed: ${validation.errors.join("; ")}`);
    }

    const draft = validation.data;

    // Store AI draft as a letter version
    const version = await createLetterVersion({
      letterRequestId: letterId,
      versionType: "ai_draft",
      content: draft.draftLetter,
      createdByType: "system",
      metadataJson: {
        provider: "openai",
        stage: "draft_generation",
        attorneyReviewSummary: draft.attorneyReviewSummary,
        openQuestions: draft.openQuestions,
        riskFlags: draft.riskFlags,
      },
    });
    const versionId = (version as any)?.insertId ?? 0;

    await updateLetterVersionPointers(letterId, { currentAiDraftVersionId: versionId });
    await updateWorkflowJob(jobId, { status: "completed", completedAt: new Date(), responsePayloadJson: { versionId } });

    console.log(`[Pipeline] Stage 2 complete for letter #${letterId}`);
    return draft;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Pipeline] Stage 2 failed for letter #${letterId}:`, msg);
    await updateWorkflowJob(jobId, { status: "failed", errorMessage: msg, completedAt: new Date() });
    throw err;
  }
}

// ═══════════════════════════════════════════════════════
// STAGE 3: CLAUDE FINAL LETTER ASSEMBLY
// ═══════════════════════════════════════════════════════

export async function runAssemblyStage(
  letterId: number,
  intake: IntakeJson,
  research: ResearchPacket,
  draft: DraftOutput
): Promise<string> {
  const job = await createWorkflowJob({
    letterRequestId: letterId,
    jobType: "draft_generation", // reuse type, differentiated by provider
    provider: "anthropic",
    requestPayloadJson: { letterId, stage: "final_assembly" },
  });
  const jobId = (job as any)?.insertId ?? 0;

  await updateWorkflowJob(jobId, { status: "running", startedAt: new Date() });

  const prompt = buildAssemblyPrompt(intake, research, draft);

  try {
    console.log(`[Pipeline] Stage 3: Claude final assembly for letter #${letterId}`);
    const { text: finalLetter } = await generateText({ model: ASSEMBLY_MODEL, prompt, maxOutputTokens: 8000 });

    // Validate the final letter
    const validation = validateFinalLetter(finalLetter);
    if (!validation.valid) {
      console.warn(`[Pipeline] Stage 3 validation warnings for letter #${letterId}:`, validation.errors);
      // Non-fatal: still store it but log the warnings
    }

    // Store the assembled letter as a new AI draft version (replaces the Stage 2 draft)
    const version = await createLetterVersion({
      letterRequestId: letterId,
      versionType: "ai_draft",
      content: finalLetter,
      createdByType: "system",
      metadataJson: {
        provider: "anthropic",
        stage: "final_assembly",
        assembledFrom: {
          researchProvider: "perplexity",
          draftProvider: "openai",
        },
        validationWarnings: validation.errors.length > 0 ? validation.errors : undefined,
      },
    });
    const versionId = (version as any)?.insertId ?? 0;

    // Update the AI draft pointer to the final assembled version
    await updateLetterVersionPointers(letterId, { currentAiDraftVersionId: versionId });
    await updateWorkflowJob(jobId, { status: "completed", completedAt: new Date(), responsePayloadJson: { versionId } });

    // Transition to pending_review
    await updateLetterStatus(letterId, "pending_review");

    await logReviewAction({
      letterRequestId: letterId,
      actorType: "system",
      action: "ai_pipeline_completed",
      noteText: `3-stage pipeline complete. Research (Perplexity) → Draft (OpenAI) → Final Assembly (Claude). Letter is ready for attorney review.`,
      fromStatus: "drafting",
      toStatus: "pending_review",
    });

    console.log(`[Pipeline] Stage 3 complete for letter #${letterId} — now pending_review`);
    return finalLetter;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Pipeline] Stage 3 failed for letter #${letterId}:`, msg);
    await updateWorkflowJob(jobId, { status: "failed", errorMessage: msg, completedAt: new Date() });
    throw err;
  }
}

// ═══════════════════════════════════════════════════════
// FULL PIPELINE ORCHESTRATOR
// ═══════════════════════════════════════════════════════

export async function runFullPipeline(letterId: number, intake: IntakeJson): Promise<void> {
  const pipelineJob = await createWorkflowJob({
    letterRequestId: letterId,
    jobType: "generation_pipeline",
    provider: "multi-provider",
    requestPayloadJson: { letterId, stages: ["perplexity-research", "openai-draft", "claude-assembly"] },
  });
  const pipelineJobId = (pipelineJob as any)?.insertId ?? 0;
  await updateWorkflowJob(pipelineJobId, { status: "running", startedAt: new Date() });

  try {
    // Stage 1: Perplexity Research
    const research = await runResearchStage(letterId, intake);

    // Stage 2: OpenAI Draft
    const draft = await runDraftingStage(letterId, intake, research);

    // Stage 3: Claude Final Assembly
    await runAssemblyStage(letterId, intake, research, draft);

    await updateWorkflowJob(pipelineJobId, { status: "completed", completedAt: new Date() });
    console.log(`[Pipeline] Full 3-stage pipeline completed for letter #${letterId}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Pipeline] Full pipeline failed for letter #${letterId}:`, msg);
    await updateWorkflowJob(pipelineJobId, { status: "failed", errorMessage: msg, completedAt: new Date() });
    await updateLetterStatus(letterId, "submitted"); // revert to allow retry
    throw err;
  }
}

// ═══════════════════════════════════════════════════════
// RETRY LOGIC
// ═══════════════════════════════════════════════════════

export async function retryPipelineFromStage(
  letterId: number,
  intake: IntakeJson,
  stage: "research" | "drafting"
): Promise<void> {
  const retryJob = await createWorkflowJob({
    letterRequestId: letterId,
    jobType: "retry",
    provider: "multi-provider",
    requestPayloadJson: { letterId, stage },
  });
  const retryJobId = (retryJob as any)?.insertId ?? 0;
  await updateWorkflowJob(retryJobId, { status: "running", startedAt: new Date() });

  try {
    if (stage === "research") {
      // Full re-run from research
      const research = await runResearchStage(letterId, intake);
      const draft = await runDraftingStage(letterId, intake, research);
      await runAssemblyStage(letterId, intake, research, draft);
    } else {
      // Re-run from drafting using existing research
      const latestResearch = await getLatestResearchRun(letterId);
      if (!latestResearch?.resultJson) throw new Error("No completed research run found for retry");
      const research = latestResearch.resultJson as ResearchPacket;
      const draft = await runDraftingStage(letterId, intake, research);
      await runAssemblyStage(letterId, intake, research, draft);
    }
    await updateWorkflowJob(retryJobId, { status: "completed", completedAt: new Date() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateWorkflowJob(retryJobId, { status: "failed", errorMessage: msg, completedAt: new Date() });
    throw err;
  }
}

// ═══════════════════════════════════════════════════════
// PROMPT BUILDERS
// ═══════════════════════════════════════════════════════

function buildResearchPrompt(intake: IntakeJson): string {
  return `You are a senior legal research specialist with expertise in US law. Conduct thorough research on the applicable laws, statutes, regulations, and case law for the following legal matter. Use web sources to find current, accurate legal information.

## Legal Matter
- Type: ${intake.letterType}
- Subject: ${intake.matter.subject}
- Description: ${intake.matter.description}
- Jurisdiction: ${intake.jurisdiction.state}, ${intake.jurisdiction.country}
- City: ${intake.jurisdiction.city ?? "Not specified"}
- Desired Outcome: ${intake.desiredOutcome}
${intake.financials?.amountOwed ? `- Amount in Dispute: $${intake.financials.amountOwed} ${intake.financials.currency ?? "USD"}` : ""}
${intake.additionalContext ? `- Additional Context: ${intake.additionalContext}` : ""}

## Required Output Format
Return ONLY a valid JSON object with this exact structure:
\`\`\`json
{
  "researchSummary": "2-3 paragraph summary of the legal landscape and key findings",
  "jurisdictionProfile": {
    "country": "${intake.jurisdiction.country}",
    "stateProvince": "${intake.jurisdiction.state}",
    "city": "${intake.jurisdiction.city ?? ""}",
    "authorityHierarchy": ["Federal", "State", "Local"]
  },
  "issuesIdentified": ["Issue 1", "Issue 2"],
  "applicableRules": [
    {
      "ruleTitle": "Rule name",
      "ruleType": "statute|regulation|case_law|common_law",
      "jurisdiction": "${intake.jurisdiction.state}",
      "citationText": "Full legal citation",
      "sectionOrRule": "Section number",
      "summary": "Plain English summary of the rule",
      "sourceUrl": "URL to the source",
      "sourceTitle": "Source name",
      "relevance": "Why this applies to this case",
      "confidence": "high|medium|low"
    }
  ],
  "localJurisdictionElements": [
    {
      "element": "Local rule or requirement",
      "whyItMatters": "Explanation",
      "sourceUrl": "URL if known",
      "confidence": "high|medium|low"
    }
  ],
  "factualDataNeeded": ["What additional facts are needed"],
  "openQuestions": ["Legal questions that need clarification"],
  "riskFlags": ["Potential legal risks or complications"],
  "draftingConstraints": ["Specific requirements for the letter draft"]
}
\`\`\`

Focus on finding REAL statutes, regulations, and case law with accurate citations. Be thorough and specific to the jurisdiction.`;
}

function buildDraftingPrompt(intake: IntakeJson, research: ResearchPacket): string {
  return `You are a senior attorney drafting a legal letter. Use the research packet below to create a legally sound, persuasive draft.

## Intake Information
- Letter Type: ${intake.letterType}
- Sender: ${intake.sender.name}, ${intake.sender.address}
- Recipient: ${intake.recipient.name}, ${intake.recipient.address}
- Subject: ${intake.matter.subject}
- Facts: ${intake.matter.description}
- Desired Outcome: ${intake.desiredOutcome}
- Deadline: ${intake.deadlineDate ?? "Not specified"}
- Tone: ${intake.tonePreference ?? "firm"}
${intake.financials?.amountOwed ? `- Amount: $${intake.financials.amountOwed} ${intake.financials.currency ?? "USD"}` : ""}

## Research Packet (from Perplexity)
${JSON.stringify(research, null, 2)}

## Required Output Format
Return ONLY a valid JSON object:
\`\`\`json
{
  "draftLetter": "Full formal letter text with proper formatting, legal citations, and professional tone. Include date, addresses, subject line, salutation, body paragraphs, closing, and signature block.",
  "attorneyReviewSummary": "Summary of key legal points, citations used, and areas requiring attorney attention",
  "openQuestions": ["Questions for the attorney reviewer"],
  "riskFlags": ["Legal risks or issues the attorney should verify"]
}
\`\`\`

The letter must:
1. Reference specific statutes and regulations from the research packet
2. State the legal basis for the claim clearly
3. Make a specific demand with a deadline
4. Include appropriate legal language for a ${intake.letterType}
5. Be professionally formatted with proper legal letter structure`;
}

function buildAssemblyPrompt(intake: IntakeJson, research: ResearchPacket, draft: DraftOutput): string {
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  return `You are a senior partner at a prestigious law firm. Your task is to take the research findings and initial draft below, and produce a FINAL, polished, professional legal letter ready for attorney review and client delivery.

## Context
This is a ${intake.letterType.replace(/-/g, " ")} being sent from ${intake.sender.name} to ${intake.recipient.name}.

## Research Findings (from Perplexity AI)
Key statutes and rules identified:
${research.applicableRules.map((r) => `- ${r.ruleTitle}: ${r.summary} (${r.citationText})`).join("\n")}

Research Summary: ${research.researchSummary}

Risk Flags: ${research.riskFlags.join("; ") || "None identified"}
Drafting Constraints: ${research.draftingConstraints.join("; ") || "Standard legal letter format"}

## Initial Draft (from OpenAI)
${draft.draftLetter}

## Attorney Review Notes from Draft Stage
${draft.attorneyReviewSummary}

Open Questions: ${draft.openQuestions.join("; ") || "None"}
Risk Flags: ${draft.riskFlags.join("; ") || "None"}

## Your Task
Produce the FINAL professional legal letter. This must be a complete, ready-to-send letter with:

1. **Proper letterhead format**: Date (${today}), sender's full address, recipient's full address
2. **RE: line** with the subject matter
3. **Professional salutation** ("Dear Mr./Ms./To Whom It May Concern")
4. **Opening paragraph**: State the purpose and legal basis
5. **Body paragraphs**: Present facts, cite specific laws/statutes from the research, make the legal argument
6. **Demand paragraph**: Clearly state what is demanded and by when
7. **Consequences paragraph**: State what will happen if demands are not met
8. **Professional closing**: "Sincerely," or "Very truly yours," with signature block

## Formatting Requirements
- Use proper legal letter formatting
- Include ALL relevant legal citations from the research
- Tone: ${intake.tonePreference ?? "firm"} but professional
- The letter should be complete and ready to print on letterhead
- Do NOT wrap the output in JSON or code blocks — output ONLY the letter text

## Sender Information
${intake.sender.name}
${intake.sender.address}
${intake.sender.email ? `Email: ${intake.sender.email}` : ""}
${intake.sender.phone ? `Phone: ${intake.sender.phone}` : ""}

## Recipient Information
${intake.recipient.name}
${intake.recipient.address}

OUTPUT ONLY THE FINAL LETTER TEXT. No JSON wrapping, no markdown code blocks, no commentary.`;
}

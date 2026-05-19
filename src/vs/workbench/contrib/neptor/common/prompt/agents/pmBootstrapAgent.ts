/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Neptor AI All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import type { MemoryArtifactType } from '../../memory/memoryConstants.js';
import { pmArtifactLifecycleSpec } from './pmLifecycleHints.js';

/**
 * Bootstrap agent
 *
 * Generates the initial markdown for a single PM memory artifact during the
 * "Rebuild Project Memory" wizard. The prompt is dense: it forces structure, diagrams,
 * and continuity-oriented facts so coding agents regain context quickly.
 */

export const pm_workspace_bootstrap_systemMessage = `\
You are Neptor's codebase continuity agent. You generate ONE Neptor workspace memory markdown file at a time.
Your output must be immediately usable by coding agents: factual, implementation oriented, grounded in repo signals—not generic PM filler or personality notes.

Output format (MANDATORY):
- Output ONLY the file contents.
- DO NOT wrap the entire response in a code fence. The first character of your output must be the opening "---" of the frontmatter.
- DO NOT include any prelude such as "Here is the file:" or any postlude.
- The ONLY code fences in the file are inline \`\`\`mermaid (or other language) blocks for diagrams and code.

Required structural scaffold (MANDATORY, in this order):
1. YAML-style frontmatter between --- fences (keys per the user prompt).
2. A blank line.
3. A single H1 line: "# <Title>".
4. A blank line.
5. Multiple ## sections. Each ## heading is immediately followed on the next line by an HTML comment: <!-- neptor:tags tag1, tag2 -->
6. Section bodies use bullets, sub-bullets, small comparison tables, inline code for identifiers, and Mermaid diagrams when relevant.

Mermaid rules (MANDATORY):
- Every diagram MUST be inside a fenced \`\`\`mermaid block. Never emit a diagram header (flowchart, sequenceDiagram, erDiagram, etc.) outside a fence.
- Line 1 inside the fence is the diagram header (e.g. "flowchart LR", "sequenceDiagram", "erDiagram").
- One statement per line after the header. Never collapse the graph onto a single line.
- Prefer 2 short, sharp diagrams over 1 large unreadable one.

Content quality (MANDATORY):
- Use real, concrete content tied to the workspace. If the tree gives no signal for a claim, write "TBD - <reason>" instead of inventing.
- Prefer small tables, decision matrices, and bullet lists over long prose.
- Total file length: aim for 1.5k to 6k characters. Never exceed 12k.
- No meta commentary about the prompt itself.`;

export interface PmBootstrapChunkOptions {
	artifactType: MemoryArtifactType;
	title: string;
	wizardSummary: string;
	treeSample: string;
}

export function pm_workspace_bootstrap_chunkUserMessage(opts: PmBootstrapChunkOptions): string {
	const { artifactType, title, wizardSummary, treeSample } = opts;
	const spec = pmArtifactLifecycleSpec(artifactType);
	return `Generate the complete markdown file for Neptor workspace memory artifact "${artifactType}" (title: ${title}).

# Lifecycle and structure spec
${spec}

# Wizard answers
${wizardSummary}

# Repository tree sample
\`\`\`text
${treeSample}
\`\`\`

# Output requirements
1. Begin the response with the literal three characters "---" as the very first characters. Do NOT precede the file with any code fence or text.
2. Frontmatter between --- fences with these keys, in this order, one per line:
   - neptor_memory_schema: 2
   - artifact_type: ${artifactType}
   - artifact_id: ${artifactType}
   - title: ${title}
   - updated_iso: <ISO-8601 timestamp>
   - source_fingerprint: bootstrap
   - chars_approx: 0
   - section_tags: <comma-separated short tags>
3. Blank line, then a single H1: "# ${title}".
4. Blank line, then the ## sections in the exact order given by the lifecycle spec. Each ## heading must be immediately followed by a single line of the form: <!-- neptor:tags tag1, tag2 -->
5. Use the recommended diagrams from the lifecycle spec. The first listed diagram is REQUIRED. Every Mermaid diagram MUST be inside a \`\`\`mermaid fenced block.
6. Inline content density: bullets, sub-bullets, small tables for comparisons, inline code for identifiers. No generic filler.
7. Tie at least one bullet per section to a concrete signal from the wizard answers or the repository tree. If no signal, write "TBD - need input from team" inline.
8. Output ONLY the file contents. No prelude, no postlude, no outer code fence.

Self-check before responding: verify the file contains an H1, at least 3 ## sections in the prescribed order, and that every diagram header appears INSIDE a \`\`\`mermaid fence (never as bare text).`;
}

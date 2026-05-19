/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Neptor AI All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import type { MemoryArtifactType } from '../../memory/memoryConstants.js';
import { diagramRequirementsMarkdown } from './sdlcDiagramCatalog.js';

/**
 * Diagram repair agent
 *
 * Used as a single-shot LLM repair pass when a generated artifact contains
 * one or more invalid Mermaid blocks. The agent receives the full markdown
 * and must return the full markdown back, with valid Mermaid.
 */

export interface PmDiagramRepairOptions {
	artifactType: MemoryArtifactType;
	issues: string[];
	currentMarkdown: string;
}

export function pmDiagramRepair_userMessage(opts: PmDiagramRepairOptions): string {
	const { artifactType, issues, currentMarkdown } = opts;
	const requirements = diagramRequirementsMarkdown(artifactType);
	return `You are repairing Mermaid blocks inside a Neptor PM memory markdown artifact.
Output ONLY the full corrected markdown file. Keep the frontmatter and section structure intact.

Artifact type: ${artifactType}

Validation issues to fix:
- ${issues.join('\n- ')}

Diagram requirements for this artifact:
${requirements}

Hard rules:
- Mermaid blocks must be fenced with \`\`\`mermaid.
- The first line of each block must be a valid diagram header (flowchart LR, sequenceDiagram, erDiagram, classDiagram, stateDiagram-v2, gantt, journey, timeline, classDiagram).
- Use ONE statement per line after the header. Never collapse the whole graph onto one line.
- Preserve all non-diagram content unless changes are required to keep diagrams meaningful.
- If a required diagram is missing, ADD it in an appropriate ## section using the patterns above.

Current markdown:
\`\`\`markdown
${currentMarkdown}
\`\`\``;
}

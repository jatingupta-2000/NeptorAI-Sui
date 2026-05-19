/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Neptor AI All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import type { MemoryArtifactType } from '../../memory/memoryConstants.js';

/**
 * SDLC diagram catalog
 *
 * One source of truth for the diagram taxonomy used across PM memory
 * generation. Each diagram entry maps to a concrete Mermaid header so the
 * downstream LLM produces something that the renderer can actually display.
 *
 * Categories follow the standard product engineering lifecycle:
 *   1. Logic & Flow     (flowchart, workflow, activity, decision tree)
 *   2. System Design    (architecture, component, deployment, microservices)
 *   3. Data & Database  (ER, DB schema, DFD)
 *   4. Behavior & UML   (use case, sequence, state, communication)
 *   5. UI / UX          (wireframe sketch, user flow, journey)
 *   6. DevOps           (CI/CD, infrastructure, network)
 *   7. Specialized      (class, timing, block)
 */

export type SdlcCategory =
	| 'logic_flow'
	| 'system_design'
	| 'data'
	| 'behavior'
	| 'ui_ux'
	| 'devops'
	| 'specialized';

export interface SdlcDiagramSpec {
	id: string;
	displayName: string;
	category: SdlcCategory;
	mermaidHeader: string;
	purpose: string;
	skeleton: string;
}

export const SDLC_DIAGRAMS: Readonly<Record<string, SdlcDiagramSpec>> = Object.freeze({
	flowchart: {
		id: 'flowchart',
		displayName: 'Flowchart',
		category: 'logic_flow',
		mermaidHeader: 'flowchart LR',
		purpose: 'Step-by-step process or business flow.',
		skeleton: 'flowchart LR\n  Start([Start]) --> Step1[Action]\n  Step1 --> Decision{Branch?}\n  Decision -->|yes| Step2[Continue]\n  Decision -->|no| End([End])',
	},
	workflow: {
		id: 'workflow',
		displayName: 'Workflow Diagram',
		category: 'logic_flow',
		mermaidHeader: 'flowchart TB',
		purpose: 'Cross-team or cross-system business workflow with swimlanes via subgraphs.',
		skeleton: 'flowchart TB\n  subgraph User\n    U1[Submit request]\n  end\n  subgraph System\n    S1[Validate]\n    S2[Persist]\n  end\n  U1 --> S1 --> S2',
	},
	activity_diagram: {
		id: 'activity_diagram',
		displayName: 'Activity Diagram',
		category: 'logic_flow',
		mermaidHeader: 'flowchart TB',
		purpose: 'UML activity flow with parallel branches and decision nodes.',
		skeleton: 'flowchart TB\n  A([Start]) --> B[Action]\n  B --> D{Choice}\n  D -->|A| E[Branch A]\n  D -->|B| F[Branch B]\n  E --> G([End])\n  F --> G',
	},
	decision_tree: {
		id: 'decision_tree',
		displayName: 'Decision Tree',
		category: 'logic_flow',
		mermaidHeader: 'flowchart TB',
		purpose: 'Branching if/else logic for product or technical decisions.',
		skeleton: 'flowchart TB\n  Q1{Has trait?}\n  Q1 -->|yes| Q2{Variant?}\n  Q1 -->|no| Out1[Outcome A]\n  Q2 -->|x| Out2[Outcome B]\n  Q2 -->|y| Out3[Outcome C]',
	},
	system_architecture: {
		id: 'system_architecture',
		displayName: 'System Architecture',
		category: 'system_design',
		mermaidHeader: 'flowchart LR',
		purpose: 'High-level layout of clients, services, and data stores.',
		skeleton: 'flowchart LR\n  subgraph Clients\n    Web[Web]\n    Mob[Mobile]\n  end\n  subgraph API[API Gateway]\n    GW[Gateway]\n  end\n  subgraph Services\n    Auth[Auth]\n    Core[Core]\n  end\n  subgraph Data\n    DB[(Postgres)]\n    Cache[(Redis)]\n  end\n  Web --> GW\n  Mob --> GW\n  GW --> Auth\n  GW --> Core\n  Auth --> DB\n  Core --> DB\n  Core --> Cache',
	},
	component_diagram: {
		id: 'component_diagram',
		displayName: 'Component Diagram',
		category: 'system_design',
		mermaidHeader: 'flowchart TB',
		purpose: 'Internal modules and their relationships inside a service.',
		skeleton: 'flowchart TB\n  Controller --> Service\n  Service --> Repository\n  Repository --> DB[(Database)]\n  Service --> EventBus[(Bus)]',
	},
	deployment_diagram: {
		id: 'deployment_diagram',
		displayName: 'Deployment Diagram',
		category: 'system_design',
		mermaidHeader: 'flowchart LR',
		purpose: 'Where each component runs (regions, clusters, queues).',
		skeleton: 'flowchart LR\n  subgraph EdgeCDN\n    CDN[CDN]\n  end\n  subgraph K8s_us-east\n    Web[(web pods)]\n    API[(api pods)]\n  end\n  subgraph Managed\n    DB[(Postgres)]\n  end\n  CDN --> Web --> API --> DB',
	},
	microservices: {
		id: 'microservices',
		displayName: 'Microservices Diagram',
		category: 'system_design',
		mermaidHeader: 'flowchart LR',
		purpose: 'Service-to-service topology with sync and async edges.',
		skeleton: 'flowchart LR\n  Client --> Gateway\n  Gateway --> Orders\n  Gateway --> Catalog\n  Orders --> Payments\n  Orders -. publishes .-> Bus[(Event Bus)]\n  Bus -. subscribes .-> Notifications',
	},
	er_diagram: {
		id: 'er_diagram',
		displayName: 'ER Diagram',
		category: 'data',
		mermaidHeader: 'erDiagram',
		purpose: 'Entities, attributes, and relationships in the data model.',
		skeleton: 'erDiagram\n  USER ||--o{ ORDER : places\n  ORDER ||--|{ ORDER_ITEM : contains\n  PRODUCT ||--o{ ORDER_ITEM : appears_in\n  USER {\n    string id PK\n    string email\n    string name\n  }',
	},
	db_schema: {
		id: 'db_schema',
		displayName: 'Database Schema',
		category: 'data',
		mermaidHeader: 'classDiagram',
		purpose: 'Concrete table-level shape, types, and indexes.',
		skeleton: 'classDiagram\n  class users {\n    +uuid id\n    +text email\n    +timestamptz created_at\n  }\n  class orders {\n    +uuid id\n    +uuid user_id\n    +numeric total\n  }\n  users <|-- orders : has many',
	},
	dfd: {
		id: 'dfd',
		displayName: 'Data Flow Diagram',
		category: 'data',
		mermaidHeader: 'flowchart LR',
		purpose: 'How data moves between processes, stores, and external entities.',
		skeleton: 'flowchart LR\n  User((User)) -->|input| Process[Process Request]\n  Process --> Store[(Store)]\n  Store --> Process2[Aggregate]\n  Process2 -->|response| User',
	},
	use_case: {
		id: 'use_case',
		displayName: 'Use Case Diagram',
		category: 'behavior',
		mermaidHeader: 'flowchart LR',
		purpose: 'Actors and the use cases they trigger.',
		skeleton: 'flowchart LR\n  Customer((Customer)) --> UC1((Browse catalog))\n  Customer --> UC2((Place order))\n  Admin((Admin)) --> UC3((Manage inventory))',
	},
	sequence_diagram: {
		id: 'sequence_diagram',
		displayName: 'Sequence Diagram',
		category: 'behavior',
		mermaidHeader: 'sequenceDiagram',
		purpose: 'Step-by-step interaction over time between actors and services.',
		skeleton: 'sequenceDiagram\n  autonumber\n  actor U as User\n  participant W as Web\n  participant A as API\n  participant D as DB\n  U->>W: Submit form\n  W->>A: POST /resource\n  A->>D: insert row\n  D-->>A: ok\n  A-->>W: 201 Created\n  W-->>U: confirmation',
	},
	state_diagram: {
		id: 'state_diagram',
		displayName: 'State Diagram',
		category: 'behavior',
		mermaidHeader: 'stateDiagram-v2',
		purpose: 'Object or system states and transitions.',
		skeleton: 'stateDiagram-v2\n  [*] --> Draft\n  Draft --> InReview: submit\n  InReview --> Approved: approve\n  InReview --> Draft: request_changes\n  Approved --> [*]',
	},
	user_flow: {
		id: 'user_flow',
		displayName: 'User Flow',
		category: 'ui_ux',
		mermaidHeader: 'flowchart LR',
		purpose: 'User journey across screens and decision points.',
		skeleton: 'flowchart LR\n  Landing --> Signup\n  Signup --> Onboarding\n  Onboarding --> Dashboard\n  Dashboard --> FeatureA\n  Dashboard --> FeatureB',
	},
	user_journey: {
		id: 'user_journey',
		displayName: 'User Journey',
		category: 'ui_ux',
		mermaidHeader: 'journey',
		purpose: 'Persona journey with satisfaction scores.',
		skeleton: 'journey\n  title Onboarding journey\n  section Discover\n    Land on site: 4: User\n    Read pricing: 3: User\n  section Activate\n    Sign up: 4: User\n    Complete tutorial: 3: User',
	},
	wireframe_sketch: {
		id: 'wireframe_sketch',
		displayName: 'Wireframe Sketch',
		category: 'ui_ux',
		mermaidHeader: 'flowchart TB',
		purpose: 'Lo-fi screen layout boxes and links.',
		skeleton: 'flowchart TB\n  subgraph Screen[Dashboard]\n    Header[Header bar]\n    Side[Sidebar nav]\n    Main[Main content]\n    CTA[Primary CTA]\n  end\n  Header --- Side\n  Side --- Main\n  Main --- CTA',
	},
	ci_cd_pipeline: {
		id: 'ci_cd_pipeline',
		displayName: 'CI/CD Pipeline',
		category: 'devops',
		mermaidHeader: 'flowchart LR',
		purpose: 'Build, test, deploy stages with gates.',
		skeleton: 'flowchart LR\n  PR[Pull request] --> Build[Build]\n  Build --> Test[Unit + e2e]\n  Test --> Stage[Deploy staging]\n  Stage --> Approve{Approve?}\n  Approve -->|yes| Prod[Deploy prod]\n  Approve -->|no| Reject[Hold]',
	},
	infrastructure: {
		id: 'infrastructure',
		displayName: 'Infrastructure Diagram',
		category: 'devops',
		mermaidHeader: 'flowchart LR',
		purpose: 'Cloud resources, regions, networks.',
		skeleton: 'flowchart LR\n  subgraph AWS[AWS us-east-1]\n    VPC[VPC]\n    ECS[ECS cluster]\n    RDS[(RDS Postgres)]\n    S3[(S3)]\n  end\n  Internet[(Internet)] --> ALB[Load balancer]\n  ALB --> ECS\n  ECS --> RDS\n  ECS --> S3',
	},
	network: {
		id: 'network',
		displayName: 'Network Diagram',
		category: 'devops',
		mermaidHeader: 'flowchart LR',
		purpose: 'Edges, firewalls, subnets, and traffic boundaries.',
		skeleton: 'flowchart LR\n  Public[(Public Internet)] --> WAF[WAF]\n  WAF --> Edge[Edge LB]\n  Edge --> PrivateSubnet[Private subnet]\n  PrivateSubnet --> Services[(Services)]\n  Services --> DBSubnet[(DB subnet)]',
	},
	class_diagram: {
		id: 'class_diagram',
		displayName: 'Class Diagram',
		category: 'specialized',
		mermaidHeader: 'classDiagram',
		purpose: 'Object-oriented class structure and relationships.',
		skeleton: 'classDiagram\n  class Order {\n    +id: UUID\n    +total: number\n    +place()\n    +cancel()\n  }\n  class OrderItem {\n    +sku: string\n    +qty: number\n  }\n  Order "1" --> "*" OrderItem',
	},
	gantt: {
		id: 'gantt',
		displayName: 'Gantt Roadmap',
		category: 'specialized',
		mermaidHeader: 'gantt',
		purpose: 'Timed milestones across phases.',
		skeleton: 'gantt\n  dateFormat  YYYY-MM-DD\n  title Roadmap\n  section Foundations\n  Schema & infra        :a1, 2025-01-06, 14d\n  section Beta\n  Closed beta           :a2, after a1, 21d\n  section Launch\n  Public launch         :a3, after a2, 7d',
	},
	timeline: {
		id: 'timeline',
		displayName: 'Timeline',
		category: 'specialized',
		mermaidHeader: 'timeline',
		purpose: 'Narrative timeline of milestones.',
		skeleton: 'timeline\n  title Product timeline\n  Q1 : Discovery : First customer interviews\n  Q2 : Beta : Closed beta with 10 design partners\n  Q3 : Launch : Public launch + pricing live',
	},
	block_diagram: {
		id: 'block_diagram',
		displayName: 'Block Diagram',
		category: 'specialized',
		mermaidHeader: 'flowchart TB',
		purpose: 'High-level block-level system view.',
		skeleton: 'flowchart TB\n  Input[Input layer] --> Core[Core engine]\n  Core --> Storage[Storage layer]\n  Core --> Output[Output layer]',
	},
});

/**
 * Recommended diagrams per memory artifact, in priority order.
 * The first item is required when the artifact is in ARTIFACTS_REQUIRING_MERMAID;
 * additional items are strongly suggested to make the artifact look "real".
 */
export const ARTIFACT_DIAGRAMS: Readonly<Record<MemoryArtifactType, ReadonlyArray<keyof typeof SDLC_DIAGRAMS>>> = Object.freeze({
	architecture: ['system_architecture', 'component_diagram', 'deployment_diagram'],
	overview: ['workflow', 'flowchart'],
	tech_stack: ['system_architecture', 'infrastructure'],
	code_style: ['workflow'],
	tasks: ['flowchart', 'timeline'],
	apis: ['sequence_diagram', 'component_diagram'],
	file_graph: ['component_diagram', 'system_architecture', 'workflow'],
	fixes: ['decision_tree', 'flowchart'],
	workflow: ['workflow'],
	decisions: ['decision_tree', 'timeline'],
	domain: ['er_diagram', 'class_diagram'],
	flows: ['flowchart', 'activity_diagram', 'sequence_diagram'],
	vision: ['flowchart', 'timeline'],
	roadmap: ['gantt', 'timeline'],
	user_journeys: ['user_flow', 'user_journey'],
	docs_index: ['workflow'],
});

export function diagramSpec(id: keyof typeof SDLC_DIAGRAMS): SdlcDiagramSpec {
	return SDLC_DIAGRAMS[id];
}

export function diagramsForArtifact(type: MemoryArtifactType): SdlcDiagramSpec[] {
	const ids = ARTIFACT_DIAGRAMS[type] ?? [];
	return ids.map(id => SDLC_DIAGRAMS[id]).filter((s): s is SdlcDiagramSpec => Boolean(s));
}

/** Markdown bullet list of recommended diagrams for a given artifact type. */
export function diagramRequirementsMarkdown(type: MemoryArtifactType): string {
	const list = diagramsForArtifact(type);
	if (list.length === 0) {
		return 'No mandatory diagrams for this artifact.';
	}
	return list
		.map((d, i) => {
			const tag = i === 0 ? '(required)' : '(recommended)';
			return `- **${d.displayName}** ${tag}: ${d.purpose}\n  - First line: \`${d.mermaidHeader}\`\n  - Pattern:\n\`\`\`mermaid\n${d.skeleton}\n\`\`\``;
		})
		.join('\n');
}

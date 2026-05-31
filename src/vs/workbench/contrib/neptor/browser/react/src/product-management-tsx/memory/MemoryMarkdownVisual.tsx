/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Neptor AI All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, memo } from 'react';
import { marked } from 'marked';
import type { Token, Tokens } from 'marked';
import mermaid from 'mermaid';
import { createTrustedTypesPolicy } from '../../../../../../../base/browser/trustedTypes.js';

marked.use({ gfm: true, breaks: false });

type MarkdownRenderMode = 'article' | 'briefing';

/** Detect diagram source when LLM omits ```mermaid fence lang */
const MERMAID_START = /^(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram-v2|stateDiagram|erDiagram|gantt|pie|journey|gitGraph|block-beta|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment|mindmap|timeline|sankey-beta|quadrantChart|requirementDiagram)/m;

function codeLooksLikeMermaid(lang: string, code: string): boolean {
	const L = lang.trim().toLowerCase();
	if (L === 'mermaid' || L === 'mmd') {
		return true;
	}
	if (L !== '') {
		return false;
	}
	return MERMAID_START.test(code.trimStart());
}

const V = {
	text: '#EDEDED',
	textBody: 'rgba(237, 237, 237, 0.85)',
	muted: '#98989D',
	faint: '#636366',
	codeBg: '#0d0d0e',
	surface2: '#161618',
	inlineCodeBg: '#161618',
	border: '#2E2E2E',
	borderSoft: 'rgba(46,46,46,0.55)',
	link: '#5AC8FA',
	primary: '#FF3B30',
	accentAmber: '#FF9500',
} as const;

const FONT_BODY = '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
const FONT_MONO = '"JetBrains Mono", var(--monaco-monospace-font, "SF Mono", "Menlo", "Cascadia Code", ui-monospace, monospace)';

let mermaidReady = false;
let mermaidTrustedTypesPolicyReady = false;

/**
 * Mermaid uses element.innerHTML internally (style rules, svg mount).
 * The workbench CSP enforces `require-trusted-types-for 'script'` with a
 * fixed allowlist; `default` and `mermaid` are added to that allowlist
 * (workbench.html + workbench-dev.html) so creating a passthrough default
 * policy here lets every implicit string -> TrustedHTML conversion succeed.
 */
function ensureMermaidTrustedTypesPolicy(): void {
	if (mermaidTrustedTypesPolicyReady) {
		return;
	}
	mermaidTrustedTypesPolicyReady = true;
	const passthrough = {
		createHTML: (value: string) => value,
		createScript: (value: string) => value,
		createScriptURL: (value: string) => value,
	};
	try {
		createTrustedTypesPolicy('default', passthrough);
	} catch {
		// Already created by another caller; safe to ignore.
	}
	try {
		createTrustedTypesPolicy('mermaid', passthrough);
	} catch {
		// Already created; safe to ignore.
	}
}

ensureMermaidTrustedTypesPolicy();

function ensureMermaid(): void {
	if (mermaidReady) {
		return;
	}
	mermaid.initialize({
		startOnLoad: false,
		theme: 'dark',
		securityLevel: 'loose',
		fontFamily: FONT_BODY,
		flowchart: { htmlLabels: true, useMaxWidth: true, curve: 'basis' },
		sequence: { useMaxWidth: true, mirrorActors: false, showSequenceNumbers: false },
		er: { useMaxWidth: true },
		gantt: { useMaxWidth: true },
		journey: { useMaxWidth: true },
	});
	mermaidReady = true;
}

/** Mermaid often rejects flowchart/graph when direction and first edge share one line. */
function normalizeMermaidSource(src: string): string {
	let s = src.trim().replace(/\n$/, '');
	const noNewline = !s.includes('\n');
	if (noNewline) {
		const m = s.match(/^(flowchart|graph)\s+(TD|TB|BT|RL|LR)\s+/i);
		if (m) {
			const rest = s.replace(/^(flowchart|graph)\s+(TD|TB|BT|RL|LR)\s+/i, '');
			let body = rest;
			body = body.replace(/\s+subgraph\s+/gi, '\nsubgraph ');
			body = body.replace(/\s+end(?=\s+subgraph|\s+[A-Za-z_][\w-]*\s*\[|\s+[A-Za-z_][\w-]*\s*-\-?>|\s*$)/gi, '\nend');
			body = body.replace(/\s*;\s*/g, '\n');
			body = body.replace(/\s+(?=[A-Za-z_][\w-]*\s*(?:-->|---|==>|-.->|<--)\s*[A-Za-z_][\w-]*)/g, '\n');
			body = body.replace(/\n{2,}/g, '\n');
			s = `${m[1]} ${m[2]}\n${body.trim()}`;
		}
	}
	return s;
}

function mermaidErrorMessage(err: unknown): string {
	if (err instanceof Error && err.message) {
		const line = err.message.split('\n')[0]?.trim() ?? err.message;
		return line.length > 220 ? `${line.slice(0, 217)}…` : line;
	}
	return String(err).slice(0, 220);
}

/** Avoid Trusted Types innerHTML errors by mounting parsed SVG nodes. */
function mountSvgWithoutInnerHTML(container: HTMLDivElement, svg: string): void {
	container.replaceChildren();
	const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
	const root = doc.documentElement;
	if (root && root.nodeName.toLowerCase() === 'svg') {
		const node = container.ownerDocument.importNode(root, true) as SVGElement;
		node.setAttribute('width', '100%');
		node.removeAttribute('height');
		node.style.maxWidth = '100%';
		node.style.height = 'auto';
		node.style.display = 'block';
		container.appendChild(node);
		return;
	}
	const pre = container.ownerDocument.createElement('pre');
	pre.style.whiteSpace = 'pre-wrap';
	pre.style.margin = '0';
	pre.style.fontSize = '11px';
	pre.textContent = svg;
	container.appendChild(pre);
}

function fitMermaidDiagramToViewport(viewportEl: HTMLElement, scaleWrapEl: HTMLElement, svgMountEl: HTMLElement): void {
	scaleWrapEl.style.transform = '';
	scaleWrapEl.style.height = '';
	scaleWrapEl.style.overflow = '';
	scaleWrapEl.style.minHeight = '';

	const svg = svgMountEl.querySelector('svg');
	if (!svg) {
		return;
	}

	svg.style.width = '100%';
	svg.style.maxWidth = '100%';
	svg.style.height = 'auto';

	const vw = viewportEl.clientWidth;
	const vh = viewportEl.clientHeight;
	if (vw <= 14 || vh <= 14) {
		return;
	}

	const rect = svg.getBoundingClientRect();
	let w = rect.width || svg.clientWidth;
	let h = rect.height || svg.clientHeight;
	const scrollH = Math.max(svgMountEl.scrollHeight, svg.scrollHeight);
	h = Math.max(h, scrollH);
	try {
		const bb = svg.getBBox();
		if (Number.isFinite(bb.width) && Number.isFinite(bb.height) && bb.width > 0 && bb.height > 0) {
			const ctm = svg.getScreenCTM();
			if (ctm) {
				const bottom = svg.createSVGPoint();
				bottom.x = bb.x + bb.width * 0.5;
				bottom.y = bb.y + bb.height;
				const top = svg.createSVGPoint();
				top.x = bb.x + bb.width * 0.5;
				top.y = bb.y;
				const bScr = bottom.matrixTransform(ctm);
				const tScr = top.matrixTransform(ctm);
				const bboxHpx = Math.abs(bScr.y - tScr.y);
				const left = svg.createSVGPoint();
				left.x = bb.x;
				left.y = bb.y + bb.height * 0.5;
				const right = svg.createSVGPoint();
				right.x = bb.x + bb.width;
				right.y = bb.y + bb.height * 0.5;
				const lScr = left.matrixTransform(ctm);
				const rScr = right.matrixTransform(ctm);
				const bboxWpx = Math.abs(rScr.x - lScr.x);
				h = Math.max(h, bboxHpx);
				w = Math.max(w, bboxWpx);
			}
		}
	} catch {
		// ignore bbox errors on partiallyAttached svg
	}

	if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 12 || h <= 12) {
		return;
	}

	const pad = 12;
	const bottomFudgePx = 36;
	const s = Math.min(1, (vw - pad) / w, (vh - pad) / h);
	if (!Number.isFinite(s) || s >= 0.997) {
		return;
	}

	const scaledDrawHeight = h * s;
	const boxHeightPx = Math.ceil(scaledDrawHeight + bottomFudgePx);

	scaleWrapEl.style.transformOrigin = 'top center';
	scaleWrapEl.style.transform = `scale(${s})`;
	scaleWrapEl.style.overflow = 'visible';
	scaleWrapEl.style.minHeight = `${Math.max(40, boxHeightPx)}px`;
}

async function copyTextSafely(text: string): Promise<boolean> {
	try {
		if (navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(text);
			return true;
		}
	} catch {
		// fall through to legacy fallback
	}
	try {
		const ta = document.createElement('textarea');
		ta.value = text;
		ta.style.position = 'fixed';
		ta.style.opacity = '0';
		document.body.appendChild(ta);
		ta.select();
		const ok = document.execCommand('copy');
		ta.remove();
		return ok;
	} catch {
		return false;
	}
}

const CopyButton = ({ getText, label = 'Copy', size = 'sm' }: { getText: () => string; label?: string; size?: 'sm' | 'md' }) => {
	const [state, setState] = useState<'idle' | 'ok' | 'err'>('idle');
	useEffect(() => {
		if (state === 'idle') { return; }
		const t = window.setTimeout(() => setState('idle'), 1200);
		return () => window.clearTimeout(t);
	}, [state]);
	const onClick = async () => {
		const ok = await copyTextSafely(getText());
		setState(ok ? 'ok' : 'err');
	};
	const text = state === 'ok' ? 'Copied' : state === 'err' ? 'Failed' : label;
	const isSm = size === 'sm';
	return (
		<button
			type="button"
			onClick={onClick}
			className="neptor-pm-md__copy-btn"
			style={{
				appearance: 'none',
				border: `1px solid ${V.border}`,
				background: V.surface2,
				color: state === 'ok' ? '#30D158' : state === 'err' ? '#FF453A' : V.text,
				borderRadius: '999px',
				padding: isSm ? '5px 12px' : '6px 14px',
				fontSize: isSm ? '12px' : '13px',
				fontFamily: FONT_MONO,
				fontWeight: 600,
				letterSpacing: '0.02em',
				cursor: 'pointer',
				lineHeight: 1.2,
				userSelect: 'none',
			}}
		>
			{text}
		</button>
	);
};

function mermaidBriefingChip(diagram: string): { chip: string; preview: string } {
	const first = diagram.trimStart().split('\n')[0] ?? '';
	const d = diagram.trimStart();
	if (/^sequenceDiagram\b/im.test(d)) {
		return { chip: 'Flow', preview: first };
	}
	if (/^(flowchart|graph)\b/im.test(d)) {
		return { chip: 'Map', preview: first };
	}
	if (/^(classDiagram|erDiagram|stateDiagram|stateDiagram-v2)\b/im.test(d)) {
		return { chip: 'Structure', preview: first };
	}
	if (/^gantt\b/im.test(d)) {
		return { chip: 'Timeline', preview: first };
	}
	return { chip: 'Sketch', preview: first };
}

const MermaidBlock = ({ code, deferRender }: { code: string; deferRender?: boolean }) => {
	const rootRef = useRef<HTMLDivElement>(null);
	const viewportRef = useRef<HTMLDivElement>(null);
	const scaleWrapRef = useRef<HTMLDivElement>(null);
	const ref = useRef<HTMLDivElement>(null);
	const modalRef = useRef<HTMLDivElement>(null);
	const renderIdRef = useRef(`neptor-mmd-${Math.random().toString(36).slice(2, 11)}`);
	const [errorText, setErrorText] = useState<string | null>(null);
	const [isExpanded, setIsExpanded] = useState(false);
	const [modalZoom, setModalZoom] = useState(1);
	const [viewportReady, setViewportReady] = useState(!deferRender);
	const [diagramFitEpoch, setDiagramFitEpoch] = useState(0);
	const diagram = useMemo(() => normalizeMermaidSource(code.trim().replace(/\n$/, '')), [code]);
	const { chip, preview } = useMemo(() => mermaidBriefingChip(diagram), [diagram]);

	useEffect(() => {
		if (!deferRender) {
			return;
		}
		const el = rootRef.current;
		if (!el) {
			return;
		}
		const io = new IntersectionObserver(([e]) => {
			if (e.isIntersecting) {
				setViewportReady(true);
				io.disconnect();
			}
		}, { threshold: 0.02, rootMargin: '120px' });
		io.observe(el);
		return () => io.disconnect();
	}, [deferRender]);

	useEffect(() => {
		if (!viewportReady) {
			return;
		}
		let cancelled = false;
		ensureMermaidTrustedTypesPolicy();
		ensureMermaid();
		const id = renderIdRef.current;
		const tryRender = async (): Promise<void> => {
			try {
				const { svg, bindFunctions } = await mermaid.render(id, diagram);
				if (!cancelled && ref.current) {
					mountSvgWithoutInnerHTML(ref.current, svg);
					bindFunctions?.(ref.current);
					setErrorText(null);
					setDiagramFitEpoch((n) => n + 1);
				}
			} catch (e1) {
				if (diagram !== code) {
					try {
						const { svg, bindFunctions } = await mermaid.render(`${id}-r2`, code);
						if (!cancelled && ref.current) {
							mountSvgWithoutInnerHTML(ref.current, svg);
							bindFunctions?.(ref.current);
							setErrorText(null);
							setDiagramFitEpoch((n) => n + 1);
							return;
						}
					} catch {
						// fall through to error
					}
				}
				if (!cancelled) {
					setErrorText(mermaidErrorMessage(e1));
					if (ref.current) {
						ref.current.replaceChildren();
					}
				}
			}
		};
		void tryRender();
		return () => { cancelled = true; };
	}, [code, diagram, viewportReady]);

	useEffect(() => {
		if (!isExpanded) {
			return;
		}
		const onKeyDown = (ev: KeyboardEvent) => {
			if (ev.key === 'Escape') {
				setIsExpanded(false);
			}
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [isExpanded]);

	useEffect(() => {
		if (!isExpanded || !modalRef.current || errorText) {
			return;
		}
		modalRef.current.replaceChildren();
		const currentSvg = ref.current?.querySelector('svg');
		if (currentSvg) {
			const cloned = currentSvg.cloneNode(true) as SVGElement;
			cloned.style.width = `${Math.round(modalZoom * 100)}%`;
			cloned.style.maxWidth = 'none';
			cloned.style.height = 'auto';
			cloned.style.display = 'block';
			modalRef.current.appendChild(cloned);
		}
	}, [isExpanded, errorText, modalZoom]);

	useLayoutEffect(() => {
		const clearDiagramScale = (): void => {
			const sw = scaleWrapRef.current;
			if (sw) {
				sw.style.transform = '';
				sw.style.height = '';
				sw.style.overflow = '';
				sw.style.minHeight = '';
			}
		};

		if (!viewportReady || errorText || typeof window === 'undefined') {
			clearDiagramScale();
			return;
		}
		const viewport = viewportRef.current;
		const svgMount = ref.current;
		if (!viewport || !svgMount?.querySelector('svg')) {
			return;
		}

		let raf1 = 0;
		let raf2 = 0;
		const scheduleFit = (): void => {
			cancelAnimationFrame(raf1);
			cancelAnimationFrame(raf2);
			raf1 = requestAnimationFrame(() => {
				raf2 = requestAnimationFrame(() => {
					const vp = viewportRef.current;
					const sw = scaleWrapRef.current;
					const mount = ref.current;
					if (vp && sw && mount?.querySelector('svg')) {
						fitMermaidDiagramToViewport(vp, sw, mount);
					}
				});
			});
		};

		scheduleFit();
		const ro = new ResizeObserver(scheduleFit);
		ro.observe(viewport);
		window.addEventListener('resize', scheduleFit);
		return () => {
			ro.disconnect();
			window.removeEventListener('resize', scheduleFit);
			cancelAnimationFrame(raf1);
			cancelAnimationFrame(raf2);
		};
	}, [diagramFitEpoch, viewportReady, errorText]);

	return (
		<div ref={rootRef} style={{ width: '100%', minWidth: 0 }}>
		<figure
			className="neptor-pm-md__mermaid"
			style={{
				margin: '14px 0',
				borderRadius: '12px',
				border: `1px solid ${V.border}`,
				background: 'linear-gradient(180deg, #0d0d0f 0%, #0a0a0b 100%)',
				overflow: 'visible',
			}}
		>
			<header
				style={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'space-between',
					padding: '8px 12px',
					borderBottom: `1px solid ${V.borderSoft}`,
					background: 'rgba(255,255,255,0.02)',
					gap: '8px',
				}}
			>
				<div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
					<span
						style={{
							display: 'inline-block',
							width: '6px',
							height: '6px',
							borderRadius: '999px',
							background: errorText ? '#FF453A' : '#30D158',
						}}
						aria-hidden
					/>
					<span style={{ fontSize: '10.5px', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, color: V.muted }}>
						{chip}
					</span>
					<span style={{ fontSize: '11px', color: V.faint, fontFamily: FONT_MONO, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
						{preview}
					</span>
				</div>
				<div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
					<button
						type="button"
						onClick={() => setIsExpanded(true)}
						style={{
							border: `1px solid ${V.border}`,
							background: 'rgba(255,255,255,0.04)',
							color: V.text,
							borderRadius: '6px',
							padding: '3px 8px',
							fontSize: '10.5px',
							fontWeight: 600,
							cursor: 'pointer',
							lineHeight: 1.2,
						}}
					>
						Expand
					</button>
					<CopyButton getText={() => diagram} label="Copy source" />
				</div>
			</header>
			<div
				ref={viewportRef}
				className="neptor-pm-md__mermaid-viewport"
				style={{
					padding: '12px 14px 20px',
					maxHeight: 'min(74vh, 820px)',
					overflow: 'auto',
					background: '#0a0a0b',
				}}
			>
				{!viewportReady ? (
					<div
						style={{
							padding: '32px',
							minHeight: '120px',
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							color: V.muted,
							fontSize: '12px',
						}}
					>
						Visual loads as you scroll…
					</div>
				) : errorText ? (
					<div style={{ display: 'grid', gap: '8px' }}>
						<div style={{ color: '#FF6E6A', fontSize: '12px', fontWeight: 600 }}>
							Mermaid parse error: {errorText}
						</div>
						<pre
							style={{
								margin: 0,
								padding: '10px 12px',
								borderRadius: '8px',
								background: V.codeBg,
								border: `1px solid ${V.border}`,
								fontFamily: FONT_MONO,
								fontSize: '11.5px',
								lineHeight: 1.55,
								color: '#cfd0d4',
								whiteSpace: 'pre-wrap',
								wordBreak: 'break-word',
								overflowWrap: 'anywhere',
							}}
						>
							<code>{diagram}</code>
						</pre>
					</div>
				) : (
					<div
						ref={scaleWrapRef}
						style={{ width: '100%', display: 'flex', justifyContent: 'center', lineHeight: 0 }}
					>
						<div ref={ref} style={{ width: '100%', maxWidth: '100%', minWidth: 0, flexShrink: 1 }} />
					</div>
				)}
			</div>
			{isExpanded ? (
				<div
					role="dialog"
					aria-modal="true"
					onClick={() => setIsExpanded(false)}
					style={{
						position: 'fixed',
						inset: 0,
						background: 'rgba(0,0,0,0.72)',
						zIndex: 2000,
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						padding: '20px',
					}}
				>
					<div
						onClick={(e) => e.stopPropagation()}
						style={{
							width: 'min(1200px, 96vw)',
							height: 'min(88vh, 900px)',
							borderRadius: '12px',
							border: `1px solid ${V.border}`,
							background: '#0a0a0b',
							display: 'flex',
							flexDirection: 'column',
							overflow: 'hidden',
							boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
						}}
					>
						<div
							style={{
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'space-between',
								padding: '10px 14px',
								borderBottom: `1px solid ${V.borderSoft}`,
								background: 'rgba(255,255,255,0.02)',
							}}
						>
							<div style={{ fontSize: '12px', color: V.text, fontWeight: 600 }}>Closer look</div>
							<div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
								<button type="button" onClick={() => setModalZoom(z => Math.max(0.5, z - 0.25))} style={modalToolBtn}>-</button>
								<button type="button" onClick={() => setModalZoom(1)} style={modalToolBtn}>{Math.round(modalZoom * 100)}%</button>
								<button type="button" onClick={() => setModalZoom(z => Math.min(3, z + 0.25))} style={modalToolBtn}>+</button>
								<button
									type="button"
									onClick={() => {
										setIsExpanded(false);
										setModalZoom(1);
									}}
									style={modalToolBtn}
								>
									Close
								</button>
							</div>
						</div>
						<div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
							{errorText ? (
								<pre
									style={{
										margin: 0,
										padding: '10px 12px',
										borderRadius: '8px',
										background: V.codeBg,
										border: `1px solid ${V.border}`,
										fontFamily: FONT_MONO,
										fontSize: '11.5px',
										lineHeight: 1.55,
										color: '#cfd0d4',
										whiteSpace: 'pre-wrap',
										wordBreak: 'break-word',
										overflowWrap: 'anywhere',
									}}
								>
									<code>{diagram}</code>
								</pre>
							) : (
								<div ref={modalRef} style={{ width: 'max-content', minWidth: '100%' }} />
							)}
						</div>
					</div>
				</div>
			) : null}
		</figure>
		</div>
	);
};

const modalToolBtn: React.CSSProperties = {
	border: `1px solid ${V.border}`,
	background: 'rgba(255,255,255,0.05)',
	color: V.text,
	borderRadius: '6px',
	padding: '5px 10px',
	fontSize: '11px',
	fontWeight: 600,
	cursor: 'pointer',
};

function renderInlineTokens(tokens: Token[] | undefined, k: string): React.ReactNode {
	if (!tokens?.length) {
		return null;
	}
	return tokens.map((t, i) => renderInlineToken(t, `${k}-i${i}`));
}

function renderInlineToken(t: Token, key: string): React.ReactNode {
	switch (t.type) {
		case 'text': {
			const tx = t as Tokens.Text;
			if (tx.tokens?.length) {
				return <React.Fragment key={key}>{renderInlineTokens(tx.tokens, key)}</React.Fragment>;
			}
			return <span key={key}>{tx.text}</span>;
		}
		case 'strong':
			return <strong key={key} style={{ fontWeight: 700, color: '#fff' }}>{renderInlineTokens((t as Tokens.Strong).tokens, key)}</strong>;
		case 'em':
			return <em key={key} style={{ fontStyle: 'italic', color: '#e8e8ed' }}>{renderInlineTokens((t as Tokens.Em).tokens, key)}</em>;
		case 'codespan':
			return (
				<code
					key={key}
					style={{
						fontFamily: FONT_MONO,
						fontSize: '13px',
						background: V.surface2,
						padding: '2px 7px',
						borderRadius: '6px',
						color: V.accentAmber,
						border: `1px solid ${V.borderSoft}`,
						wordBreak: 'break-word',
					}}
				>
					{(t as Tokens.Codespan).text}
				</code>
			);
		case 'link': {
			const L = t as Tokens.Link;
			const href = L.href ?? '';
			const safe = href.startsWith('https://') || href.startsWith('http://');
			if (safe) {
				return (
					<a key={key} href={href} title={L.title ?? undefined} target="_blank" rel="noopener noreferrer" style={{ color: V.link, textDecoration: 'none', borderBottom: `1px solid rgba(90,200,250,0.35)` }}>
						{renderInlineTokens(L.tokens, key)}
					</a>
				);
			}
			return (
				<span key={key} title={href} style={{ color: V.muted, borderBottom: `1px dashed ${V.border}` }}>
					{renderInlineTokens(L.tokens, key)}
				</span>
			);
		}
		case 'image': {
			const im = t as Tokens.Image;
			const href = im.href ?? '';
			const ok = href.startsWith('https://') || href.startsWith('http://');
			if (ok) {
				return <img key={key} src={href} alt={im.text} style={{ maxWidth: '100%', height: 'auto', objectFit: 'contain', borderRadius: '8px', margin: '8px 0', display: 'block' }} />;
			}
			return <span key={key} style={{ color: V.muted, fontSize: '11px' }}>[image: {im.text}]</span>;
		}
		case 'br':
			return <br key={key} />;
		case 'escape':
			return <span key={key}>{(t as Tokens.Escape).text}</span>;
		case 'del':
			return <del key={key} style={{ opacity: 0.75 }}>{renderInlineTokens((t as Tokens.Del).tokens, key)}</del>;
		default:
			return null;
	}
}

function headingStyles(mode: MarkdownRenderMode, depth: number): React.CSSProperties {
	const wb = { wordBreak: 'break-word' as const, overflowWrap: 'anywhere' as const };
	const d = Math.min(Math.max(depth, 1), 6);
	if (mode === 'briefing') {
		switch (d) {
			case 1:
				return { ...wb, margin: '0.35em 0 0.25em', fontSize: '22px', lineHeight: 1.25, fontWeight: 650, letterSpacing: '-0.02em', color: '#fafafa' };
			case 2:
				return { ...wb, margin: '0.55em 0 0.3em', fontSize: '17px', lineHeight: 1.3, fontWeight: 650, color: '#f0f0f0' };
			case 3:
				return { ...wb, margin: '0.5em 0 0.26em', fontSize: '15px', lineHeight: 1.35, fontWeight: 600, color: '#e8e8ea' };
			case 4:
				return { ...wb, margin: '0.45em 0 0.22em', fontSize: '14px', lineHeight: 1.38, fontWeight: 600, color: '#dedede' };
			default:
				return { ...wb, margin: '0.4em 0 0.2em', fontSize: '13px', lineHeight: 1.35, fontWeight: 600, color: '#d0d0d4' };
		}
	}
	switch (d) {
		case 1:
			return { ...wb, margin: '0.45em 0 0.35em', fontSize: '44px', lineHeight: 1.05, fontWeight: 700, letterSpacing: '-0.035em', color: '#ffffff' };
		case 2:
			return { ...wb, margin: '0.9em 0 0.42em', fontSize: '24px', lineHeight: 1.2, fontWeight: 700, letterSpacing: '-0.02em', color: '#fafafa' };
		case 3:
			return { ...wb, margin: '0.85em 0 0.38em', fontSize: '20px', lineHeight: 1.35, fontWeight: 600, letterSpacing: '-0.015em', color: '#f0f0f0' };
		case 4:
			return { ...wb, margin: '0.75em 0 0.32em', fontSize: '16px', lineHeight: 1.4, fontWeight: 600, color: '#e6e6e6' };
		default:
			return { ...wb, margin: '0.65em 0 0.28em', fontSize: '15px', lineHeight: 1.35, fontWeight: 600, color: '#dedede' };
	}
}

const listItemLiStyle = (ordered: boolean): React.CSSProperties =>
	ordered
		? { margin: '0.4em 0', paddingLeft: '4px', wordBreak: 'break-word', overflowWrap: 'anywhere' }
		: { margin: '0', wordBreak: 'break-word', overflowWrap: 'anywhere' };

function listTagStyle(ordered: boolean, mode: MarkdownRenderMode): React.CSSProperties {
	const fs = mode === 'briefing' ? '14px' : '15px';
	return {
		margin: '8px 0',
		paddingLeft: 0,
		paddingInlineStart: ordered ? '1.45em' : 0,
		fontSize: fs,
		lineHeight: 1.75,
		color: V.textBody,
		listStyleType: ordered ? 'decimal' : 'none',
		listStylePosition: 'outside',
	};
}

function renderLiRow(item: Tokens.ListItem, key: string, mode: MarkdownRenderMode): React.ReactNode {
	return (
		<>
			{item.task ? (
				<span style={{ marginRight: '8px', fontSize: '12px', opacity: 0.85 }}>{item.checked ? '☑' : '☐'}</span>
			) : null}
			{renderBlockTokens(item.tokens, key, mode)}
		</>
	);
}

function renderCoalescedTopLevelList(items: Tokens.ListItem[], key: string, mode: MarkdownRenderMode): React.ReactNode {
	return (
		<ul key={key} className="neptor-pm-md-list neptor-pm-md-list--unordered" style={listTagStyle(false, mode)}>
			{items.map((item, j) => (
				<li key={j} style={listItemLiStyle(false)}>
					{renderLiRow(item, `${key}-li${j}`, mode)}
				</li>
			))}
		</ul>
	);
}

function renderBlockTokens(tokens: Token[], keyPrefix: string, mode: MarkdownRenderMode = 'article'): React.ReactNode[] {
	const out: React.ReactNode[] = [];
	for (let i = 0; i < tokens.length; i += 1) {
		const t = tokens[i];
		if (t.type === 'list_item') {
			const run: Tokens.ListItem[] = [];
			let j = i;
			while (j < tokens.length && tokens[j].type === 'list_item') {
				run.push(tokens[j] as Tokens.ListItem);
				j += 1;
			}
			out.push(renderCoalescedTopLevelList(run, `${keyPrefix}-cul${i}`, mode));
			i = j - 1;
			continue;
		}
		const n = renderBlockToken(t, `${keyPrefix}-b${i}`, mode);
		if (n !== null) {
			out.push(n);
		}
	}
	return out;
}

const CodeBlock = ({ lang, raw }: { lang: string; raw: string }) => {
	const display = raw.replace(/\n$/, '');
	return (
		<figure
			style={{
				margin: '12px 0',
				borderRadius: '8px',
				border: `1px solid ${V.border}`,
				background: V.codeBg,
				overflow: 'hidden',
			}}
		>
			<header
				style={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'space-between',
					padding: '6px 10px',
					borderBottom: `1px solid ${V.borderSoft}`,
					background: 'rgba(255,255,255,0.02)',
				}}
			>
				<span style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: V.muted, fontFamily: FONT_MONO }}>
					{lang || 'text'}
				</span>
				<CopyButton getText={() => display} />
			</header>
			<pre
				style={{
					margin: 0,
					padding: '12px 14px',
					overflow: 'auto',
					fontSize: '12px',
					lineHeight: 1.6,
					fontFamily: FONT_MONO,
					color: '#d7d7db',
					whiteSpace: 'pre',
					tabSize: 2,
				}}
			>
				<code style={{ fontFamily: FONT_MONO, userSelect: 'text' }}>{display}</code>
			</pre>
		</figure>
	);
};

function renderBlockToken(t: Token, key: string, mode: MarkdownRenderMode = 'article'): React.ReactNode | null {
	const bodyFs = mode === 'briefing' ? '14px' : '15px';
	switch (t.type) {
		case 'space':
			return null;
		case 'def':
			return null;
		case 'hr':
			return <hr key={key} style={{ border: 'none', borderTop: `1px solid ${V.border}`, margin: mode === 'briefing' ? '20px 0' : '32px 0' }} />;
		case 'heading': {
			const h = t as Tokens.Heading;
			const d = Math.min(Math.max(h.depth, 1), 6);
			const inner = renderInlineTokens(h.tokens, key);
			const st = headingStyles(mode, d);
			if (d === 1) { return <h1 key={key} style={st}>{inner}</h1>; }
			if (d === 2) { return <h2 key={key} style={st}>{inner}</h2>; }
			if (d === 3) {
				return mode === 'article'
					? <h3 key={key} className="neptor-pm-md__h3" style={st}>{inner}</h3>
					: <h3 key={key} style={st}>{inner}</h3>;
			}
			if (d === 4) { return <h4 key={key} style={st}>{inner}</h4>; }
			if (d === 5) { return <h5 key={key} style={st}>{inner}</h5>; }
			return <h6 key={key} style={st}>{inner}</h6>;
		}
		case 'paragraph':
			return (
				<p
					key={key}
					style={{
						margin: '0 0 0.8em',
						lineHeight: 1.75,
						color: V.textBody,
						fontSize: bodyFs,
						wordBreak: 'break-word',
						overflowWrap: 'anywhere',
					}}
				>
					{renderInlineTokens((t as Tokens.Paragraph).tokens, key)}
				</p>
			);
		case 'code': {
			const c = t as Tokens.Code;
			const raw = c.text ?? '';
			const lang = c.lang ? String(c.lang) : '';
			if (codeLooksLikeMermaid(lang, raw)) {
				return <MermaidBlock key={key} code={raw} deferRender={mode === 'briefing'} />;
			}
			return <CodeBlock key={key} lang={lang} raw={raw} />;
		}
		case 'blockquote':
			return (
				<blockquote
					key={key}
					style={{
						margin: mode === 'briefing' ? '10px 0' : '14px 0',
						padding: '12px 16px',
						borderLeft: `2px solid ${V.primary}`,
						background: 'rgba(255, 59, 48, 0.05)',
						borderRadius: '0 8px 8px 0',
						color: V.textBody,
						fontSize: bodyFs,
						lineHeight: 1.75,
						fontStyle: 'italic',
						wordBreak: 'break-word',
						overflowWrap: 'anywhere',
					}}
				>
					{renderBlockTokens((t as Tokens.Blockquote).tokens, key, mode)}
				</blockquote>
			);
		case 'list': {
			const L = t as Tokens.List;
			const Tag = L.ordered ? 'ol' : 'ul';
			const listMod = L.ordered ? 'neptor-pm-md-list--ordered' : 'neptor-pm-md-list--unordered';
			return (
				<Tag key={key} className={`neptor-pm-md-list ${listMod}`} style={listTagStyle(L.ordered, mode)}>
					{L.items.map((item, j) => (
						<li key={j} style={listItemLiStyle(L.ordered)}>
							{renderLiRow(item, `${key}-li${j}`, mode)}
						</li>
					))}
				</Tag>
			);
		}
		case 'list_item': {
			const item = t as Tokens.ListItem;
			return renderCoalescedTopLevelList([item], key, mode);
		}
		case 'text': {
			const tx = t as Tokens.Text;
			const inner = tx.tokens?.length ? renderInlineTokens(tx.tokens, key) : tx.text;
			return (
				<p
					key={key}
					className="neptor-pm-md-para"
					style={{
						margin: '0 0 0.75em',
						lineHeight: 1.75,
						color: V.textBody,
						fontSize: bodyFs,
						wordBreak: 'break-word',
						overflowWrap: 'anywhere',
					}}
				>
					{inner}
				</p>
			);
		}
		case 'br':
			return <br key={key} className="neptor-pm-md-br" />;
		case 'table': {
			const tb = t as Tokens.Table;
			return (
				<div
					key={key}
					style={{
						overflowX: 'auto',
						margin: '14px 0',
						borderRadius: '8px',
						border: `1px solid ${V.border}`,
						background: V.codeBg,
					}}
				>
					<table style={{ borderCollapse: 'collapse', width: '100%', fontSize: bodyFs, lineHeight: 1.75, color: V.textBody, minWidth: '320px' }}>
						<thead>
							<tr style={{ background: V.surface2 }}>
								{tb.header.map((cell, hi) => (
									<th
										key={hi}
										style={{
											textAlign: tb.align[hi] ?? 'left',
											padding: '10px 12px',
											borderBottom: `1px solid ${V.border}`,
											fontFamily: FONT_MONO,
											fontWeight: 600,
											fontSize: '11px',
											textTransform: 'uppercase',
											letterSpacing: '0.08em',
											color: V.muted,
										}}
									>
										{renderInlineTokens(cell.tokens, `${key}-h${hi}`)}
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{tb.rows.map((row, ri) => (
								<tr key={ri} style={{ background: ri % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
									{row.map((cell, ci) => (
										<td
											key={ci}
											style={{
												textAlign: tb.align[ci] ?? 'left',
												padding: '9px 12px',
												borderTop: `1px solid ${V.borderSoft}`,
												verticalAlign: 'top',
												color: V.text,
												wordBreak: 'break-word',
												overflowWrap: 'anywhere',
											}}
										>
											{renderInlineTokens(cell.tokens, `${key}-r${ri}c${ci}`)}
										</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
				</div>
			);
		}
		case 'html':
		case 'tag': {
			const raw = (t as Tokens.HTML).text ?? '';
			const trim = raw.length > 400 ? `${raw.slice(0, 400)}…` : raw;
			return (
				<div
					key={key}
					style={{
						fontSize: '10px',
						color: V.faint,
						fontFamily: FONT_MONO,
						padding: '8px 10px',
						background: V.codeBg,
						borderRadius: '6px',
						margin: '8px 0',
						border: `1px solid ${V.borderSoft}`,
						wordBreak: 'break-word',
						overflowWrap: 'anywhere',
						whiteSpace: 'pre-wrap',
					}}
				>
					{trim}
				</div>
			);
		}
		default: {
			const gen = t as Tokens.Generic;
			if (gen.tokens && gen.tokens.length > 0) {
				return <div key={key}>{renderBlockTokens(gen.tokens, key, mode)}</div>;
			}
			if (typeof gen.raw === 'string' && gen.raw.trim()) {
				return (
					<p
						key={key}
						style={{
							margin: '0 0 0.5em',
							color: V.textBody,
							fontSize: bodyFs,
							whiteSpace: 'pre-wrap',
							wordBreak: 'break-word',
							overflowWrap: 'anywhere',
						}}
					>
						{gen.raw}
					</p>
				);
			}
			return null;
		}
	}
}

function repoTreeBodyClass(body: string): string {
	const lines = body.split('\n').map(l => l.trim()).filter(Boolean);
	if (lines.length < 3) {
		return '';
	}
	const pathy = /^[-*]\s+(`?)(\.?\/|[\w.-]+\/)/;
	const hits = lines.filter(l => pathy.test(l)).length;
	if (hits >= 3 && hits >= Math.ceil(lines.length * 0.4)) {
		return 'neptor-pm-md--repo-tree';
	}
	return '';
}

function renderMarkdownSegment(text: string, segKey: string, mode: MarkdownRenderMode = 'article'): React.ReactNode {
	const cap = text.length > 120_000 ? `${text.slice(0, 120_000)}\n\n_(truncated for display)_` : text;
	try {
		const tokens = marked.lexer(cap, { gfm: true });
		const nodes = renderBlockTokens(tokens as Token[], segKey, mode);
		if (nodes.length === 0) {
			return <p key={segKey} style={{ color: V.muted, fontSize: '12px' }}>(empty)</p>;
		}
		return <div key={segKey}>{nodes}</div>;
	} catch {
		return (
			<pre
				key={segKey}
				style={{
					whiteSpace: 'pre-wrap',
					fontSize: '12px',
					color: V.text,
					fontFamily: FONT_MONO,
					wordBreak: 'break-word',
					overflowWrap: 'anywhere',
				}}
			>
				{cap}
			</pre>
		);
	}
}

export type MemorySectionBodyVariant = MarkdownRenderMode;

type MemorySectionBodyProps = {
	body: string;
	/** Default `briefing` for PM canvas cards (tighter typography, lazy diagrams). */
	variant?: MemorySectionBodyVariant;
	/** Stable key segment for lexer cache partitions (section id). */
	segmentKey?: string;
};

const MemorySectionBodyInner = ({ body, variant = 'briefing', segmentKey = 'body' }: MemorySectionBodyProps) => {
	const treeClass = useMemo(() => repoTreeBodyClass(body), [body]);
	const rendered = useMemo(() => {
		if (!body.trim()) {
			return null;
		}
		return renderMarkdownSegment(body, segmentKey, variant);
	}, [body, segmentKey, variant]);
	if (!body.trim()) {
		return <p style={{ color: V.muted, fontSize: '12px', margin: 0 }}>(empty section)</p>;
	}
	return (
		<div
			className={['neptor-pm-md', treeClass].filter(Boolean).join(' ')}
			style={{
				marginTop: '8px',
				fontFamily: FONT_BODY,
				userSelect: 'text',
				wordBreak: 'break-word',
				overflowWrap: 'anywhere',
				maxWidth: '100%',
				minWidth: 0,
			}}
		>
			{rendered}
			<div
				className="neptor-pm-md__section-actions"
				style={{
					display: 'flex',
					justifyContent: 'flex-end',
					alignItems: 'center',
					marginTop: '12px',
					paddingTop: '12px',
					borderTop: `1px solid ${V.borderSoft}`,
				}}
			>
				<CopyButton getText={() => body} label="Copy section" size="md" />
			</div>
		</div>
	);
};

/** Renders section body as structured markdown (lists, tables, etc.) and Mermaid diagrams from fenced ```mermaid blocks. */
export const MemorySectionBody = memo(MemorySectionBodyInner);

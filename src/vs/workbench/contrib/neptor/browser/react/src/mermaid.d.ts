declare module 'mermaid' {
	const mermaid: {
		initialize: (options: Record<string, unknown>) => void;
		render: (id: string, text: string) => Promise<{ svg: string; bindFunctions?: (element: Element) => void }>;
	};
	export default mermaid;
}

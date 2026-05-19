import { URI } from '../../../../base/common/uri.js';

export type NeptorDirectoryItem = {
	uri: URI;
	name: string;
	isSymbolicLink: boolean;
	children: NeptorDirectoryItem[] | null;
	isDirectory: boolean;
	isGitIgnoredDirectory: false | { numChildren: number }; // if directory is gitignored, we ignore children
}

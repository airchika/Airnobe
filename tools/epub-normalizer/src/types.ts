import type {
  BookAsset,
  BookDocument,
  BookManifest,
  ConversionReport,
  ConversionWarning,
  DocumentRole,
  TocItem,
} from "@airnobe/book-format";

export interface ManifestItem {
  id: string;
  href: string;
  path: string;
  mediaType: string;
  properties: Set<string>;
}

export interface SpineItem {
  idref: string;
  linear: boolean;
  item: ManifestItem;
}

export interface PackageInfo {
  packagePath: string;
  title: string;
  authors: string[];
  languages: string[];
  uniqueIdentifier: string;
  manifest: Map<string, ManifestItem>;
  spine: SpineItem[];
  tocId?: string;
  coverId?: string;
}

export interface ParsedNavigation {
  toc: TocItem[];
  navPath?: string;
}

export interface AssetPayload {
  descriptor: BookAsset;
  bytes: Uint8Array;
}

export interface ConversionResult {
  book: BookManifest;
  documents: BookDocument[];
  assets: AssetPayload[];
  report: ConversionReport;
}

export interface ConversionState {
  warnings: ConversionWarning[];
  sourceRubyCount: number;
  textBlockCount: number;
  parallelBlockCount: number;
  unclassifiedTextCount: number;
  directions: Set<"zh-jp" | "jp-zh">;
  maximumTranslationVariants: number;
}

export interface ParsedDocument {
  document: BookDocument;
  role: DocumentRole;
}

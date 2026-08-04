import { basename } from "node:path";
import { AIRNOBE_FORMAT_VERSION, type BookDocument, type BookManifest, type ConversionReport } from "@airnobe/book-format";
import JSZip from "jszip";
import {
  AssetRegistry,
  documentIdForPath,
  parseContentDocument,
  registerCoverAsset,
} from "./content.js";
import { loadEpub, parseNavigation, parsePackage } from "./epub.js";
import type { ConversionResult, ConversionState } from "./types.js";
import { sha256, stableId } from "./util.js";

export async function convertEpubBytes(bytes: Uint8Array, sourceFileName: string): Promise<ConversionResult> {
  const sourceSha256 = sha256(bytes);
  const warnings: ConversionState["warnings"] = [];
  const state: ConversionState = {
    warnings,
    sourceRubyCount: 0,
    textBlockCount: 0,
    parallelBlockCount: 0,
    unclassifiedTextCount: 0,
    directions: new Set(),
    maximumTranslationVariants: 0,
  };
  const zip: JSZip = await loadEpub(bytes, warnings);
  const packageInfo = await parsePackage(zip);
  const navPath = [...packageInfo.manifest.values()].find((item) => item.properties.has("nav"))?.path;
  const contentSpine = packageInfo.spine.filter((entry) => {
    if (entry.item.path === navPath) return false;
    if (!/application\/(?:xhtml\+xml|xml)|text\/html/.test(entry.item.mediaType)) {
      warnings.push({ code: "UNSUPPORTED_SPINE_ITEM", message: `Unsupported spine media type ${entry.item.mediaType}.`, sourcePath: entry.item.path });
      return false;
    }
    return true;
  });
  const documentIdByPath = new Map(contentSpine.map((entry) => [entry.item.path, documentIdForPath(entry.item.path)]));
  const navigation = await parseNavigation(zip, packageInfo, documentIdByPath, warnings);
  const assets = new AssetRegistry(zip, packageInfo.manifest, warnings);
  const coverAsset = await registerCoverAsset(packageInfo, assets);
  const documents: BookDocument[] = [];
  for (const spineItem of contentSpine) {
    const file = zip.file(spineItem.item.path);
    if (!file) throw new Error(`Spine document is missing: ${spineItem.item.path}`);
    documents.push(await parseContentDocument(
      await file.async("string"),
      spineItem.item.path,
      documentIdByPath.get(spineItem.item.path) as string,
      spineItem.item.properties,
      packageInfo.languages,
      documentIdByPath,
      assets,
      state,
    ));
  }
  const assetPayloads = assets.values();
  const formatLanguages = new Set<"zh-CN" | "ja-JP" | "und">();
  for (const document of documents) {
    for (const block of document.blocks) {
      if (block.type === "text") for (const variant of block.variants) formatLanguages.add(variant.language);
    }
  }
  const bookId = stableId("book", `${sourceSha256}:${packageInfo.uniqueIdentifier}`);
  const book: BookManifest = {
    format: "airnobe-book",
    version: AIRNOBE_FORMAT_VERSION,
    id: bookId,
    source: {
      fileName: basename(sourceFileName),
      sha256: sourceSha256,
      packagePath: packageInfo.packagePath,
      ...(packageInfo.uniqueIdentifier ? { identifier: packageInfo.uniqueIdentifier } : {}),
      languages: packageInfo.languages,
    },
    metadata: {
      title: packageInfo.title,
      authors: packageInfo.authors,
      languages: [...formatLanguages].sort(),
    },
    ...(coverAsset ? { coverAssetId: coverAsset.id } : {}),
    readingOrder: contentSpine.map((entry, index) => ({
      documentId: documentIdByPath.get(entry.item.path) as string,
      path: `documents/${String(index).padStart(4, "0")}.json`,
      role: documents[index]?.role ?? "unknown",
      linear: entry.linear,
    })),
    toc: navigation.toc,
    assets: assetPayloads.map((asset) => asset.descriptor),
  };
  const report: ConversionReport = {
    status: warnings.length > 0 ? "ok-with-warnings" : "ok",
    sourceFileName: basename(sourceFileName),
    sourceSha256,
    ...(state.directions.size > 0 ? {
      adapter: {
        id: "auto-novel-opacity-0.4",
        directions: [...state.directions].sort(),
        maximumTranslationVariants: state.maximumTranslationVariants,
      },
    } : {}),
    metrics: {
      spineDocumentCount: packageInfo.spine.length,
      outputDocumentCount: documents.length,
      textBlockCount: state.textBlockCount,
      parallelBlockCount: state.parallelBlockCount,
      sourceRubyCount: state.sourceRubyCount,
      reusedRubyCount: 0,
      generatedRubyCount: 0,
      assetCount: assetPayloads.length,
      unclassifiedTextCount: state.unclassifiedTextCount,
    },
    warnings,
  };
  return { book, documents, assets: assetPayloads, report };
}

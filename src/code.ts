/**
 * Color Switch – Scan 결과를 색상 단위로 표시, Matched만 Apply, No match 클릭 시 후보 토큰 표시
 */
// @ts-expect-error - Vite raw import
import uiHtml from "./ui.html?raw";
import { findVariableCollectionByName, getAvailableCollectionNames } from "./variableCollectionUtils";

type ModeName = "Light" | "Dark";

/** 그룹 필터 prefix: Color 우선, 그 다음 Black (순서 유지) */
const GROUP_FILTER_PREFIXES = ["Color/", "Black/"];

function matchesGroupFilter(variableName: string, prefixes: string[] = GROUP_FILTER_PREFIXES): boolean {
  return prefixes.some((p) => variableName.trim().startsWith(p));
}

/** 단일 그룹 prefix로만 매칭 (예: "Color/" 만) */
function matchesPrefix(variableName: string, prefix: string): boolean {
  return variableName.trim().startsWith(prefix);
}

interface ScanItem {
  nodeId: string;
  nodeName: string;
  property: "fills" | "strokes";
  index: number;
  currentColor: { r: number; g: number; b: number };
  opacity: number;
  matchVariableId: string | null;
  matchVariableName: string | null;
}

function rgbKey(c: { r: number; g: number; b: number }): string {
  return `${c.r},${c.g},${c.b}`;
}

/** opacity 비교용: abs(a1 - a2) < 0.01 이면 동일로 간주하기 위해 소수 둘째자리로 반올림 */
function roundAlpha(a: number | undefined): number {
  return Math.round((a ?? 1) * 100) / 100;
}

/** Exact match 키: RGB + opacity (variable에 alpha 없으면 1로 간주) */
function rgbOpacityKey(r: number, g: number, b: number, a: number | undefined): string {
  return `${r},${g},${b},${roundAlpha(a ?? 1)}`;
}

/** RGB (0–1) → HEX 문자열 "rrggbb" (no #) */
function rgbToHexStr(r: number, g: number, b: number): string {
  const to255 = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 255);
  return [to255(r), to255(g), to255(b)].map((n) => n.toString(16).padStart(2, "0")).join("");
}

/** HEX "rrggbb" → RGB 0–1 */
function parseHexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const s = hex.replace(/^#/, "").trim();
  if (s.length !== 6) return null;
  const n = parseInt(s, 16);
  if (isNaN(n)) return null;
  return {
    r: ((n >> 16) & 0xff) / 255,
    g: ((n >> 8) & 0xff) / 255,
    b: (n & 0xff) / 255,
  };
}

function colorDistance(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }): number {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

function hasFillStroke(node: SceneNode): node is SceneNode & { fills: readonly Paint[]; strokes?: readonly Paint[] } {
  return "fills" in node && node.fills !== figma.mixed;
}

function collectNodes(node: SceneNode): (SceneNode & { fills: readonly Paint[] })[] {
  const out: (SceneNode & { fills: readonly Paint[] })[] = [];
  if (hasFillStroke(node) && node.fills && Array.isArray(node.fills)) {
    out.push(node as SceneNode & { fills: readonly Paint[] });
  }
  if ("children" in node) {
    for (const child of node.children) {
      out.push(...collectNodes(child));
    }
  }
  return out;
}

interface CollectionColorMapOptions {
  useGroupFilters?: boolean;
  groupPrefixes?: string[];
}

async function getCollectionColorMap(
  collectionName: string,
  mode: ModeName,
  options: CollectionColorMapOptions = {}
): Promise<Map<string, { variable: Variable; name: string }>> {
  const { useGroupFilters = false, groupPrefixes = GROUP_FILTER_PREFIXES } = options;
  const found = await findVariableCollectionByName(collectionName);
  if (!found || found.type === "library") return new Map();
  const collection = found.collection;
  const modeEntry = collection.modes.find((m) => m.name.toLowerCase() === mode.toLowerCase());
  const modeId = modeEntry?.modeId ?? collection.modes[0]?.modeId;
  if (modeId == null) return new Map();

  const map = new Map<string, { variable: Variable; name: string }>();
  if (!useGroupFilters) {
    for (const variableId of collection.variableIds) {
      const variable = await figma.variables.getVariableByIdAsync(variableId);
      if (!variable || variable.resolvedType !== "COLOR") continue;
      const value = variable.valuesByMode[modeId];
      if (value && typeof value === "object" && "r" in value) {
        const v = value as { r: number; g: number; b: number; a?: number };
        const a = v.a ?? 1;
        const key = rgbOpacityKey(v.r, v.g, v.b, a);
        map.set(key, { variable, name: variable.name });
      }
    }
    return map;
  }
  // Color 우선, 동일 키면 Black은 무시 (Matched 판정 시 Color 그룹 최우선)
  const order = groupPrefixes.length >= 2 ? [groupPrefixes[0], groupPrefixes[1]] : groupPrefixes;
  for (const prefix of order) {
    for (const variableId of collection.variableIds) {
      const variable = await figma.variables.getVariableByIdAsync(variableId);
      if (!variable || variable.resolvedType !== "COLOR") continue;
      if (!matchesPrefix(variable.name, prefix)) continue;
      const value = variable.valuesByMode[modeId];
      if (value && typeof value === "object" && "r" in value) {
        const v = value as { r: number; g: number; b: number; a?: number };
        const a = v.a ?? 1;
        const key = rgbOpacityKey(v.r, v.g, v.b, a);
        if (!map.has(key)) map.set(key, { variable, name: variable.name });
      }
    }
  }
  return map;
}

/** 변수 목록 캐시: key → list (그룹별로 다른 키 사용) */
const variableListCacheMap = new Map<string, { variableId: string; variableName: string; r: number; g: number; b: number }[]>();

/**
 * 그룹 필터 시 groupPrefixFilter 로 특정 prefix만 사용 (예: ["Color/"] 또는 ["Black/"]).
 * null 이면 useGroupFilters ? 전체 그룹 : 필터 없음.
 */
async function getCollectionVariableList(
  collectionName: string,
  mode: ModeName,
  useGroupFilters: boolean,
  groupPrefixFilter: string[] | null = null
): Promise<{ variableId: string; variableName: string; r: number; g: number; b: number }[]> {
  const prefixKey = groupPrefixFilter ? groupPrefixFilter.join(",") : (useGroupFilters ? "all" : "none");
  const key = `${collectionName}|${mode}|${useGroupFilters}|${prefixKey}`;
  const cached = variableListCacheMap.get(key);
  if (cached) return cached;

  const found = await findVariableCollectionByName(collectionName);
  if (!found || found.type === "library") return [];
  const collection = found.collection;
  const modeEntry = collection.modes.find((m) => m.name.toLowerCase() === mode.toLowerCase());
  const modeId = modeEntry?.modeId ?? collection.modes[0]?.modeId;
  if (modeId == null) return [];

  const list: { variableId: string; variableName: string; r: number; g: number; b: number }[] = [];
  const prefixesToMatch = groupPrefixFilter ?? (useGroupFilters ? GROUP_FILTER_PREFIXES : null);

  for (const variableId of collection.variableIds) {
    const variable = await figma.variables.getVariableByIdAsync(variableId);
    if (!variable || variable.resolvedType !== "COLOR") continue;
    if (prefixesToMatch && !prefixesToMatch.some((p) => matchesPrefix(variable.name, p))) continue;
    const value = variable.valuesByMode[modeId];
    if (value && typeof value === "object" && "r" in value) {
      const v = value as { r: number; g: number; b: number };
      list.push({ variableId: variable.id, variableName: variable.name, r: v.r, g: v.g, b: v.b });
    }
  }
  variableListCacheMap.set(key, list);
  return list;
}

/** 후보 계산: 거리 정렬 후 상위 limit 개 (near match, opacity 제외) */
function computeCandidates(
  list: { variableId: string; variableName: string; r: number; g: number; b: number }[],
  targetRgb: { r: number; g: number; b: number },
  limit: number
): { variableId: string; variableName: string; hex: string }[] {
  const withDistance = list.map((v) => ({
    ...v,
    hex: rgbToHexStr(v.r, v.g, v.b),
    distance: colorDistance(targetRgb, { r: v.r, g: v.g, b: v.b }),
  }));
  withDistance.sort((a, b) => {
    if (Math.abs(a.distance - b.distance) < 1e-6) return a.variableName.localeCompare(b.variableName);
    return a.distance - b.distance;
  });
  return withDistance.slice(0, limit).map(({ variableId, variableName, hex }) => ({ variableId, variableName, hex }));
}

function isSolidUnbound(
  node: SceneNode & { fills: readonly Paint[]; boundVariables?: { fills?: unknown[]; strokes?: unknown[] } },
  property: "fills" | "strokes",
  index: number
): boolean {
  return node.boundVariables?.[property]?.[index] == null;
}

function scanNodes(
  nodes: (SceneNode & { fills: readonly Paint[] })[],
  colorMap: Map<string, { variable: Variable; name: string }>
): ScanItem[] {
  const results: ScanItem[] = [];
  for (const node of nodes) {
    const paints = node.fills;
    if (paints && Array.isArray(paints)) {
      for (let i = 0; i < paints.length; i++) {
        const p = paints[i];
        if (p.type !== "SOLID") continue;
        if (!isSolidUnbound(node as SceneNode & { fills: readonly Paint[]; boundVariables?: { fills?: unknown[] } }, "fills", i)) continue;
        const key = rgbOpacityKey(p.color.r, p.color.g, p.color.b, p.opacity ?? 1);
        const match = colorMap.get(key);
        results.push({
          nodeId: node.id,
          nodeName: node.name,
          property: "fills",
          index: i,
          currentColor: p.color,
          opacity: p.opacity ?? 1,
          matchVariableId: match?.variable.id ?? null,
          matchVariableName: match?.name ?? null,
        });
      }
    }
    const strokes = "strokes" in node && node.strokes !== figma.mixed ? node.strokes : null;
    if (strokes && Array.isArray(strokes)) {
      for (let i = 0; i < strokes.length; i++) {
        const p = strokes[i];
        if (p.type !== "SOLID") continue;
        if (!isSolidUnbound(node as SceneNode & { fills: readonly Paint[]; boundVariables?: { strokes?: unknown[] } }, "strokes", i)) continue;
        const key = rgbOpacityKey(p.color.r, p.color.g, p.color.b, p.opacity ?? 1);
        const match = colorMap.get(key);
        results.push({
          nodeId: node.id,
          nodeName: node.name,
          property: "strokes",
          index: i,
          currentColor: p.color,
          opacity: p.opacity ?? 1,
          matchVariableId: match?.variable.id ?? null,
          matchVariableName: match?.name ?? null,
        });
      }
    }
  }
  return results;
}

interface MatchedColorItem {
  hex: string;
  tokenName: string;
  variableId: string;
}

interface NoMatchColorItem {
  hex: string;
}

async function runScan(
  collectionName: string,
  mode: ModeName,
  options: { useGroupFilters?: boolean } = {}
): Promise<{ items: ScanItem[]; matchedColors: MatchedColorItem[]; noMatchColors: NoMatchColorItem[]; totalScanned: number; error?: string }> {
  try {
    const colorMap = await getCollectionColorMap(collectionName, mode, {
      useGroupFilters: options.useGroupFilters ?? false,
    });
    if (colorMap.size === 0) {
      return {
        items: [],
        matchedColors: [],
        noMatchColors: [],
        totalScanned: 0,
        error: options.useGroupFilters
          ? `"${collectionName}" 컬렉션에서 필터(Color, Black)에 맞는 COLOR 변수가 없습니다.`
          : `"${collectionName}" 컬렉션을 찾을 수 없거나 해당 모드에 COLOR 변수가 없습니다.`,
      };
    }

    const selection = figma.currentPage.selection;
    const nodes =
      selection.length > 0 ? selection.flatMap((n) => collectNodes(n)) : collectNodes(figma.currentPage);
    const items = scanNodes(nodes, colorMap);

    const matchedByHex = new Map<string, { tokenName: string; variableId: string }>();
    const noMatchHexSet = new Set<string>();
    for (const item of items) {
      const hex = rgbToHexStr(item.currentColor.r, item.currentColor.g, item.currentColor.b);
      if (item.matchVariableId != null && item.matchVariableName != null) {
        if (!matchedByHex.has(hex)) matchedByHex.set(hex, { tokenName: item.matchVariableName, variableId: item.matchVariableId });
      } else {
        noMatchHexSet.add(hex);
      }
    }

    const matchedColors: MatchedColorItem[] = Array.from(matchedByHex.entries()).map(([hex, v]) => ({
      hex,
      tokenName: v.tokenName,
      variableId: v.variableId,
    }));
    const noMatchColors: NoMatchColorItem[] = Array.from(noMatchHexSet).sort().map((hex) => ({ hex }));

    return {
      items,
      matchedColors,
      noMatchColors,
      totalScanned: items.length,
    };
  } catch (e) {
    return {
      items: [],
      matchedColors: [],
      noMatchColors: [],
      totalScanned: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

interface ApplyResult {
  appliedCount: number;
  skippedCount: number;
  failedCount: number;
  failedReasons: string[];
}

async function applyBindingsToItems(items: ScanItem[]): Promise<ApplyResult> {
  const result: ApplyResult = { appliedCount: 0, skippedCount: 0, failedCount: 0, failedReasons: [] };
  const toApply = items.filter((i): i is ScanItem & { matchVariableId: string } => i.matchVariableId != null);

  for (const item of toApply) {
    const variable = await figma.variables.getVariableByIdAsync(item.matchVariableId);
    if (!variable) {
      result.failedCount++;
      result.failedReasons.push(`[${item.nodeName}] 변수를 찾을 수 없음: ${item.matchVariableId}`);
      continue;
    }
    const node = (await figma.getNodeByIdAsync(item.nodeId)) as (SceneNode & {
      fills?: readonly Paint[];
      strokes?: readonly Paint[];
      boundVariables?: { fills?: unknown[]; strokes?: unknown[] };
    }) | null;
    if (!node) {
      result.failedCount++;
      result.failedReasons.push(`[${item.nodeName}] 노드를 찾을 수 없음: ${item.nodeId}`);
      continue;
    }
    if (item.property === "fills") {
      if (!("fills" in node) || node.fills === figma.mixed || !Array.isArray(node.fills)) {
        result.skippedCount++;
        continue;
      }
      const bound = node.boundVariables?.fills?.[item.index];
      if (bound != null) {
        result.skippedCount++;
        continue;
      }
      const paints = Array.from(node.fills);
      const paint = paints[item.index];
      if (!paint || paint.type !== "SOLID") {
        result.skippedCount++;
        continue;
      }
      try {
        const newPaint = figma.variables.setBoundVariableForPaint(paint, "color", variable);
        paints[item.index] = newPaint;
        (node as SceneNode & { fills: readonly Paint[] }).fills = paints;
        result.appliedCount++;
      } catch (e) {
        result.failedCount++;
        result.failedReasons.push(`[${item.nodeName}] fills[${item.index}]: ${e instanceof Error ? e.message : String(e)}`);
      }
      continue;
    }
    if (item.property === "strokes") {
      if (!("strokes" in node) || node.strokes === figma.mixed || !Array.isArray(node.strokes)) {
        result.skippedCount++;
        continue;
      }
      const bound = node.boundVariables?.strokes?.[item.index];
      if (bound != null) {
        result.skippedCount++;
        continue;
      }
      const paints = Array.from(node.strokes);
      const paint = paints[item.index];
      if (!paint || paint.type !== "SOLID") {
        result.skippedCount++;
        continue;
      }
      try {
        const newPaint = figma.variables.setBoundVariableForPaint(paint, "color", variable);
        paints[item.index] = newPaint;
        (node as SceneNode & { strokes: readonly Paint[] }).strokes = paints;
        result.appliedCount++;
      } catch (e) {
        result.failedCount++;
        result.failedReasons.push(`[${item.nodeName}] strokes[${item.index}]: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  return result;
}

/** No match 색상(hex)에 대해 토큰 일괄 바인딩 */
async function applyTokenToColor(hex: string, variableId: string): Promise<ApplyResult> {
  const targetHex = hex.replace(/^#/, "").trim();
  const itemsToBind = lastScanItems.filter((item) => {
    if (item.matchVariableId != null) return false;
    const h = rgbToHexStr(item.currentColor.r, item.currentColor.g, item.currentColor.b);
    return h === targetHex;
  });
  if (itemsToBind.length === 0) return { appliedCount: 0, skippedCount: 0, failedCount: 0, failedReasons: [] };

  const variable = await figma.variables.getVariableByIdAsync(variableId);
  if (!variable) return { appliedCount: 0, skippedCount: 0, failedCount: itemsToBind.length, failedReasons: ["변수를 찾을 수 없음"] };

  const result: ApplyResult = { appliedCount: 0, skippedCount: 0, failedCount: 0, failedReasons: [] };
  for (const item of itemsToBind) {
    const node = (await figma.getNodeByIdAsync(item.nodeId)) as (SceneNode & {
      fills?: readonly Paint[];
      strokes?: readonly Paint[];
      boundVariables?: { fills?: unknown[]; strokes?: unknown[] };
    }) | null;
    if (!node) {
      result.failedCount++;
      result.failedReasons.push(`[${item.nodeName}] 노드를 찾을 수 없음`);
      continue;
    }
    if (item.property === "fills") {
      if (!("fills" in node) || node.fills === figma.mixed || !Array.isArray(node.fills)) {
        result.skippedCount++;
        continue;
      }
      const paints = Array.from(node.fills);
      const paint = paints[item.index];
      if (!paint || paint.type !== "SOLID") {
        result.skippedCount++;
        continue;
      }
      try {
        const newPaint = figma.variables.setBoundVariableForPaint(paint, "color", variable);
        paints[item.index] = newPaint;
        (node as SceneNode & { fills: readonly Paint[] }).fills = paints;
        result.appliedCount++;
      } catch (e) {
        result.failedCount++;
        result.failedReasons.push(`[${item.nodeName}]: ${e instanceof Error ? e.message : String(e)}`);
      }
      continue;
    }
    if (item.property === "strokes") {
      if (!("strokes" in node) || node.strokes === figma.mixed || !Array.isArray(node.strokes)) {
        result.skippedCount++;
        continue;
      }
      const paints = Array.from(node.strokes);
      const paint = paints[item.index];
      if (!paint || paint.type !== "SOLID") {
        result.skippedCount++;
        continue;
      }
      try {
        const newPaint = figma.variables.setBoundVariableForPaint(paint, "color", variable);
        paints[item.index] = newPaint;
        (node as SceneNode & { strokes: readonly Paint[] }).strokes = paints;
        result.appliedCount++;
      } catch (e) {
        result.failedCount++;
        result.failedReasons.push(`[${item.nodeName}]: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  return result;
}

let lastScanItems: ScanItem[] = [];

figma.showUI(uiHtml, { width: 400, height: 660 });

figma.ui.onmessage = async (msg: any) => {

  // ===== GET COLLECTIONS =====
  if (msg.type === "getCollections") {
    const collectionNames = await getAvailableCollectionNames();
    figma.ui.postMessage({ type: "collections", collectionNames });
    return;
  }

  // ===== SCAN =====
  if (msg.type === "scan") {
    const collectionName = msg.collectionName ?? msg.collection;
    const mode = msg.mode as ModeName;

    if (!collectionName || !mode) {
      figma.notify("Collection 또는 Mode가 없습니다", { error: true });
      return;
    }

    variableListCacheMap.clear();

    const result = await runScan(collectionName, mode, {
      useGroupFilters: msg.useGroupFilters === true,
    });

    lastScanItems = result.items ?? [];

    const summary = {
      totalScanned: result.totalScanned,
      matchedUnique: result.matchedColors.length,
      noMatchUnique: result.noMatchColors.length,
      noMatchItems: result.items.filter((i) => i.matchVariableId == null).length,
    };

    figma.ui.postMessage({
      type: "scanUI",
      summary,
      matchedColors: result.matchedColors.map((m) => ({
        hex: m.hex,
        count: 1,
        variableId: m.variableId,
        variableName: m.tokenName,
      })),
      noMatchColors: result.noMatchColors.map((n) => ({
        hex: n.hex,
        count: 1,
      })),
      error: result.error,
    });

    return;
  }

  // ===== GET SUGGESTIONS =====
  if (msg.type === "getSuggestions") {
    const collectionName = msg.collectionName ?? msg.collection;
    const mode = msg.mode as ModeName;
    const hex = msg.hex;

    if (!collectionName || !mode || !hex) return;

    const hexNorm = hex.replace(/^#/, "").trim();
    const targetRgb = parseHexToRgb(hexNorm);
    if (!targetRgb) return;

    const list = await getCollectionVariableList(
      collectionName,
      mode,
      msg.useGroupFilters === true
    );

    const candidates = computeCandidates(list, targetRgb, 12);

    figma.ui.postMessage({
      type: "suggestions",
      hex: hexNorm,
      items: candidates.map((c) => ({
        variableId: c.variableId,
        name: c.variableName,
        hex: c.hex,
      })),
    });

    return;
  }

  if (msg.type === "getCandidatesForHex" && msg.hex != null && msg.collectionName != null && msg.mode != null) {
    try {
      const hexNorm = msg.hex.replace(/^#/, "").trim();
      const targetRgb = parseHexToRgb(hexNorm);
      if (!targetRgb) {
        figma.ui.postMessage({ type: "candidatesResult", hex: hexNorm, candidates: [], error: "Invalid HEX" });
        return;
      }
      const list = await getCollectionVariableList(
        msg.collectionName,
        msg.mode,
        msg.useGroupFilters === true
      );
      const withDistance = list.map((v) => ({
        ...v,
        hex: rgbToHexStr(v.r, v.g, v.b),
        distance: colorDistance(targetRgb, { r: v.r, g: v.g, b: v.b }),
      }));
      withDistance.sort((a, b) => {
        if (Math.abs(a.distance - b.distance) < 1e-6) return a.variableName.localeCompare(b.variableName);
        return a.distance - b.distance;
      });
      const top = withDistance.slice(0, 12).map(({ variableId, variableName, hex }) => ({ variableId, variableName, hex }));
      figma.ui.postMessage({ type: "candidatesResult", hex: hexNorm, candidates: top });
    } catch (e) {
      figma.ui.postMessage({
        type: "candidatesResult",
        hex: msg.hex,
        candidates: [],
        error: e instanceof Error ? e.message : String(e),
      });
    }
    return;
  }

  if (msg.type === "applyTokenToColor" && msg.hex != null && msg.variableId != null) {
    try {
      const result = await applyTokenToColor(msg.hex, msg.variableId);
      figma.notify(`Applied ${result.appliedCount}, Skipped ${result.skippedCount}, Failed ${result.failedCount}`);
      figma.ui.postMessage({ type: "applyTokenToColorResult", ...result });
    } catch (e) {
      figma.notify("Apply failed", { error: true });
      figma.ui.postMessage({
        type: "applyTokenToColorResult",
        appliedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        failedReasons: [e instanceof Error ? e.message : String(e)],
        error: e instanceof Error ? e.message : String(e),
      });
    }
    return;
  }

  if (msg.type === "selectNodes" && Array.isArray(msg.nodeIds) && msg.nodeIds.length > 0) {
    try {
      const nodes: SceneNode[] = [];
      for (const id of msg.nodeIds) {
        const node = await figma.getNodeByIdAsync(id);
        if (node) nodes.push(node);
      }
      if (nodes.length > 0) {
        figma.currentPage.selection = nodes;
        figma.viewport.scrollAndZoomIntoView(nodes);
        figma.notify(`Selected ${nodes.length} node(s)`);
      } else {
        figma.notify("No nodes found", { error: true });
      }
    } catch (e) {
      figma.notify("Selection failed", { error: true });
      figma.ui.postMessage({ type: "selectNodesResult", error: e instanceof Error ? e.message : String(e) });
    }
    return;
  }

  if (msg.type === "apply") {
    figma.notify("Applying...");
    try {
      const result = await applyBindingsToItems(lastScanItems);
      figma.notify(`Applied ${result.appliedCount}, Skipped ${result.skippedCount}, Failed ${result.failedCount}`);
      figma.ui.postMessage({ type: "applyResult", ...result });
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      figma.notify("Apply failed", { error: true });
      figma.ui.postMessage({
        type: "applyResult",
        appliedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        failedReasons: [],
        error: errorMessage,
      });
    }
    return;
  }
};

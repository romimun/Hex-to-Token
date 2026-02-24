/**
 * Variable Collection 검색 유틸
 * 로컬 컬렉션 + 사용 가능한 라이브러리 컬렉션에서 이름으로 검색
 */

export type VariableCollectionSource =
  | { type: "local"; collection: VariableCollection }
  | { type: "library"; collection: LibraryVariableCollection };

export interface VariableCollectionNotFoundPayload {
  type: "variableCollectionNotFound";
  error: string;
  localCollectionNames: string[];
  libraryCollectionNames: string[];
}

/**
 * 이름으로 Variable Collection을 검색합니다.
 * 로컬(figma.variables.getLocalVariableCollectionsAsync)과
 * 사용 가능한 라이브러리(figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync)를 모두 검색합니다.
 *
 * @param name - 검색할 컬렉션 이름 (대소문자 구분 없이 일치)
 * @returns 찾은 경우 { type, collection }, 못 찾은 경우 null (이때 postMessage로 에러·목록 전송)
 */
export async function findVariableCollectionByName(
  name: string
): Promise<VariableCollectionSource | null> {
  const nameLower = name.trim().toLowerCase();
  if (!nameLower) {
    figma.ui.postMessage({
      type: "variableCollectionNotFound",
      error: "컬렉션 이름이 비어 있습니다.",
      localCollectionNames: [],
      libraryCollectionNames: [],
    } as VariableCollectionNotFoundPayload);
    return null;
  }

  const [localCollections, libraryCollections] = await Promise.all([
    figma.variables.getLocalVariableCollectionsAsync(),
    getLibraryVariableCollectionsSafe(),
  ]);

  const localNames = localCollections.map((c) => c.name);
  const libraryNames = libraryCollections.map((c) => c.name);

  const fromLocal = localCollections.find(
    (c) => c.name.trim().toLowerCase() === nameLower
  );
  if (fromLocal) {
    return { type: "local", collection: fromLocal };
  }

  const fromLibrary = libraryCollections.find(
    (c) => c.name.trim().toLowerCase() === nameLower
  );
  if (fromLibrary) {
    return { type: "library", collection: fromLibrary };
  }

  const error = `"${name}" 컬렉션을 찾을 수 없습니다. (로컬 ${localNames.length}개, 라이브러리 ${libraryNames.length}개 검색됨)`;

  figma.ui.postMessage({
    type: "variableCollectionNotFound",
    error,
    localCollectionNames: localNames,
    libraryCollectionNames: libraryNames,
  } as VariableCollectionNotFoundPayload);

  return null;
}

/**
 * teamLibrary 권한이 없거나 실패해도 빈 배열 반환
 */
async function getLibraryVariableCollectionsSafe(): Promise<
  LibraryVariableCollection[]
> {
  if (typeof figma.teamLibrary?.getAvailableLibraryVariableCollectionsAsync !== "function") {
    return [];
  }
  try {
    return await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync();
  } catch {
    return [];
  }
}

/**
 * 사용 가능한 Variable Collection 이름 목록을 반환합니다.
 * 로컬 컬렉션을 먼저, 그 다음 라이브러리 컬렉션(이름 중복 시 한 번만)으로 합칩니다.
 */
export async function getAvailableCollectionNames(): Promise<string[]> {
  const [localCollections, libraryCollections] = await Promise.all([
    figma.variables.getLocalVariableCollectionsAsync(),
    getLibraryVariableCollectionsSafe(),
  ]);
  const localNames = localCollections.map((c) => c.name);
  const libraryNames = libraryCollections.map((c) => c.name);
  const seen = new Set(localNames.map((n) => n.trim().toLowerCase()));
  for (const name of libraryNames) {
    if (!seen.has(name.trim().toLowerCase())) {
      localNames.push(name);
      seen.add(name.trim().toLowerCase());
    }
  }
  return localNames;
}

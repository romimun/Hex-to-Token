/**
 * Color Switch – UI
 */

type ModeName = "Light" | "Dark";

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

let selectedMode: ModeName = "Light";
let currentItems: ScanItem[] = [];

function rgbToHex(r: number, g: number, b: number): string {
  const to255 = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 255);
  return "#" + [to255(r), to255(g), to255(b)].map((n) => n.toString(16).padStart(2, "0")).join("");
}

function renderList(items: ScanItem[]) {
  const listEl = document.getElementById("list")!;
  listEl.innerHTML = "";
  if (items.length === 0) {
    listEl.innerHTML = '<div class="list-item"><span class="name">No unbound solid fills/strokes found</span></div>';
    return;
  }
  for (const item of items) {
    const div = document.createElement("div");
    const matched = item.matchVariableId != null;
    div.className = "list-item " + (matched ? "matched" : "unmatched");
    const hex = rgbToHex(item.currentColor.r, item.currentColor.g, item.currentColor.b);
    div.innerHTML = `
      <span class="name" title="${item.nodeName}">${item.nodeName}</span>
      <span class="prop">${item.property}[${item.index}]</span>
      <span class="color" style="background:${hex}" title="${hex}"></span>
      <span class="status">${matched ? `→ ${item.matchVariableName}` : "No match"}</span>
    `;
    listEl.appendChild(div);
  }
}

function setError(msg: string | null) {
  const el = document.getElementById("error")!;
  if (msg) {
    el.textContent = msg;
    el.className = "error";
    el.style.display = "block";
  } else {
    el.textContent = "";
    el.style.display = "none";
  }
}

function setMode(mode: ModeName) {
  selectedMode = mode;
  (document.querySelectorAll(".mode-btn") as NodeListOf<HTMLButtonElement>).forEach((btn) => {
    btn.classList.toggle("primary", (btn.id === "modeLight" && mode === "Light") || (btn.id === "modeDark" && mode === "Dark"));
  });
}

document.getElementById("modeLight")!.addEventListener("click", () => setMode("Light"));
document.getElementById("modeDark")!.addEventListener("click", () => setMode("Dark"));

document.getElementById("scanBtn")!.addEventListener("click", () => {
  setError(null);
  parent.postMessage({ pluginMessage: { type: "scan", mode: selectedMode } }, "*");
});

document.getElementById("applyBtn")!.addEventListener("click", () => {
  if (currentItems.length === 0) return;
  setError(null);
  parent.postMessage({ pluginMessage: { type: "apply", mode: selectedMode, items: currentItems } }, "*");
});

window.onmessage = (event: MessageEvent) => {
  // Plugin → UI: figma.ui.postMessage payload is event.data
  const msg = event.data?.pluginMessage ?? event.data;
  if (!msg?.type) return;
  if (msg.type === "scanResult") {
    currentItems = msg.items ?? [];
    renderList(currentItems);
    setError(msg.error ?? null);
    (document.getElementById("applyBtn") as HTMLButtonElement).disabled = currentItems.filter((i: ScanItem) => i.matchVariableId).length === 0;
  }
  if (msg.type === "applyResult") {
    if (msg.error) setError(msg.error);
    else if (msg.applied != null) {
      const el = document.getElementById("error")!;
      el.textContent = msg.applied > 0 ? `Applied ${msg.applied} binding(s).` : "Nothing applied.";
      el.className = "error success";
      el.style.display = "block";
    }
  }
  if (msg.type === "variableCollectionNotFound") {
    const parts: string[] = [msg.error ?? "컬렉션을 찾을 수 없습니다."];
    if (msg.localCollectionNames?.length) {
      parts.push(`로컬: ${msg.localCollectionNames.join(", ")}`);
    }
    if (msg.libraryCollectionNames?.length) {
      parts.push(`라이브러리: ${msg.libraryCollectionNames.join(", ")}`);
    }
    setError(parts.join("\n"));
    currentItems = [];
    renderList(currentItems);
    (document.getElementById("applyBtn") as HTMLButtonElement).disabled = true;
  }
};

setMode("Light");

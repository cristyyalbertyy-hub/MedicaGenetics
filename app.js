const curriculum = [
  {
    id: "BG",
    label: "Basic Genetics",
    subchapters: [
      { id: "T", label: "Terminology" },
      { id: "MP", label: "Mendelian Principles" },
      { id: "PG", label: "Population Genetics" },
    ],
  },
  {
    id: "IM",
    label: "Inheritance Models",
    subchapters: [
      { id: "M", label: "Monogenic" },
      { id: "C", label: "Chromosomal" },
      { id: "Mu", label: "Multifactorial" },
      { id: "Mi", label: "Mitochondrial" },
    ],
  },
  {
    id: "CA",
    label: "Clinical Application",
    subchapters: [
      { id: "PA", label: "Pedigree Analysis" },
      { id: "RC", label: "Risk Calculation" },
      { id: "GD", label: "Genetic Diagnosis" },
    ],
  },
];

const RESOURCES = [
  { id: "V", label: "Video" },
  { id: "P", label: "Podcast" },
  { id: "I", label: "Infographic" },
  { id: "Q", label: "Questions" },
];

const RESOURCE_EXTENSIONS = [
  "mp4",
  "webm",
  "mp3",
  "m4a",
  "wav",
  "html",
  "htm",
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "svg",
  "csv",
];

const state = {
  expanded: { BG: true, IM: false, CA: false },
  chapterId: null,
  subchapterId: null,
  resourceId: null,
};

const treeNavEl = document.getElementById("tree-nav");
const resourceNavEl = document.getElementById("resource-nav");
const viewerEl = document.getElementById("viewer");
let quizKeyboardHandler = null;

function clearQuizKeyboardHandler() {
  if (!quizKeyboardHandler) return;
  document.removeEventListener("keydown", quizKeyboardHandler);
  quizKeyboardHandler = null;
}

function filePrefix(chapterId, subchapterId) {
  return `${chapterId}_${subchapterId}`;
}

function subchapterIdCandidates(chapterId, subchapterId) {
  // Accept small naming variations in existing files (e.g. CA_P_Q vs CA_PA_Q).
  if (chapterId === "CA" && subchapterId === "PA") return ["PA", "P"];
  if (chapterId === "CA" && subchapterId === "P") return ["P", "PA"];
  return [subchapterId];
}

function buildResourceBaseNameCandidates(chapterId, subchapterId, resourceId) {
  const candidates = [];
  const subIds = subchapterIdCandidates(chapterId, subchapterId);

  subIds.forEach((subId) => {
    candidates.push(`${chapterId}_${subId}_${resourceId}`);
    candidates.push(`MG_${chapterId}_${subId}_${resourceId}`);
  });

  return candidates;
}

async function resourceExists(url) {
  try {
    const response = await fetch(url, { method: "HEAD", cache: "no-store" });
    return response.ok;
  } catch (error) {
    return false;
  }
}

async function resolveResourceUrl(chapterId, subchapterId, resourceId) {
  const bases = buildResourceBaseNameCandidates(chapterId, subchapterId, resourceId);

  for (const base of bases) {
    for (const ext of RESOURCE_EXTENSIONS) {
      const candidate = `public/${base}.${ext}`;
      if (await resourceExists(candidate)) return candidate;
    }
  }

  return null;
}

function extensionFromUrl(url) {
  const match = url.match(/\.([a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : "";
}

function splitCsvLine(line) {
  const parts = [];
  let field = "";
  let i = 0;
  let inQuotes = false;

  while (i < line.length) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        field += '"';
        i += 2;
        continue;
      }
      inQuotes = !inQuotes;
      i += 1;
      continue;
    }
    if (c === "," && !inQuotes) {
      parts.push(field.trim());
      field = "";
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  parts.push(field.trim());
  return parts;
}

function normalizeCsvField(value) {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/""/g, '"').trim();
  }
  return value;
}

function parseQuestionRows(csvText) {
  const rows = [];
  const lines = csvText.split(/\r?\n/);

  for (const line of lines) {
    if (!line.trim()) continue;
    const parts = splitCsvLine(line).map(normalizeCsvField);
    if (parts.length < 2) continue;
    const question = parts[0];
    const answer = parts.slice(1).join(",").trim();
    if (!question) continue;
    rows.push({ question, answer });
  }

  return rows;
}

function escapeHtml(text) {
  const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
  return String(text).replace(/[&<>"]/g, (ch) => map[ch] || ch);
}

function setPlaceholder(message) {
  clearQuizKeyboardHandler();
  viewerEl.innerHTML = `<p class="viewer-placeholder">${escapeHtml(message)}</p>`;
}

function setError(message) {
  clearQuizKeyboardHandler();
  viewerEl.innerHTML = `<p class="viewer-error">${escapeHtml(message)}</p>`;
}

function renderInlineQuiz(items) {
  clearQuizKeyboardHandler();
  let index = 0;
  let answerVisible = false;

  const root = document.createElement("div");
  root.className = "quiz-inline";

  const render = () => {
    const item = items[index];
    root.innerHTML = `
      <div class="quiz-head">
        <div>
          <h2>Questions</h2>
          <p class="quiz-meta">Card ${index + 1} of ${items.length}</p>
        </div>
        <p class="quiz-kbd-hint">Keyboard: ←/→ and Space/Enter</p>
      </div>
      <p class="quiz-question">${escapeHtml(String(item.question))}</p>
      <div class="quiz-answer" data-answer ${answerVisible ? "" : "hidden"}>${escapeHtml(String(item.answer))}</div>
      <div class="quiz-actions">
        <button type="button" class="btn btn-secondary" data-action="toggle">${answerVisible ? "Hide answer" : "Show answer"}</button>
        <button type="button" class="btn btn-secondary" data-action="prev" ${index === 0 ? "disabled" : ""}>Previous</button>
        <button type="button" class="btn btn-primary" data-action="next" ${index === items.length - 1 ? "disabled" : ""}>Next</button>
      </div>
    `;

    root.querySelector('[data-action="toggle"]').addEventListener("click", () => {
      answerVisible = !answerVisible;
      render();
    });
    root.querySelector('[data-action="prev"]').addEventListener("click", () => {
      if (index === 0) return;
      index -= 1;
      answerVisible = false;
      render();
    });
    root.querySelector('[data-action="next"]').addEventListener("click", () => {
      if (index === items.length - 1) return;
      index += 1;
      answerVisible = false;
      render();
    });
  };

  quizKeyboardHandler = (event) => {
    const target = event.target;
    const isTypingField =
      target instanceof HTMLElement &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable);
    if (isTypingField) return;

    if (event.key === "ArrowRight") {
      if (index < items.length - 1) {
        index += 1;
        answerVisible = false;
        render();
      }
      event.preventDefault();
      return;
    }

    if (event.key === "ArrowLeft") {
      if (index > 0) {
        index -= 1;
        answerVisible = false;
        render();
      }
      event.preventDefault();
      return;
    }

    if (event.key === " " || event.key === "Enter") {
      answerVisible = !answerVisible;
      render();
      event.preventDefault();
    }
  };
  document.addEventListener("keydown", quizKeyboardHandler);

  render();
  viewerEl.replaceChildren(root);
}

async function loadQuestionsCsv(url) {
  let csvText;
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error("bad response");
    csvText = await response.text();
  } catch (error) {
    setError(
      "Could not load the questions file. Run npm run dev and open the local address so files in /public can be read."
    );
    return;
  }

  const items = parseQuestionRows(csvText);
  if (!items.length) {
    setError("No questions were found in this CSV file.");
    return;
  }

  renderInlineQuiz(items);
}

function loadMediaViewer(url) {
  const ext = extensionFromUrl(url);
  viewerEl.replaceChildren();

  if (ext === "mp4" || ext === "webm") {
    const video = document.createElement("video");
    video.className = "viewer-media";
    video.setAttribute("controls", "");
    video.setAttribute("playsinline", "");
    video.src = url;
    viewerEl.appendChild(video);
    return;
  }

  if (ext === "mp3" || ext === "m4a" || ext === "wav") {
    const audio = document.createElement("audio");
    audio.className = "viewer-media";
    audio.setAttribute("controls", "");
    audio.src = url;
    viewerEl.appendChild(audio);
    return;
  }

  if (ext === "pdf" || ext === "html" || ext === "htm") {
    const iframe = document.createElement("iframe");
    iframe.className = "viewer-frame";
    iframe.title = "Resource";
    iframe.src = url;
    viewerEl.appendChild(iframe);
    return;
  }

  if (ext === "png" || ext === "jpg" || ext === "jpeg" || ext === "svg") {
    const img = document.createElement("img");
    img.className = "viewer-img";
    img.src = url;
    img.alt = "Infographic";
    viewerEl.appendChild(img);
    return;
  }

  setError(`This file type (.${ext}) is not supported for inline viewing.`);
}

async function loadSelectedResource() {
  if (!state.chapterId || !state.subchapterId || !state.resourceId) {
    setPlaceholder("Pick Video, Podcast, Infographic, or Questions.");
    return;
  }

  setPlaceholder("Loading…");

  const url = await resolveResourceUrl(state.chapterId, state.subchapterId, state.resourceId);
  if (!url) {
    const [primary, secondary] = buildResourceBaseNameCandidates(
      state.chapterId,
      state.subchapterId,
      state.resourceId
    );
    setError(
      `No file found. Add one of: public/${primary}.* or public/${secondary}.* (for example ${primary}.mp4 or ${primary}.csv).`
    );
    return;
  }

  if (state.resourceId === "Q" && url.endsWith(".csv")) {
    await loadQuestionsCsv(url);
    return;
  }

  loadMediaViewer(url);
}

function updateResourceButtons() {
  resourceNavEl.querySelectorAll("[data-resource]").forEach((btn) => {
    const id = btn.getAttribute("data-resource");
    btn.classList.toggle("active", id === state.resourceId);
  });
}

function toggleChapter(chapterId) {
  const wasExpanded = state.expanded[chapterId];
  state.expanded[chapterId] = !wasExpanded;

  if (!state.expanded[chapterId] && state.chapterId === chapterId) {
    state.chapterId = null;
    state.subchapterId = null;
    state.resourceId = null;
    resourceNavEl.hidden = true;
    setPlaceholder("Expand a chapter and choose a sub-topic.");
  }

  renderTree();
}

function selectSubchapter(chapterId, subchapterId) {
  state.chapterId = chapterId;
  state.subchapterId = subchapterId;
  state.resourceId = null;
  state.expanded[chapterId] = true;

  resourceNavEl.hidden = false;
  renderTree();
  updateResourceButtons();
  setPlaceholder("Choose Video, Podcast, Infographic, or Questions.");
}

function selectResource(id) {
  state.resourceId = id;
  updateResourceButtons();
  loadSelectedResource();
}

function renderTree() {
  treeNavEl.replaceChildren();

  curriculum.forEach((chapter) => {
    const expanded = Boolean(state.expanded[chapter.id]);
    const branch = document.createElement("div");
    branch.className = "tree-branch";

    const parentBtn = document.createElement("button");
    parentBtn.type = "button";
    parentBtn.className = "tree-parent";
    parentBtn.setAttribute("aria-expanded", expanded ? "true" : "false");
    parentBtn.innerHTML = `<span class="caret" aria-hidden="true"></span><span class="tree-parent-label">${escapeHtml(chapter.label)}</span>`;
    parentBtn.addEventListener("click", () => toggleChapter(chapter.id));

    branch.appendChild(parentBtn);

    if (expanded) {
      const childrenWrap = document.createElement("div");
      childrenWrap.className = "tree-children";

      chapter.subchapters.forEach((sub) => {
        const childBtn = document.createElement("button");
        childBtn.type = "button";
        childBtn.className = "tree-child";
        childBtn.setAttribute("data-chapter", chapter.id);
        childBtn.setAttribute("data-subchapter", sub.id);
        const prefix = filePrefix(chapter.id, sub.id);
        const isActive = state.chapterId === chapter.id && state.subchapterId === sub.id;
        if (isActive) childBtn.classList.add("active");

        childBtn.innerHTML = `
          <span class="caret-small" aria-hidden="true">▶</span>
          <span class="tree-child-text">
            <span class="tree-child-title">${escapeHtml(sub.label)}</span>
            <span class="tree-child-id">${escapeHtml(prefix)}</span>
          </span>
        `;
        childBtn.addEventListener("click", () => selectSubchapter(chapter.id, sub.id));
        childrenWrap.appendChild(childBtn);
      });

      branch.appendChild(childrenWrap);
    }

    treeNavEl.appendChild(branch);
  });
}

function buildResourceNav() {
  resourceNavEl.replaceChildren();

  RESOURCES.forEach((res) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-pill";
    btn.setAttribute("data-resource", res.id);
    btn.textContent = res.label;
    btn.addEventListener("click", () => selectResource(res.id));
    resourceNavEl.appendChild(btn);
  });
}

function init() {
  buildResourceNav();
  resourceNavEl.hidden = true;
  renderTree();
  setPlaceholder("Expand a chapter in the menu, then choose a sub-topic (for example BG_T).");
}

init();

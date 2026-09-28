(() => {
  const STORAGE_KEY = "my-unified-library-v1";
  const supportedExtensions = new Set(["txt", "epub", "pdf", "mobi", "azw3", "zip", "cbz"]);
  const $ = (selector) => document.querySelector(selector);
  const state = { works: loadWorks(), search: "", source: "all", completion: "all", sort: "title" };
  let connectedPlatform = "";

  function loadWorks() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch { return []; } }
  function persist() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.works)); }
  function uid() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`; }
  function clean(value) { return String(value || "").trim(); }
  function titleKey(value) { return clean(value).replace(/\[[^\]]*\]|\([^)]*\)|【[^】]*】/g, "").replace(/(?:완결|연재중|외전|\d+권|제\d+권)/g, "").replace(/[^0-9A-Za-z가-힣]/g, "").toLowerCase(); }
  function normalizeCompletion(value) { return /완결|complete/i.test(value) ? "완결" : /연재|ongoing/i.test(value) ? "연재중" : "미확인"; }
  function firstSortable(text) { return clean(text).replace(/^[\s\[\]【】(){}'".!?_-]+/, ""); }
  function titleGroup(title) { const char = firstSortable(title).charAt(0); if (/\d/.test(char)) return 0; if (/[A-Za-z]/.test(char)) return 1; if (/[가-힣]/.test(char)) return 2; return 3; }
  const collator = new Intl.Collator("ko", { numeric: true, sensitivity: "base" });
  function compareTitles(a, b) { const group = titleGroup(a.title) - titleGroup(b.title); return group || collator.compare(firstSortable(a.title), firstSortable(b.title)); }
  function completionRank(value) { return ({ "완결": 0, "연재중": 1, "미확인": 2 })[value] ?? 3; }
  function sourceRank(value) { return ({ "카카오페이지": 0, "내 폴더": 1, "기타": 2 })[value] ?? 3; }

  function visibleWorks() {
    const q = state.search.toLowerCase();
    return state.works.filter(work => (state.source === "all" || work.source.includes(state.source)) && (state.completion === "all" || work.completion === state.completion) && (!q || `${work.title} ${work.author}`.toLowerCase().includes(q))).sort((a, b) => {
      if (state.sort === "completion") return completionRank(a.completion) - completionRank(b.completion) || compareTitles(a, b);
      if (state.sort === "source") return sourceRank(a.source) - sourceRank(b.source) || compareTitles(a, b);
      if (state.sort === "author") return collator.compare(a.author || "", b.author || "") || compareTitles(a, b);
      return compareTitles(a, b);
    });
  }
  function setText(selector, value) { $(selector).textContent = value; }
  function render() {
    const list = $("#catalog-list"); list.replaceChildren();
    const works = visibleWorks();
    const template = $("#work-template");
    works.forEach(work => {
      const node = template.content.cloneNode(true);
      const card = node.querySelector(".work-card"); card.dataset.id = work.id;
      node.querySelector(".work-title").textContent = work.title;
      node.querySelector(".work-meta").textContent = [work.author || "작가 미상", work.path].filter(Boolean).join(" · ");
      node.querySelector(".source-badge").textContent = work.source;
      const completion = node.querySelector(".completion-badge"); completion.textContent = work.completion; completion.classList.toggle("done", work.completion === "완결"); completion.classList.toggle("ongoing", work.completion === "연재중");
      const link = node.querySelector(".open-link"); if (work.url) link.href = work.url; else link.classList.add("is-hidden");
      node.querySelector(".more-button").addEventListener("click", () => editWork(work.id)); list.append(node);
    });
    $("#empty-state").classList.toggle("is-hidden", works.length > 0);
    setText("#total-count", state.works.length); setText("#completed-count", state.works.filter(w => w.completion === "완결").length); setText("#ongoing-count", state.works.filter(w => w.completion === "연재중").length); setText("#source-count", new Set(state.works.map(w => w.source)).size);
    renderSourceFilter();
  }
  function renderSourceFilter() { const select = $("#source-filter"); const current = state.source; const sources = ["카카오페이지", "내 폴더", "기타", ...state.works.map(w => w.source)].filter((v, i, list) => v && list.indexOf(v) === i); select.innerHTML = `<option value="all">모든 출처</option>${sources.map(source => `<option value="${escapeHtml(source)}">${escapeHtml(source)}</option>`).join("")}`; select.value = current; }
  function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;","\"":"&quot;"})[char]); }
  function saveWork(data) { const index = state.works.findIndex(work => work.id === data.id); if (index >= 0) state.works[index] = data; else state.works.push(data); persist(); render(); }
  function formData(id = "") { return { id, title: clean($("#title-input").value), author: clean($("#author-input").value), source: $("#source-input").value, completion: $("#completion-input").value, url: clean($("#url-input").value), path: clean($("#path-input").value), updatedAt: new Date().toISOString() }; }
  function openNewWork() { $("#work-form").reset(); $("#edit-id").value = ""; $("#delete-work").hidden = true; $("#work-dialog-title").textContent = "작품 추가"; $("#work-dialog").showModal(); }
  function editWork(id) { const work = state.works.find(item => item.id === id); if (!work) return; $("#edit-id").value = work.id; $("#delete-work").hidden = false; $("#title-input").value = work.title; $("#author-input").value = work.author; $("#source-input").value = work.source; $("#completion-input").value = work.completion; $("#url-input").value = work.url; $("#path-input").value = work.path; $("#work-dialog-title").textContent = "작품 수정"; $("#work-dialog").showModal(); }
  function parseList(text, source) { return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => { const [title, author = "", completion = "미확인", url = ""] = line.split(/\s*(?:\||\t)\s*/); return { id: uid(), title: clean(title), author: clean(author), completion: normalizeCompletion(completion), source, url: clean(url), path: "", updatedAt: new Date().toISOString() }; }).filter(item => item.title); }
  async function scanFolder() {
    if (!("showDirectoryPicker" in window)) { alert("이 기능은 최신 Chrome 또는 Edge에서 사용할 수 있습니다."); return; }
    try { const root = await window.showDirectoryPicker(); const imported = []; await walkDirectory(root, "", imported); if (!imported.length) { alert("가져올 수 있는 소설 파일을 찾지 못했습니다. txt, epub, pdf, mobi, azw3, zip, cbz 형식을 확인해주세요."); return; } const added = dedupeIncoming(imported); persist(); render(); alert(`${imported.length}개 파일을 확인했고, 새 작품 ${added.length}개를 추가했습니다.`); } catch (error) { if (error.name !== "AbortError") alert(`폴더를 가져오지 못했습니다: ${error.message}`); }
  }
  async function walkDirectory(directory, parent, target) { for await (const handle of directory.values()) { const location = parent ? `${parent}\\${handle.name}` : handle.name; if (handle.kind === "directory") await walkDirectory(handle, location, target); else { const extension = handle.name.split(".").pop().toLowerCase(); if (supportedExtensions.has(extension)) target.push({ id: uid(), title: handle.name.replace(/\.[^.]+$/, ""), author: "", source: "내 폴더", completion: "미확인", url: "", path: location, updatedAt: new Date().toISOString() }); } } }
  function dedupeIncoming(items) { const added = []; items.forEach(item => { const match = state.works.find(work => titleKey(work.title) && titleKey(work.title) === titleKey(item.title)); if (match) { const sources = new Set(`${match.source} · ${item.source}`.split(" · ")); match.source = [...sources].join(" · "); if (!match.author && item.author) match.author = item.author; if (match.completion === "미확인" && item.completion !== "미확인") match.completion = item.completion; if (item.path && !match.path.includes(item.path)) match.path = [match.path, item.path].filter(Boolean).join(" · "); } else { state.works.push(item); added.push(item); } }); return added; }
  async function connectPlatform(name) { try { await window.libraryPlatform.open(name); connectedPlatform = name; } catch (error) { alert(`연결하지 못했습니다: ${error.message}`); } }
  async function importPlatform() { if (!connectedPlatform) return alert("먼저 플랫폼 연결 버튼을 누르고 보관함 화면으로 이동하세요."); try { $("#import-platform").disabled = true; $("#import-platform").textContent = "…"; const incoming = await window.libraryPlatform.importCurrent(connectedPlatform); if (!incoming.length) return alert("현재 화면에서 작품 목록을 찾지 못했습니다. 보관함 목록 화면인지 확인해 주세요."); const added = dedupeIncoming(incoming.map(work => ({ ...work, id: uid(), updatedAt: new Date().toISOString() }))); persist(); render(); alert(`${incoming.length}개 항목을 읽었고, 새 작품 ${added.length}개를 추가했습니다.`); } catch (error) { alert(`목록을 가져오지 못했습니다: ${error.message}`); } finally { $("#import-platform").disabled = false; $("#import-platform").textContent = "↓"; } }
  function downloadBackup() { const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), works: state.works }, null, 2)], { type: "application/json" }); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `내-통합-서재-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(link.href); }
  async function loadBackup(file) { try { const data = JSON.parse(await file.text()); if (!Array.isArray(data.works)) throw new Error("올바른 백업 파일이 아닙니다."); state.works = data.works.map(w => ({ id: w.id || uid(), title: clean(w.title), author: clean(w.author), source: clean(w.source) || "기타", completion: normalizeCompletion(w.completion), url: clean(w.url), path: clean(w.path), updatedAt: w.updatedAt || new Date().toISOString() })).filter(w => w.title); persist(); render(); } catch (error) { alert(`백업을 불러오지 못했습니다: ${error.message}`); } }
  function cloudMessage(message, isError = false) { const target = $("#cloud-status"); target.textContent = message; target.classList.toggle("error", isError); }
  async function cloudPush() { if (!window.libraryCloud) return cloudMessage("클라우드 백업은 데스크톱 앱에서 사용할 수 있습니다.", true); try { cloudMessage("클라우드에 백업하는 중…"); const result = await window.libraryCloud.push(state.works); cloudMessage(`${result.count}개 작품을 클라우드에 백업했습니다.`); } catch (error) { cloudMessage(`클라우드 백업 실패: ${error.message}`, true); } }
  async function cloudPull() { if (!window.libraryCloud) return cloudMessage("클라우드 불러오기는 데스크톱 앱에서 사용할 수 있습니다.", true); if (!confirm("현재 목록을 클라우드 백업본으로 교체할까요? JSON 백업을 먼저 권장합니다.")) return; try { cloudMessage("클라우드 백업을 불러오는 중…"); const result = await window.libraryCloud.pull(); if (!result.works) return cloudMessage("클라우드에 저장된 서재가 아직 없습니다."); state.works = result.works.map(w => ({ ...w, id: w.id || uid() })); persist(); render(); cloudMessage(`${state.works.length}개 작품을 클라우드에서 불러왔습니다.`); } catch (error) { cloudMessage(`클라우드 불러오기 실패: ${error.message}`, true); } }
  $("#add-button").addEventListener("click", openNewWork); $("#paste-button").addEventListener("click", () => $("#paste-dialog").showModal()); $("#folder-button").addEventListener("click", scanFolder); $("#export-button").addEventListener("click", downloadBackup); $("#cloud-push-button").addEventListener("click", cloudPush); $("#cloud-pull-button").addEventListener("click", cloudPull);
  $("#clear-library").addEventListener("click", () => { const count = state.works.length; if (!count) return alert("삭제할 작품이 없습니다."); if (!confirm(`저장된 작품 ${count}개를 모두 삭제할까요? 이 PC의 목록만 비워지며, 클라우드 백업은 유지됩니다.`)) return; state.works = []; persist(); render(); alert("저장된 목록을 모두 삭제했습니다."); });
  $("#connect-kakao").addEventListener("click", () => connectPlatform("카카오페이지")); $("#connect-ridi").addEventListener("click", () => connectPlatform("리디")); $("#import-platform").addEventListener("click", importPlatform);
  $("#work-form").addEventListener("submit", event => { event.preventDefault(); const id = $("#edit-id").value || uid(); const data = formData(id); if (!data.title) return; saveWork(data); $("#work-dialog").close(); });
  $("#delete-work").addEventListener("click", () => { const id = $("#edit-id").value; if (!id || !confirm("이 작품을 목록에서 삭제할까요?")) return; state.works = state.works.filter(work => work.id !== id); persist(); render(); $("#work-dialog").close(); });
  $("#paste-form").addEventListener("submit", event => { event.preventDefault(); const items = parseList($("#paste-text").value, $("#paste-source").value); if (!items.length) return; dedupeIncoming(items); persist(); render(); $("#paste-dialog").close(); $("#paste-text").value = ""; });
  $("#search-input").addEventListener("input", event => { state.search = event.target.value; render(); }); $("#source-filter").addEventListener("change", event => { state.source = event.target.value; render(); }); $("#completion-filter").addEventListener("change", event => { state.completion = event.target.value; render(); }); $("#sort-select").addEventListener("change", event => { state.sort = event.target.value; render(); });
  $("#backup-input").addEventListener("change", event => { const [file] = event.target.files; if (file) loadBackup(file); event.target.value = ""; }); render();
})();

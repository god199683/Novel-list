chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !tab.url) return;
  const source = /page\.kakao\.com/.test(tab.url) ? "카카오페이지" : /ridi(?:books)?\.com/.test(tab.url) ? "리디" : null;
  if (!source) return;
  const [{ result: works = [] } = {}] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (platform) => {
      const seen = new Set();
      return [...document.querySelectorAll("a[href]")].map((link) => {
        const title = (link.querySelector("img")?.alt || link.textContent || "").replace(/\s+/g, " ").trim();
        const url = new URL(link.href, location.href).href;
        return { title, url };
      }).filter(({ title, url }) => title && title.length > 1 && title.length < 180 && /(?:content|books|detail|novel|comic)/i.test(url))
        .filter(({ title, url }) => { const key = `${title}|${url}`; if (seen.has(key)) return false; seen.add(key); return true; })
        .map(({ title, url }) => ({ title, author: "", source: platform, completion: "미확인", url, path: "" }));
    },
    args: [source]
  });
  const payload = JSON.stringify({ type: "novel-list-platform-import", source, works, exportedAt: new Date().toISOString() }, null, 2);
  const dataUrl = `data:application/json;charset=utf-8,${encodeURIComponent(payload)}`;
  await chrome.downloads.download({ url: dataUrl, filename: `내-통합-서재-${source}-${Date.now()}.json`, saveAs: true });
});

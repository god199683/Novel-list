const { app, BrowserWindow, shell, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = "https://tygvgwwarzzwnajmvqps.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_W70i4zj-jUsLBNuyrnHanQ_N8eWokCq";
let supabase;
const platformWindows = new Map();
const platforms = {
  "카카오페이지": "https://page.kakao.com/",
  "리디": "https://ridibooks.com/"
};
const platformPartitions = { "카카오페이지": "persist:novel-list-kakao", "리디": "persist:novel-list-ridi" };

function getSupabase() {
  if (supabase) return supabase;
  const sessionFile = path.join(app.getPath("userData"), "supabase-session.json");
  const storage = {
    getItem: () => { try { return fs.readFileSync(sessionFile, "utf8"); } catch { return null; } },
    setItem: (_key, value) => fs.writeFileSync(sessionFile, value, "utf8"),
    removeItem: () => { try { fs.unlinkSync(sessionFile); } catch {} }
  };
  supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { storage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  });
  return supabase;
}

async function getCloudUser() {
  const client = getSupabase();
  const { data: { user: existingUser } } = await client.auth.getUser();
  if (existingUser) return { client, user: existingUser };
  const { data, error } = await client.auth.signInAnonymously();
  if (error) throw error;
  return { client, user: data.user };
}

function registerCloudHandlers() {
  ipcMain.handle("platform-open", async (_event, name) => {
    if (!platforms[name]) throw new Error("지원하지 않는 플랫폼입니다.");
    let window = platformWindows.get(name);
    if (!window || window.isDestroyed()) {
      window = new BrowserWindow({ width: 1180, height: 820, title: `${name} 연결`, webPreferences: { partition: platformPartitions[name], contextIsolation: true, nodeIntegration: false, sandbox: true } });
      window.on("closed", () => platformWindows.delete(name));
      platformWindows.set(name, window);
      await window.loadURL(platforms[name]);
    } else { window.focus(); }
    return name;
  });
  ipcMain.handle("platform-import", async (_event, name) => {
    const window = platformWindows.get(name);
    if (!window || window.isDestroyed()) throw new Error(`${name} 연결 창을 먼저 여세요.`);
    const works = await window.webContents.executeJavaScript(`(async () => {
      const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
      const tidy = value => String(value || '').replace(/\\s+/g, ' ').trim();
      const bad = /^(홈|검색|로그인|회원가입|보관함|내 서재|전체|소설|만화|웹툰|웹소설|책|이벤트|더보기|구매|구매 목록|최근 본|찜|설정|알림|내 정보|고객센터|이어보기|편집|필터|정렬|다음|이전|페이지)$/;
      const meta = /(웹소설|웹툰|로판|판타지|현판|무협|BL|로맨스|라이트노벨|만화|\\d+(일|시간|분) 전|열람|업데이트|기다무|충전|연재중|완결|총 ?\\d+권|UP)/i;
      const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const lines = el => (el.innerText || '').split(/\\n+/).map(tidy).filter(Boolean);
      const titleFrom = (card, image) => {
        const options = [
          ...lines(card).filter(text => text.length > 1 && text.length < 120 && !bad.test(text) && !meta.test(text)),
          tidy(image.getAttribute('alt')),
          tidy(image.getAttribute('title')),
          tidy(card.getAttribute('aria-label'))
        ];
        return options.find(text => text && text.length > 1 && text.length < 120 && !bad.test(text) && !meta.test(text)) || '';
      };
      const cardFor = image => {
        let node = image;
        for (let level = 0; level < 7 && node?.parentElement; level += 1) {
          node = node.parentElement;
          const r = node.getBoundingClientRect();
          const imageCount = node.querySelectorAll('img').length;
          if (visible(node) && imageCount <= 3 && r.width >= 90 && r.width <= 760 && r.height >= 70 && r.height <= 520 && lines(node).length) return node;
        }
        return image.closest('a') || image.parentElement;
      };
      async function scrollKakaoToEnd() {
        let stable = 0, previous = 0;
        for (let i = 0; i < 70 && stable < 4; i += 1) {
          const root = document.scrollingElement || document.documentElement;
          window.scrollTo({ top: root.scrollHeight, behavior: 'instant' });
          await pause(450);
          const count = document.images.length;
          stable = count === previous ? stable + 1 : 0;
          previous = count;
        }
        window.scrollTo({ top: 0, behavior: 'instant' });
        await pause(150);
      }
      if (${JSON.stringify(name)} === '카카오페이지') await scrollKakaoToEnd();
      const seen = new Set();
      const works = [];
      for (const image of [...document.querySelectorAll('img')]) {
        const rect = image.getBoundingClientRect();
        if (!visible(image) || rect.width < 42 || rect.height < 56 || rect.height / rect.width < 1.08) continue;
        const card = cardFor(image);
        const title = titleFrom(card, image);
        if (!title) continue;
        const anchors = [...card.querySelectorAll('a[href]')];
        const workLink = anchors.find(a => /(?:content|books|book|novel|product)/i.test(a.href)) || image.closest('a[href]') || anchors[0];
        const url = workLink ? new URL(workLink.href, location.href).href : location.href;
        const key = title.replace(/\\s/g, '').toLowerCase();
        if (!seen.has(key)) { seen.add(key); works.push({ title, url }); }
      }
      return works;
    })()`);
    return works.map(work => ({ ...work, source: name, author: "", completion: "미확인", path: "" }));
  });
  ipcMain.handle("library-cloud-push", async (_event, works) => {
    if (!Array.isArray(works)) throw new Error("올바르지 않은 서재 목록입니다.");
    const { client, user } = await getCloudUser();
    const { error } = await client.from("library_snapshots").upsert(
      { user_id: user.id, works, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
    if (error) throw error;
    return { count: works.length };
  });
  ipcMain.handle("library-cloud-pull", async () => {
    const { client, user } = await getCloudUser();
    const { data, error } = await client.from("library_snapshots")
      .select("works, updated_at").eq("user_id", user.id).maybeSingle();
    if (error) throw error;
    return { works: Array.isArray(data?.works) ? data.works : null };
  });
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1240,
    height: 860,
    minWidth: 820,
    minHeight: 620,
    backgroundColor: "#f6f5f1",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.js")
    }
  });

  window.loadFile(path.join(__dirname, "index.html"));
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(() => {
  registerCloudHandlers();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

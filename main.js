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
      let unchanged = 0, previous = 0;
      for (let i = 0; i < 80 && unchanged < 4; i += 1) {
        window.scrollTo(0, document.body.scrollHeight);
        await new Promise(resolve => setTimeout(resolve, 700));
        const count = document.querySelectorAll('a[href]').length;
        unchanged = count === previous ? unchanged + 1 : 0;
        previous = count;
      }
      const seen = new Set(), noise = /^(홈|검색|로그인|회원가입|보관함|내 서재|전체|소설|만화|웹툰|웹소설|이벤트|더보기|구매|최근 본|찜|설정|알림|내 정보|고객센터)$/;
      return [...document.querySelectorAll('a[href]')].map(a => {
        const cover = a.querySelector('img[alt]');
        const box = cover?.getBoundingClientRect();
        const isCover = Boolean(cover && box && box.width >= 48 && box.height >= 64 && box.height / box.width >= 1.12);
        return { title: (cover?.alt || '').replace(/\\s+/g, ' ').trim(), url: new URL(a.href, location.href).href, isCard: isCover };
      }).filter(x => x.isCard && x.title.length > 1 && x.title.length < 120 && !noise.test(x.title))
        .filter(x => { const key = x.title; if (seen.has(key)) return false; seen.add(key); return true; })
        .map(({ title, url }) => ({ title, url }));
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

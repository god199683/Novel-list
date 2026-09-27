const { app, BrowserWindow, shell, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");
const { createWorker } = require("tesseract.js");

const SUPABASE_URL = "https://tygvgwwarzzwnajmvqps.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_W70i4zj-jUsLBNuyrnHanQ_N8eWokCq";
let supabase;

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
  ipcMain.handle("library-ocr", async (_event, dataUrl) => {
    if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) throw new Error("이미지 파일만 가져올 수 있습니다.");
    const worker = await createWorker("kor+eng");
    try { const { data } = await worker.recognize(Buffer.from(dataUrl.split(",")[1], "base64")); return data.text; }
    finally { await worker.terminate(); }
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

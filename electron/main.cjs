const { app, BrowserWindow, shell, ipcMain } = require("electron");
const path = require("path");
const https = require("https");

const isDev = !app.isPackaged;

// ── IPC: Apollo Companies Search ────────────────────────────────────────────
function mapEmployeeCount(str) {
  if (!str) return undefined;
  const s = str.trim();
  if (s.endsWith("+")) {
    const n = parseInt(s);
    return [`${n},10000`];
  }
  const parts = s.split(/[-–]/);
  if (parts.length === 2) return [`${parts[0].trim()},${parts[1].trim()}`];
  return undefined;
}

ipcMain.handle("apollo:companies", async (_event, { apiKey, filters }) => {
  const payload = {
    api_key: apiKey,
    page: 1,
    per_page: 10,
  };
  if (filters.keywords)     payload.q_organization_keyword_tags = filters.keywords.split(",").map((s) => s.trim()).filter(Boolean);
  if (filters.industry)     payload.organization_industries = filters.industry.split(",").map((s) => s.trim()).filter(Boolean);
  if (filters.technologies) payload.currently_using_any_of_technology_uids = filters.technologies.split(",").map((s) => s.trim()).filter(Boolean);
  const ranges = mapEmployeeCount(filters.employee_count);
  if (ranges)               payload.organization_num_employees_ranges = ranges;

  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request(
      {
        hostname: "api.apollo.io",
        path: "/api/v1/mixed_companies/search",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          "Cache-Control": "no-cache",
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => {
          try {
            const json = JSON.parse(data);
            if (json.error) return reject(new Error(json.error));
            resolve({
              companies: json.organizations || [],
              total: json.pagination?.total_entries || 0,
            });
          } catch (e) {
            reject(new Error("Failed to parse Apollo response"));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
});


// ── IPC: Apollo Org Search ──────────────────────────────────────────────────
ipcMain.handle("apollo:orgSearch", async (_event, { apiKey, orgName }) => {
  const payload = {
    api_key: apiKey,
    q_organization_name: orgName,
    page: 1,
    per_page: 3,
  };
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request(
      {
        hostname: "api.apollo.io",
        path: "/api/v1/mixed_companies/search",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          "Cache-Control": "no-cache",
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => {
          try {
            const json = JSON.parse(data);
            if (json.error) return reject(new Error(json.error));
            const orgs = json.organizations || [];
            resolve({ organizations: orgs });
          } catch (e) {
            reject(new Error("Failed to parse Apollo org response"));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
});

// ── IPC: Apollo Contacts Search ─────────────────────────────────────────────
ipcMain.handle("apollo:contacts", async (_event, { apiKey, orgId, titles }) => {
  const payload = {
    api_key: apiKey,
    organization_ids: [orgId],
    person_titles: titles,
    page: 1,
    per_page: 10,
  };
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request(
      {
        hostname: "api.apollo.io",
        path: "/api/v1/mixed_people/search",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          "Cache-Control": "no-cache",
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => {
          try {
            const json = JSON.parse(data);
            if (json.error) return reject(new Error(json.error));
            resolve({ people: json.people || [] });
          } catch (e) {
            reject(new Error("Failed to parse Apollo contacts response"));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
});
// ── IPC: Open EventFold via deep link ───────────────────────────────────────
ipcMain.handle("shell:openExternal", (_event, url) => {
  shell.openExternal(url);
});

// ── Window ───────────────────────────────────────────────────────────────────
function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 820,
    minWidth: 880,
    minHeight: 600,
    backgroundColor: "#f8fafc",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    win.loadURL("http://localhost:5173");
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    const isLocal = url.startsWith("http://localhost") || url.startsWith("file://");
    if (!isLocal) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

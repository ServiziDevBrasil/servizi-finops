let cachedToken = null;
let cachedTokenExpiresAt = 0;

function base64Url(input) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function pemToArrayBuffer(pem) {
  const clean = String(pem)
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function signJwt(env) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({
    iss: env.GOOGLE_CLIENT_EMAIL,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${payload}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(env.GOOGLE_PRIVATE_KEY),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    new TextEncoder().encode(unsigned),
  );
  return `${unsigned}.${base64Url(signature)}`;
}

export async function googleAccessToken(env) {
  const now = Date.now();
  if (cachedToken && cachedTokenExpiresAt > now + 60_000) return cachedToken;
  if (!env.GOOGLE_CLIENT_EMAIL || !env.GOOGLE_PRIVATE_KEY) {
    throw new Error("Credenciais do Google Sheets não configuradas no Worker.");
  }

  const assertion = await signJwt(env);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error_description || json.error || "Falha ao autenticar no Google.");

  cachedToken = json.access_token;
  cachedTokenExpiresAt = now + (Number(json.expires_in || 3600) * 1000);
  return cachedToken;
}

async function sheetsFetch(env, path, init = {}) {
  const token = await googleAccessToken(env);
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${env.SPREADSHEET_ID}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!response.ok) {
    const message = json?.error?.message || `Google Sheets HTTP ${response.status}`;
    throw new Error(message);
  }
  return json;
}

export async function batchGetValues(env, ranges) {
  const params = new URLSearchParams();
  for (const range of ranges) params.append("ranges", range);
  params.set("majorDimension", "ROWS");
  params.set("valueRenderOption", "UNFORMATTED_VALUE");
  const json = await sheetsFetch(env, `/values:batchGet?${params.toString()}`);
  return (json.valueRanges || []).map((item) => item.values || []);
}

export async function getValues(env, range) {
  const json = await sheetsFetch(env, `/values/${encodeURIComponent(range)}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`);
  return json.values || [];
}

export async function appendValues(env, range, values) {
  const json = await sheetsFetch(
    env,
    `/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { method: "POST", body: JSON.stringify({ majorDimension: "ROWS", values }) },
  );
  return json;
}

export async function updateValues(env, range, values) {
  return sheetsFetch(
    env,
    `/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    { method: "PUT", body: JSON.stringify({ majorDimension: "ROWS", values }) },
  );
}

export async function formatOfficialRow(env, rowNumber) {
  if (!rowNumber) return;
  const requests = [
    {
      repeatCell: {
        range: {
          sheetId: Number(env.LANCAMENTOS_SHEET_ID || 120000004),
          startRowIndex: rowNumber - 1,
          endRowIndex: rowNumber,
          startColumnIndex: 4,
          endColumnIndex: 7,
        },
        cell: { userEnteredFormat: { numberFormat: { type: "CURRENCY", pattern: "R$ #,##0.00" } } },
        fields: "userEnteredFormat.numberFormat",
      },
    },
    {
      repeatCell: {
        range: {
          sheetId: Number(env.LANCAMENTOS_SHEET_ID || 120000004),
          startRowIndex: rowNumber - 1,
          endRowIndex: rowNumber,
          startColumnIndex: 7,
          endColumnIndex: 8,
        },
        cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "0.00" } } },
        fields: "userEnteredFormat.numberFormat",
      },
    },
  ];
  await sheetsFetch(env, ":batchUpdate", { method: "POST", body: JSON.stringify({ requests }) });
}

export function rowNumberFromUpdatedRange(updatedRange = "") {
  const match = String(updatedRange).match(/![A-Z]+(\d+):[A-Z]+(\d+)$/i);
  return match ? Number(match[1]) : null;
}

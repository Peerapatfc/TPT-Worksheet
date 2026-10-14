import 'dotenv/config';
import { google } from 'googleapis';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
const out = process.argv[2];
const sets = { halloween: '1raWn9lDjyhf9235Yqbjuo-TTChBg_W1Z', autumn: '1UlSvnm4vFSDXp7H-W1aNnRcpTEKxCUE_', spiders: '1TopUkOx7eEX3-tsL1b-zb7xO12RHbGDi' };
const auth = new google.auth.OAuth2(process.env.GOOGLE_OAUTH_CLIENT_ID, process.env.GOOGLE_OAUTH_CLIENT_SECRET);
auth.setCredentials({ refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN });
const drive = google.drive({ version: 'v3', auth });
for (const [name, id] of Object.entries(sets)) {
  const dir = path.join(out, name); fs.mkdirSync(dir, { recursive: true });
  const { data } = await drive.files.list({ q: `'${id}' in parents and trashed=false`, fields: 'files(id,name,mimeType)', pageSize: 200 });
  for (const f of data.files) {
    if (!/png|json|text/.test(f.mimeType)) continue;
    const r = await drive.files.get({ fileId: f.id, alt: 'media' }, { responseType: 'arraybuffer' });
    const buf = Buffer.from(r.data);
    const base = f.name.replace(/(\.png)+$/, '');
    if (f.mimeType === 'image/png') await sharp(buf).resize({ width: 900 }).jpeg({ quality: 85 }).toFile(path.join(dir, base + '.jpg'));
    else fs.writeFileSync(path.join(dir, f.name), buf);
  }
  console.log(name, data.files.length);
}

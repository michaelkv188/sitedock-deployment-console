# SiteDock

SiteDock is a self-hosted deployment dashboard for static website ZIP files. Upload a ZIP, publish it at a unique URL, inspect its folder structure and source files, preview it in a sandboxed browser frame, replace the ZIP, download the original, rename it, or delete it.

## Included features

- Drag-and-drop `.zip` deployment
- Unique live URL for every website
- Automatic handling of ZIPs wrapped in one parent folder
- `index.html` validation
- File explorer and source-code viewer
- Image preview
- Sandboxed live preview
- Replace/redeploy, rename, download, and delete controls
- Optional dashboard password
- ZIP-slip, symlink, file-count, upload-size, and extracted-size protections
- Render blueprint and Docker support

## Website ZIP format

Your ZIP should contain a static website:

```text
index.html
styles.css
script.js
images/
```

A single wrapper folder is also accepted:

```text
my-website/
  index.html
  styles.css
```

Server-side PHP, Python, databases, and Node applications are not executed. SiteDock hosts static HTML/CSS/JavaScript sites.

## Run locally

1. Install Node.js 20 or newer.
2. Open a terminal in this folder.
3. Run:

```bash
npm install
ADMIN_PASSWORD="choose-a-password" npm start
```

Open `http://localhost:3000`.

On Windows PowerShell:

```powershell
npm install
$env:ADMIN_PASSWORD="choose-a-password"
npm start
```

## Deploy to Render

1. Put this project in a GitHub repository.
2. In Render, create a new Blueprint or Node web service from the repository.
3. Set `ADMIN_PASSWORD` to a strong private password.
4. Use `npm install` as the build command and `npm start` as the start command.
5. Attach a persistent disk at `/var/data` and set `DATA_DIR=/var/data`.

The included `render.yaml` configures the service and a 1 GB disk. Persistent disks require a paid Render web service. Without a persistent disk, uploaded sites can disappear when the service restarts or redeploys.

## Deploy with Docker

```bash
docker build -t sitedock .
docker run --rm -p 3000:3000 \
  -e ADMIN_PASSWORD="choose-a-password" \
  -e DATA_DIR=/data \
  -v sitedock-data:/data \
  sitedock
```

## Important security note

SiteDock is intended for websites you trust. The inspector preview uses an iframe sandbox, but published sites are still arbitrary HTML and JavaScript served by your server. For a public multi-user platform, isolate deployed sites on a separate wildcard domain and move files to object storage.

## Limits

- ZIP upload: 50 MB
- Extracted size: 250 MB
- ZIP entries: 5,000
- Text-file inspection: 2 MB per file

Change the constants near the top of `server.js` to adjust these limits.

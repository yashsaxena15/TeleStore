# Distributed Leech Worker Architecture

TelegramFileServer features a **flexible, auto-balancing distributed worker architecture**. It works seamlessly on a **single standalone VM** out of the box, and can instantly scale horizontally to **multiple VMs** to multiply download and upload bandwidth.

---

## 1. Single VM Mode (Default / Standalone)

If you only have one server (e.g. 1 VPS):
- **No extra setup is required.**
- The master server handles web requests, database operations, and processes background cloud transfers locally using its configured Telegram bot pool.
- All transfers (direct URLs, Google Drive, torrents) run directly on the master instance.

---

## 2. Multi-VM Distributed Mode (High Bandwidth / Multi-Cloud)

Cloud providers often cap VPS network cards at 50–100 Mbps (5–12 MB/s). By adding 1 or more cheap secondary VPS instances (even 1 GB RAM micro instances), you can:
- **Multiply leech speeds**: 2 VMs = ~12 MB/s (100 Mbps), 4 VMs = ~25 MB/s (200 Mbps).
- **Parallel Multi-Range Chunking**: A single 10 GB file is sliced into parallel HTTP byte-range parts (e.g. VM 1 downloads Part 1, VM 2 downloads Part 2 concurrently).
- **Torrents on every machine**: the master splits a torrent into one transfer per file, and each machine takes files, so a torrent with several files downloads on several machines at once (see below).
- **Auto-Failover**: If any worker VM goes offline, the master watchdog automatically re-queues its tasks without losing progress.

---

## Files on a worker machine

A worker runs `worker.py` with `transfer_core.py` beside it. That second file is
`telestore/transfer_core.py` from this repo, shared with the main server (download checks,
speeds, Google's per-file limit, Telegram's rate limit): copy both whenever either changes.
Logs are kept in `logs/worker.log` next to them (5 files of 10 MB), across restarts.

---

## Torrents and magnets

- **The master reads every torrent.** For a magnet it first gets the file list from the torrent's
  peers. It then splits the torrent into **one transfer per file**, shown as one group in
  Transfers. Empty files are saved straight away.
- **Any machine can take a file.** That's the master or a worker that has **aria2c**. Each file is
  downloaded on its own (`--select-file`) and saved to Telegram as soon as it's done. A file
  bigger than 1.95 GB goes in parts.
- **No seeding.** Every machine runs aria2c with the same settings, defined in
  `transfer_core.aria2_args`:
  - uploads to other peers are capped at 1 KB/s while downloading. 0 would mean "no limit" to
    aria2c, and a peer that shares nothing gets stalled;
  - there's no seeding once a file is done (`--seed-time=0`).
- **aria2c comes from Ubuntu's own packages** (`sudo apt install aria2`; `setup_worker.sh`
  installs it). It's a standalone program, outside the worker's Python virtual environment.
- **A worker without aria2c is never given a torrent file.** A worker tells the master what it can
  do each time it asks for work (`"skills": ["torrent"]`).
- **Speed:** two machines can download two files of the same torrent at once. One very large file
  still downloads on one machine. Extra speed also depends on the torrent having enough peers.

---

## How to Add a Worker VM (3 Simple Steps)

### Step 1: Ensure Master has a Secret Key
In your Master server's `.env`, set:
```bash
WORKER_SECRET_KEY=your_secure_random_key_here
# Optional: number of tasks the Master processes locally (default: 1)
MAX_LOCAL_CONCURRENT=1
```

### Step 2: Run Auto-Installer on the Worker VM
SSH into your second (or third) VPS and run:
```bash
# Clone the repository or copy the worker/ folder
git clone https://github.com/your-username/TelegramFileServer.git
cd TelegramFileServer/worker

# Run the installer
sudo bash setup_worker.sh "https://your-master-domain.com" "your_secure_random_key_here" "vm2-mumbai"
```

The installer saves configuration to `/etc/tele_worker.env` (with `600` permissions) and loads it into systemd via `EnvironmentFile=/etc/tele_worker.env` so credentials are never visible in `ps aux` or process listings.

### Step 3: Verify Connection
You can check the worker status on the worker VPS:
```bash
sudo systemctl status tele_worker
sudo journalctl -u tele_worker -f
```

And check active nodes from the Master server:
```bash
curl -H "X-Worker-Key: your_secure_random_key_here" https://your-master-domain.com/api/worker/nodes
```

---

## How Dynamic Load Balancing Works Under the Hood

```
                               ┌───► Master VM (Local Worker) ──► Telegram Cloud
                               │     (Claims Task via MongoDB)
User Leech Queue (MongoDB) ────┼───► Worker VM 2 (Mumbai)     ──► Telegram Cloud
                               │     (Polls Master REST API)
                               └───► Worker VM 3 (Optional)   ──► Telegram Cloud
```

1. **Atomic Claiming**: Workers poll `POST /api/worker/claim-task`. MongoDB atomically assigns the next queued task using `find_one_and_update`. A worker with aria2c also takes torrent files and fetches the torrent's details from `GET /api/worker/torrent/{task_id}`.
2. **Dedicated Bot Tokens**: The master assigns dedicated bot tokens to workers so Telegram API rate limits don't clash.
3. **Pipelined Upload**: Workers stream and upload directly from the source to Telegram, bypassing the master's disk and network.
4. **Heartbeat & Watchdog**: Workers send a heartbeat every 15s. If a worker drops offline for >120s, the master re-queues its in-flight tasks.


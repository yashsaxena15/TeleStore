# Distributed Leech Worker Architecture

TelegramFileServer features a **flexible, auto-balancing distributed worker architecture**. It works seamlessly on a **single standalone VM** out of the box, and can instantly scale horizontally to **multiple VMs** to multiply download and upload bandwidth.

---

## 1. Single VM Mode (Default / Standalone)

If you only have one server (e.g. 1 VPS):
- **No extra setup is required.**
- The master server handles web requests, database operations, and processes background cloud transfers locally using its configured Telegram bot pool.
- All transfers (direct URLs, Google Drive, Torrents) run directly on the master instance.

---

## 2. Multi-VM Distributed Mode (High Bandwidth / Multi-Cloud)

Cloud providers often cap VPS network cards at 50–100 Mbps (5–12 MB/s). By adding 1 or more cheap secondary VPS instances (even 1 GB RAM micro instances), you can:
- **Multiply leech speeds**: 2 VMs = ~12 MB/s (100 Mbps), 4 VMs = ~25 MB/s (200 Mbps).
- **Parallel Multi-Range Chunking**: A single 10 GB file is sliced into parallel HTTP byte-range parts (e.g. VM 1 downloads Part 1, VM 2 downloads Part 2 concurrently).
- **Auto-Failover**: If any worker VM goes offline, the master watchdog automatically re-queues its tasks without losing progress.

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

1. **Atomic Claiming**: Workers poll `POST /api/worker/claim-task`. MongoDB atomically assigns the next queued task using `find_one_and_update`.
2. **Dedicated Bot Tokens**: The master assigns dedicated bot tokens to workers so Telegram API rate limits don't clash.
3. **Pipelined Upload**: Workers stream and upload directly from the source to Telegram, bypassing the master's disk and network.
4. **Heartbeat & Watchdog**: Workers send a heartbeat every 15s. If a worker drops offline for >120s, the master re-queues its in-flight tasks.


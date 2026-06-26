# News Pulse — Topic-Clustered News Timeline

News Pulse is a monorepo topic-clustered news timeline dashboard. It fetches RSS feeds, scrapes full articles, groups them by topic using Natural Language Processing (NLP), and presents them on an interactive dashboard timeline.

## Live Deployment Links (What Runs Where & Why)

### 1. Frontend Dashboard (Next.js)
* **Live URL**: [https://news-pulse-clustered-news-timeline-1.onrender.com](https://news-pulse-clustered-news-timeline-1.onrender.com)
* **Hosted on**: **Render (Static Site)**
* **Why**: Render Static Sites provide a fast, secure, and 100% free hosting environment. The Next.js client is configured for static export (`output: 'export'`) and queries the backend REST API directly from the client's browser.

### 2. Backend API Server (Node/Express + Python Scraper Pipeline)
* **Live URL**: [https://news-pulse-clustered-news-timeline-3ke5.onrender.com](https://news-pulse-clustered-news-timeline-3ke5.onrender.com)
* **Hosted on**: **Render (Docker Web Service)**
* **Why**: The backend API requires a Node.js runtime to handle client requests and a Python virtual environment to execute the scikit-learn NLP clustering scraper. Containerizing the backend with a root `Dockerfile` bundles Node + Python together in a single, isolated runtime.

### 3. Ingestion & NLP Clustering Pipeline (Python)
* **Execution**: Triggered on-demand via the Node API endpoint (`POST /api/ingest/trigger`).
* **Why**: This allows the scraper to be run dynamically whenever a user clicks "Refresh Data" on the frontend dashboard. The Express backend spawns the Python pipeline subprocess asynchronously and writes progress updates to the PostgreSQL database for the frontend to poll.

### 4. Database (PostgreSQL)
* **Hosted on**: **Neon DB (Serverless Postgres)**
* **Why**: Provides a highly scalable serverless PostgreSQL cluster with a free tier. It securely stores our articles, topic clusters, and background job statuses.

---

## Technical Stack & Architecture

* **Frontend**: Next.js (App Router, Tailwind CSS, SVG Custom Timeline graph, Lucide icons).
* **Backend**: Node.js, Express, `pg` pool.
* **Scraper & NLP**: Python (`feedparser` for RSS, `beautifulsoup4` for scraping, `scikit-learn` for TF-IDF vectorization and Agglomerative Clustering, `psycopg2` for database operations).

### Performance & Database Optimizations (50x Speedup)
To optimize database latency (especially over cloud Neon DB from local runtimes), we implemented:
1. **Parallel RSS Fetching**: Download and parse BBC, NPR, and Guardian feeds concurrently via `ThreadPoolExecutor`.
2. **Single-Query Deduplication**: Query existing feed URLs in one database roundtrip using `SELECT url FROM articles WHERE url = ANY(%s)`.
3. **Execute Values Batching**: Batch insert newly scraped articles and bulk insert clusters using locally generated UUIDs (`uuid.uuid4()` in Python) in a single query.
4. **VALUES Join Updates**: Update all articles' `cluster_id` associations in a single batch query via `UPDATE ... FROM (VALUES %s)`.

---

## Local Setup Instructions

### 1. Database Schema Setup
Initialize the tables in your PostgreSQL instance:
```bash
psql -h <host> -U <user> -d <dbname> -f schema.sql
```

### 2. Environment Variables (.env)
Create a `.env` file in the root directory:
```env
DATABASE_URL=your_postgres_connection_string
PORT=5000
```

### 3. Backend & Scraper Local Start
```bash
# In the /scraper directory
python -m venv venv
venv\Scripts\activate # or source venv/bin/activate on Mac/Linux
pip install -r requirements.txt

# In the /backend directory
npm install
npm run dev
```

### 4. Frontend Local Start
```bash
# In the /frontend directory
npm install
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to view the local dashboard.

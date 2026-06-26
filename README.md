# News Pulse: Topic-Clustered News Timeline

News Pulse is a full-stack monorepo system designed to parse live articles from multiple global RSS feeds (BBC, NPR, and The Guardian), scrape their full-text bodies, automatically cluster them into logical topic stories using TF-IDF and Agglomerative Clustering, and visualize them on an interactive timeline dashboard.

This project was built for the **XPONENTIUM INDIA Full-Stack Developer Internship Technical Assessment**.

---

## 🏗️ Architecture & Component Flow

The monorepo is split into three clean layers:
1. **Scraper Pipeline (`/scraper`)**: A Python pipeline that executes RSS ingestion, fetches full-text HTML content, runs the NLP text clustering, and writes everything directly to PostgreSQL.
2. **Backend API (`/backend`)**: A Node.js/Express REST server that serves clusters, articles, and formatted timeline ranges, and triggers the Python pipeline asynchronously as a subprocess.
3. **Frontend Dashboard (`/frontend`)**: A Next.js (App Router) React application styled with Tailwind CSS, utilizing a custom-built, channel-routed interactive SVG timeline.

```
                    ┌────────────────────────┐
                    │  BBC, NPR, Guardian    │
                    │       RSS Feeds        │
                    └───────────┬────────────┘
                                │ (Feedparser Ingest)
                                ▼
  ┌──────────────┐      ┌──────────────┐      ┌──────────────┐
  │  Next.js UI  ├─────►│ Express API  ├─────►│ Python venv  │
  │  (Port 3000) │      │ (Port 5000)  │      │  Pipeline    │
  └──────┬───────┘      └──────┬───────┘      └──────┬───────┘
         │                     │                     │
         │                     ▼                     │
         │             ┌──────────────┐              │
         └────────────►│  PostgreSQL  │◄─────────────┘
                       │ (Neon/Cloud) │
                       └──────────────┘
```

---

## 📈 Technical Assessment Q&A (Part 1 Rubric)

### 1. Which approach did you use for topic grouping and why?
We chose **Option B (TF-IDF Vectorization + Cosine Similarity with Agglomerative Clustering)**:
* **Why**: Unlike keyword overlap which does not scale well and weights all words equally, TF-IDF (Term Frequency-Inverse Document Frequency) discounts common words across all articles (like "news", "today", "breaking") and prioritizes unique, content-heavy keywords.
* **Algorithm**: We used scikit-learn's `AgglomerativeClustering` with a precomputed cosine distance matrix (`1 - cosine_similarity`). This performs bottom-up hierarchical clustering which is ideal when the total number of clusters ($K$) is unknown beforehand.
* **Centroid Headline Labeling**: To make labels human-readable, we calculate the average TF-IDF vector of each cluster (the centroid) and select the headline of the article closest to the centroid as the cluster label. This results in natural, cohesive headlines instead of a random bag of words.

### 2. How did you pick your thresholds/parameters?
* **Clustering Distance Threshold**: We set the distance threshold to `0.65` (which corresponds to a Cosine Similarity of `0.35` or higher).
  * *Reasoning*: A similarity threshold of `0.35` ensures articles sharing key subject nouns (e.g., "Trump", "trial", "hush-money") are grouped together, but prevents unrelated political news from merging.
* **Lookback Window**: The pipeline gathers and re-clusters articles published within the last **7 days**.
  * *Reasoning*: This handles sliding window timelines—new articles from a subsequent run are dynamically grouped into existing active clusters if they relate, rather than freezing them.

### 3. What is one limitation of your approach that you noticed?
* **Semantic Blindness**: TF-IDF relies on exact term matching. It is blind to semantic synonyms. For instance, an article with the title *"Biden addresses inflation"* and another with *"US President talks about rising cost of living"* might have a cosine similarity below our `0.35` threshold and fail to cluster, despite describing the exact same event.
* **Mitigation (Future Work)**: In a production system, we would replace TF-IDF with dense word embeddings from a transformer model (like Sentence-Transformers/SBERT) and cluster using HDBSCAN.

---

## 🔌 API Endpoints (Part 2 Rubric)

* **`GET /api/clusters`**: Returns a list of active topic clusters, their article count, and the date boundaries (earliest and latest article published).
* **`GET /api/clusters/:id`**: Returns full metadata of a specific cluster and its articles sorted chronologically.
* **`GET /api/timeline`**: Returns formatted time windows tailored for charts (id, label, start_time, end_time, article_count, source lists, and calculated intensity).
* **`POST /api/ingest/trigger`**: Spawns `python pipeline.py <job_id>` asynchronously, writes a record to `ingestion_jobs`, and returns the `jobId` immediately.
* **`GET /api/ingest/status/:jobId`**: Returns status (`pending`, `processing`, `completed`, `failed`) and errors.

---

## 🖥️ Frontend Features & Layout (Part 3 Rubric)

* **Interactive Lane SVG Timeline**: Rather than a simple chronological list, we built a channel-routed lane algorithm in React. It maps each cluster as a horizontal range pill. Overlapping ranges are automatically placed in separate vertical lanes, visually representing "active windows of stories".
* **Visual Intensity Metric**: The opacity and color of timeline range pills scale dynamically with the cluster's sizing/intensity (computed by combining article volume and diversity of news outlets).
* **Sliding Detail Drawer**: Clicking any cluster slides a right drawer containing the chronological article list, showing badges for BBC, NPR, or The Guardian, summaries, and links to the source.
* **Dynamic Feed Filtering**: Source filters (BBC, NPR, Guardian) dynamically filter clusters on the timeline.
* **Worker Polling Status Bar**: Clicking "Refresh Data" starts a job, shows an active processing spinner with status logs, and updates the timeline instantly upon completion.

---

## 🚀 Future Improvements (Technical Roadmap)

While this MVP implements all required specifications, the architecture is designed to scale with the following next-step enhancements:

1. **User Authentication & Role-Based Access Control (RBAC)**:
   * Implement **Supabase Auth** or **NextAuth.js** to allow users to save their customized dashboard layouts, bookmark news clusters, and restrict the write action `/api/ingest/trigger` endpoint to admins.
2. **Semantic Clustering (Deep Learning Embeddings)**:
   * Replace TF-IDF vectorization with **Sentence-Transformers/SBERT** sentence embeddings. This will resolve "Semantic Blindness" by grouping articles that share concepts but not matching words (e.g. *"Rate hikes expected by Central Bank"* and *"Powell hints at tightening monetary policy"*).
3. **Automated Scraping Cron Scheduler**:
   * Integrate a cron scheduler (e.g. via **GitHub Actions Cron** or a background worker queue like **BullMQ** or **Celery** with Redis) to execute `pipeline.py` every 3 hours automatically, instead of relying purely on on-demand frontend triggers.
4. **Real-time Subprocess Updates via Server-Sent Events (SSE)**:
   * Transition from client-side HTTP polling (`GET /api/ingest/status/:jobId`) to a server-push mechanism like SSE or WebSockets to stream live subprocess logs directly from the Python terminal to the frontend in real time.

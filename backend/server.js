const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const db = require('./db');

const app = express();
const port = process.env.PORT || 10000;

// Enable CORS so the Next.js frontend can connect
app.use(cors());
app.use(express.json());

// Log requests
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// GET /clusters - List of clusters with article counts and time ranges
app.get('/api/clusters', async (req, res) => {
  try {
    const queryText = `
      SELECT 
        c.id, 
        c.label, 
        c.article_count, 
        c.status, 
        c.created_at, 
        c.updated_at,
        MIN(a.published_at) as earliest_article,
        MAX(a.published_at) as latest_article
      FROM clusters c
      LEFT JOIN articles a ON a.cluster_id = c.id
      GROUP BY c.id
      ORDER BY latest_article DESC NULLS LAST
    `;
    const result = await db.query(queryText);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching clusters:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /clusters/:id - Full details of a cluster and its articles (sorted chronologically)
app.get('/api/clusters/:id', async (req, res) => {
  const clusterId = req.params.id;
  try {
    const clusterResult = await db.query('SELECT * FROM clusters WHERE id = $1', [clusterId]);
    if (clusterResult.rows.length === 0) {
      return res.status(404).json({ error: 'Cluster not found' });
    }

    const articlesResult = await db.query(
      `SELECT id, source, title, summary, url, published_at, created_at 
       FROM articles 
       WHERE cluster_id = $1 
       ORDER BY published_at ASC`,
      [clusterId]
    );

    const cluster = clusterResult.rows[0];
    cluster.articles = articlesResult.rows;

    res.json(cluster);
  } catch (err) {
    console.error('Error fetching cluster details:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /timeline - Structured timeline data
app.get('/api/timeline', async (req, res) => {
  try {
    const queryText = `
      SELECT 
        c.id, 
        c.label, 
        c.article_count,
        MIN(a.published_at) as start_time,
        MAX(a.published_at) as end_time,
        array_agg(DISTINCT a.source) as sources
      FROM clusters c
      INNER JOIN articles a ON a.cluster_id = c.id
      GROUP BY c.id
      ORDER BY start_time ASC
    `;
    const result = await db.query(queryText);
    
    // Format for charts & compute custom intensity score
    const timelineData = result.rows.map(row => {
      const start = new Date(row.start_time).getTime();
      const end = new Date(row.end_time).getTime();
      const durationHours = Math.max(1, (end - start) / (1000 * 60 * 60));
      
      // Sizing/Intensity based on count and source diversity
      const uniqueSourcesCount = row.sources ? row.sources.length : 0;
      // Formula: higher count = higher intensity; higher diversity = higher intensity
      const articleIntensity = Math.min(1.0, row.article_count * 0.15);
      const sourceIntensity = uniqueSourcesCount / 3.0; // max 3 sources
      const intensity = parseFloat(((articleIntensity * 0.6) + (sourceIntensity * 0.4)).toFixed(2));
      
      return {
        id: row.id,
        label: row.label,
        start_time: row.start_time,
        end_time: row.end_time,
        article_count: parseInt(row.article_count, 10),
        sources: row.sources || [],
        intensity
      };
    });

    res.json(timelineData);
  } catch (err) {
    console.error('Error generating timeline:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /ingest/trigger - Asynchronously trigger Python scraping and clustering
app.post('/api/ingest/trigger', async (req, res) => {
  try {
    // Insert pending job record
    const jobResult = await db.query(
      "INSERT INTO ingestion_jobs (status) VALUES ('pending') RETURNING id"
    );
    const jobId = jobResult.rows[0].id;

    console.log(`Spawned ingestion job ${jobId}. Launching scraper subprocess...`);

    // Path to the Python pipeline
    const scriptPath = path.resolve(__dirname, '../scraper/pipeline.py');
    
    // Determine local virtual environment python path
    const isWindows = process.platform === 'win32';
    const localVenvPython = isWindows
      ? path.resolve(__dirname, '../scraper/venv/Scripts/python.exe')
      : path.resolve(__dirname, '../scraper/venv/bin/python');
      
    let pythonCmd = 'python';
    if (fs.existsSync(localVenvPython)) {
      pythonCmd = localVenvPython;
      console.log(`Using local virtual environment python: ${pythonCmd}`);
    } else {
      if (isWindows) {
        pythonCmd = 'py';
      }
      console.log(`Local virtual environment python not found at ${localVenvPython}. Falling back to global: ${pythonCmd}`);
    }

    // Spawn Python subprocess
    const pythonProcess = spawn(pythonCmd, [scriptPath, jobId], {
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1'
      }
    });

    // Handle spawn-level errors (e.g. Python executable not found)
    pythonProcess.on('error', async (err) => {
      console.error(`Failed to start scraper subprocess for job ${jobId}:`, err);
      try {
        await db.query(
          "UPDATE ingestion_jobs SET status = 'failed', error_message = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
          [err.message, jobId]
        );
      } catch (dbErr) {
        console.error('Failed to update job status on process launch error:', dbErr);
      }
    });

    // Capture logs (for server stdout debug, not blocking response)
    pythonProcess.stdout.on('data', (data) => {
      console.log(`[Python Stdout - ${jobId}]: ${data.toString().trim()}`);
    });

    pythonProcess.stderr.on('data', (data) => {
      console.error(`[Python Stderr - ${jobId}]: ${data.toString().trim()}`);
    });

    // Respond immediately with the jobId
    res.status(202).json({ 
      message: 'Ingestion job triggered successfully', 
      jobId 
    });

  } catch (err) {
    console.error('Error triggering ingestion:', err);
    res.status(500).json({ error: 'Failed to trigger ingestion job' });
  }
});

// GET /ingest/status/:jobId - Poll job status
app.get('/api/ingest/status/:jobId', async (req, res) => {
  const jobId = req.params.jobId;
  try {
    const result = await db.query(
      'SELECT id, status, error_message, created_at, updated_at FROM ingestion_jobs WHERE id = $1',
      [jobId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching job status:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('Unhandled Exception:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(port, () => {
  console.log(`News Pulse backend server running on http://localhost:${port}`);
});

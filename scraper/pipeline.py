import os
import sys
import re
import datetime
import requests
import feedparser
from bs4 import BeautifulSoup
import psycopg2
from psycopg2.extras import execute_values
from dotenv import load_dotenv
import numpy as np
from concurrent.futures import ThreadPoolExecutor
import uuid

def parse_single_feed(args):
    source, feed_url = args
    try:
        print(f"Parsing feed: {source} ({feed_url})")
        feed = feedparser.parse(feed_url)
        return source, feed
    except Exception as e:
        print(f"Error parsing feed {source}: {str(e)}")
        return source, None

# Load environment variables from parent directory if needed
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))
load_dotenv() # also load locally

# Scikit-learn imports
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.cluster import AgglomerativeClustering

# RSS Feed definitions
FEEDS = {
    'BBC': 'http://feeds.bbci.co.uk/news/rss.xml',
    'NPR': 'https://feeds.npr.org/1001/rss.xml',
    'Guardian': 'https://www.theguardian.com/uk/rss'
}

# Create a shared requests Session with connection pooling
session = requests.Session()
session.headers.update({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
})

def get_db_connection():
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        raise ValueError("DATABASE_URL environment variable is not set")
    return psycopg2.connect(db_url)

def scrape_full_text_worker(item):
    """
    Worker task to scrape a single article page. Updates the item dict in-place.
    """
    url = item['url']
    try:
        response = session.get(url, timeout=5) # 5 seconds timeout
        if response.status_code != 200:
            item['full_text'] = item['summary']
            return item
        
        soup = BeautifulSoup(response.content, 'html.parser')
        
        # Remove script and style elements
        for script in soup(["script", "style", "header", "footer", "nav", "aside"]):
            script.decompose()
            
        # Extract text from paragraphs
        paragraphs = soup.find_all('p')
        text_content = []
        for p in paragraphs:
            text = p.get_text().strip()
            if len(text) > 40:
                text_content.append(text)
                
        if text_content:
            item['full_text'] = "\n".join(text_content)
        else:
            item['full_text'] = item['summary']
            
    except Exception as e:
        print(f"Error scraping {url}: {str(e)}")
        item['full_text'] = item['summary'] # Fallback to summary on error
        
    return item

def parse_published_date(entry, source):
    """
    Standardizes publishing dates to python datetime.
    """
    if 'published_parsed' in entry and entry.published_parsed:
        return datetime.datetime(*entry.published_parsed[:6], tzinfo=datetime.timezone.utc)
    elif 'updated_parsed' in entry and entry.updated_parsed:
        return datetime.datetime(*entry.updated_parsed[:6], tzinfo=datetime.timezone.utc)
    
    return datetime.datetime.now(datetime.timezone.utc)

def ingest_feeds():
    """
    Parses RSS feeds, scrapes full text concurrently in a ThreadPool, 
    and saves articles to PostgreSQL.
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    
    new_entries = []
    
    try:
        print("Checking RSS feeds for new stories...")
        # 1. Fetch feeds in parallel
        with ThreadPoolExecutor(max_workers=len(FEEDS)) as executor:
            parsed_feeds = list(executor.map(parse_single_feed, FEEDS.items()))
        
        # 2. Gather all URLs from parsed feeds
        all_feed_urls = []
        feed_entries_by_source = {}
        for source, feed in parsed_feeds:
            if not feed:
                continue
            feed_entries_by_source[source] = feed.entries
            for entry in feed.entries:
                url = entry.get('link', '')
                if url:
                    all_feed_urls.append(url)
                    
        # 3. Check which URLs already exist in the database in a single query
        existing_urls = set()
        if all_feed_urls:
            cursor.execute("SELECT url FROM articles WHERE url = ANY(%s)", (all_feed_urls,))
            for row in cursor.fetchall():
                existing_urls.add(row[0])
                
        # 4. Filter out existing articles and prepare entries to scrape
        for source, entries in feed_entries_by_source.items():
            new_source_count = 0
            for entry in entries:
                if new_source_count >= 15:
                    break
                    
                title = entry.get('title', '')
                url = entry.get('link', '')
                if not url or not title:
                    continue
                
                # Check against the pre-fetched set of existing URLs
                if url in existing_urls:
                    continue
                    
                summary = entry.get('summary', '') or entry.get('description', '')
                if summary:
                    summary = BeautifulSoup(summary, "html.parser").get_text()
                
                published_at = parse_published_date(entry, source)
                
                new_entries.append({
                    'source': source,
                    'title': title,
                    'summary': summary,
                    'url': url,
                    'published_at': published_at
                })
                new_source_count += 1
                
        if not new_entries:
            print("No new articles found. Database is already up to date.")
            return

        print(f"Found {len(new_entries)} new articles. Crawling full text concurrently...")
        
        # Scrape full text in parallel (using 8 workers for fast, overlapping requests)
        with ThreadPoolExecutor(max_workers=8) as executor:
            scraped_entries = list(executor.map(scrape_full_text_worker, new_entries))
            
        # 5. Bulk write to Database using execute_values
        inserted_count = 0
        if scraped_entries:
            articles_to_insert = [
                (item['source'], item['title'], item['summary'], item['full_text'], item['url'], item['published_at'])
                for item in scraped_entries
            ]
            
            # Use execute_values for efficient batch insert
            execute_values(
                cursor,
                """
                INSERT INTO articles (source, title, summary, full_text, url, published_at)
                VALUES %s
                ON CONFLICT (url) DO NOTHING
                """,
                articles_to_insert
            )
            inserted_count = len(scraped_entries)
                
        conn.commit()
        print(f"RSS Ingestion complete. Successfully ingested {inserted_count} new articles.")
        
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        cursor.close()
        conn.close()

def cluster_articles():
    """
    Retrieves recent articles, clusters them using TF-IDF and AgglomerativeClustering,
    and updates database clusters.
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        # Cluster articles published in the last 7 days
        time_window = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=7)
        
        cursor.execute(
            """
            SELECT id, title, summary, full_text, source, url, published_at 
            FROM articles 
            WHERE published_at >= %s
            """,
            (time_window,)
        )
        articles = cursor.fetchall()
        
        if not articles:
            print("No articles found in the last 7 days to cluster.")
            return
            
        if len(articles) < 2:
            print("Too few articles to cluster (minimum 2 needed). Creating single-article clusters.")
            art = articles[0]
            art_id = art[0]
            art_title = art[1]
            
            cursor.execute(
                "INSERT INTO clusters (label, article_count) VALUES (%s, 1) RETURNING id",
                (art_title[:255],)
            )
            cluster_id = cursor.fetchone()[0]
            cursor.execute("UPDATE articles SET cluster_id = %s WHERE id = %s", (cluster_id, art_id))
            conn.commit()
            return
            
        print(f"Clustering {len(articles)} articles from the last 7 days...")
        
        corpus = []
        for art in articles:
            title = art[1] or ""
            summary = art[2] or ""
            text = f"{title} {summary}"
            corpus.append(text)
            
        # TF-IDF Vectorization
        vectorizer = TfidfVectorizer(stop_words='english', max_df=0.9, min_df=1)
        tfidf_matrix = vectorizer.fit_transform(corpus)
        
        # Cosine Similarity
        cosine_sim = cosine_similarity(tfidf_matrix)
        
        # Convert similarity to distance matrix: Distance = 1 - Similarity
        distance_matrix = np.clip(1.0 - cosine_sim, 0.0, 1.0)
        
        # Agglomerative Clustering (Average linkage, similarity threshold 0.35 => distance 0.65)
        clustering = AgglomerativeClustering(
            metric='precomputed',
            linkage='average',
            distance_threshold=0.65,
            n_clusters=None
        )
        cluster_labels = clustering.fit_predict(distance_matrix)
        
        unique_labels = np.unique(cluster_labels)
        print(f"Generated {len(unique_labels)} clusters.")
        
        cluster_mappings = {}
        for idx, label in enumerate(cluster_labels):
            art_data = {
                'id': articles[idx][0],
                'title': articles[idx][1],
                'vector': tfidf_matrix[idx].toarray()[0],
                'published_at': articles[idx][6]
            }
            if label not in cluster_mappings:
                cluster_mappings[label] = []
            cluster_mappings[label].append(art_data)
            
        # 1. Nullify cluster_id for articles in the current time window
        art_ids_in_window = [art[0] for art in articles]
        cursor.execute(
            "UPDATE articles SET cluster_id = NULL WHERE id = ANY(%s::uuid[])",
            (art_ids_in_window,)
        )
        
        # 2. Prepare clusters and articles updates for batch inserting/updating
        clusters_to_insert = []
        article_updates = []
        
        for c_label, c_articles in cluster_mappings.items():
            count = len(c_articles)
            
            if count == 1:
                representative_headline = c_articles[0]['title']
            else:
                vectors = np.array([a['vector'] for a in c_articles])
                centroid = np.mean(vectors, axis=0).reshape(1, -1)
                
                best_idx = 0
                max_sim = -1.0
                for idx, art_item in enumerate(c_articles):
                    sim = cosine_similarity(art_item['vector'].reshape(1, -1), centroid)[0][0]
                    if sim > max_sim:
                        max_sim = sim
                        best_idx = idx
                representative_headline = c_articles[best_idx]['title']
            
            representative_headline = representative_headline[:255]
            
            # Generate a new UUID for the cluster locally
            cluster_id = str(uuid.uuid4())
            
            # Prepare cluster tuple: (id, label, article_count, status, updated_at)
            clusters_to_insert.append((
                cluster_id, 
                representative_headline, 
                count, 
                'active', 
                datetime.datetime.now(datetime.timezone.utc)
            ))
            
            # Prepare article updates
            for a in c_articles:
                article_updates.append((a['id'], cluster_id))
                
        # 3. Bulk insert clusters
        if clusters_to_insert:
            execute_values(
                cursor,
                """
                INSERT INTO clusters (id, label, article_count, status, updated_at)
                VALUES %s
                """,
                clusters_to_insert
            )
            
        # 4. Bulk update articles in a single query
        if article_updates:
            execute_values(
                cursor,
                """
                UPDATE articles AS a
                SET cluster_id = u.cluster_id::uuid
                FROM (VALUES %s) AS u(article_id, cluster_id)
                WHERE a.id = u.article_id::uuid
                """,
                article_updates
            )
            
        # Clean up empty/orphaned clusters
        cursor.execute(
            """
            DELETE FROM clusters 
            WHERE id NOT IN (
                SELECT DISTINCT cluster_id 
                FROM articles 
                WHERE cluster_id IS NOT NULL
            )
            """
        )
        
        conn.commit()
        print("Clustering complete and saved to database successfully.")
        
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        cursor.close()
        conn.close()

def update_job_status(job_id, status, error_message=None):
    """
    Updates the status of the ingestion job in PostgreSQL.
    """
    if not job_id:
        return
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            UPDATE ingestion_jobs 
            SET status = %s, error_message = %s, updated_at = CURRENT_TIMESTAMP 
            WHERE id = %s
            """,
            (status, error_message, job_id)
        )
        conn.commit()
        cursor.close()
        conn.close()
    except Exception as e:
        print(f"Error updating job status: {str(e)}")

def main():
    job_id = sys.argv[1] if len(sys.argv) > 1 else None
    
    if job_id:
        print(f"Running job: {job_id}")
        update_job_status(job_id, "processing")
        
    try:
        ingest_feeds()
        cluster_articles()
        
        if job_id:
            update_job_status(job_id, "completed")
            print(f"Job {job_id} marked as completed.")
            
    except Exception as e:
        import traceback
        err_msg = traceback.format_exc()
        print(f"Pipeline execution failed:\n{err_msg}")
        if job_id:
            update_job_status(job_id, "failed", err_msg)
        sys.exit(1)

if __name__ == '__main__':
    main()

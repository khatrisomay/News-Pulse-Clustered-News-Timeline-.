'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  RefreshCw, 
  Filter, 
  ExternalLink, 
  Clock, 
  BookOpen, 
  TrendingUp, 
  AlertCircle, 
  X, 
  ChevronRight, 
  CheckCircle,
  Database,
  Calendar,
  Layers,
  Search
} from 'lucide-react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:5000/api';

interface Article {
  id: string;
  source: string;
  title: string;
  summary: string;
  url: string;
  published_at: string;
}

interface Cluster {
  id: string;
  label: string;
  article_count: number;
  status: string;
  earliest_article: string;
  latest_article: string;
  articles?: Article[];
}

interface TimelineItem {
  id: string;
  label: string;
  start_time: string;
  end_time: string;
  article_count: number;
  sources: string[];
  intensity: number;
}

interface JobStatus {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error_message?: string;
}

export default function Dashboard() {
  // Data States
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [timelineItems, setTimelineItems] = useState<TimelineItem[]>([]);
  const [selectedCluster, setSelectedCluster] = useState<Cluster | null>(null);
  
  // App States
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [backendConnected, setBackendConnected] = useState<boolean | null>(null);
  const [takingLonger, setTakingLonger] = useState(false);
  
  // Search & Filtering States
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSources, setSelectedSources] = useState({
    BBC: true,
    NPR: true,
    Guardian: true
  });

  // Hover Tooltip States
  const [hoveredItem, setHoveredItem] = useState<TimelineItem | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  // Ingestion Job States
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [polling, setPolling] = useState(false);

  // Layout Ref for Timeline Width
  const timelineRef = useRef<HTMLDivElement>(null);
  const [timelineWidth, setTimelineWidth] = useState(800);

  // Fetch Clusters & Timeline Data
  const fetchData = async () => {
    setLoading(true);
    setTakingLonger(false);
    const timer = setTimeout(() => {
      setTakingLonger(true);
    }, 4000);

    try {
      const connCheck = await fetch(`${API_BASE}/clusters`).catch(() => null);
      if (!connCheck) {
        setBackendConnected(false);
        setError("Cannot connect to backend server. Make sure the Node.js backend is running on port 5000.");
        setLoading(false);
        clearTimeout(timer);
        return;
      }
      setBackendConnected(true);

      const [clustersRes, timelineRes] = await Promise.all([
        fetch(`${API_BASE}/clusters`),
        fetch(`${API_BASE}/timeline`)
      ]);

      const clustersData = await clustersRes.json();
      const timelineData = await timelineRes.json();

      setClusters(clustersData);
      setTimelineItems(timelineData);
      setError(null);
    } catch (err) {
      console.error(err);
      setError("Failed to fetch data from backend API.");
    } finally {
      clearTimeout(timer);
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // Track timeline width
    if (timelineRef.current) {
      setTimelineWidth(timelineRef.current.offsetWidth);
    }
    const handleResize = () => {
      if (timelineRef.current) {
        setTimelineWidth(timelineRef.current.offsetWidth);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Poll Job Status
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (polling && jobId) {
      const checkStatus = async () => {
        try {
          const res = await fetch(`${API_BASE}/ingest/status/${jobId}`);
          if (res.ok) {
            const data: JobStatus = await res.json();
            setJobStatus(data);
            if (data.status === 'completed') {
              setPolling(false);
              setJobId(null);
              fetchData(); // Refresh page contents
            } else if (data.status === 'failed') {
              setPolling(false);
              setJobId(null);
            }
          }
        } catch (err) {
          console.error("Polling error:", err);
        }
      };

      timer = setInterval(checkStatus, 1500);
    }
    return () => clearInterval(timer);
  }, [polling, jobId]);

  // Trigger ingestion
  const handleRefreshData = async () => {
    if (polling) return;
    setPolling(true);
    setJobStatus({ id: '', status: 'pending' });
    try {
      const res = await fetch(`${API_BASE}/ingest/trigger`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setJobId(data.jobId);
        setJobStatus({ id: data.jobId, status: 'pending' });
      } else {
        setPolling(false);
        setJobStatus(null);
        alert("Failed to start ingestion job.");
      }
    } catch (err) {
      console.error(err);
      setPolling(false);
      setJobStatus(null);
      alert("Failed to connect to backend server.");
    }
  };

  // Get Detailed Cluster Articles when clicked
  const handleClusterClick = async (clusterId: string) => {
    try {
      const res = await fetch(`${API_BASE}/clusters/${clusterId}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedCluster(data);
      }
    } catch (err) {
      console.error("Error fetching cluster details:", err);
    }
  };

  const toggleSource = (source: 'BBC' | 'NPR' | 'Guardian') => {
    setSelectedSources(prev => ({
      ...prev,
      [source]: !prev[source]
    }));
  };

  // Filtering Logic
  const filteredTimelineItems = useMemo(() => {
    return timelineItems.filter(item => {
      // Source filter
      const matchesSource = item.sources.some(src => {
        if (src === 'BBC' && selectedSources.BBC) return true;
        if (src === 'NPR' && selectedSources.NPR) return true;
        if (src === 'Guardian' && selectedSources.Guardian) return true;
        return false;
      });

      // Search query filter
      const matchesSearch = item.label.toLowerCase().includes(searchQuery.toLowerCase());

      return matchesSource && matchesSearch;
    });
  }, [timelineItems, selectedSources, searchQuery]);

  // Filtered clusters list for grid card listing below
  const filteredClusters = useMemo(() => {
    return clusters.filter(cluster => {
      // We check if cluster exists in the filtered timeline list
      return filteredTimelineItems.some(item => item.id === cluster.id);
    });
  }, [clusters, filteredTimelineItems]);

  // Calculate layout coordinates for SVG Timeline
  const timelineLayout = useMemo(() => {
    if (filteredTimelineItems.length === 0) return { items: [], minTime: 0, maxTime: 0, lanesCount: 0 };

    const itemsWithTimes = filteredTimelineItems.map(item => ({
      ...item,
      startMs: new Date(item.start_time).getTime(),
      endMs: new Date(item.end_time).getTime(),
    }));

    // Sort by start time
    itemsWithTimes.sort((a, b) => a.startMs - b.startMs);

    // Compute absolute time boundaries
    const minTime = Math.min(...itemsWithTimes.map(i => i.startMs));
    const maxTime = Math.max(...itemsWithTimes.map(i => i.endMs));

    // Channel routing algorithm to assign lanes without overlap
    const lanes: number[] = []; // Stores latest endMs for each lane
    const buffer = 30 * 60 * 1000; 

    const itemsWithLanes = itemsWithTimes.map(item => {
      let laneIndex = 0;
      while (laneIndex < lanes.length && lanes[laneIndex] + buffer > item.startMs) {
        laneIndex++;
      }
      lanes[laneIndex] = Math.max(item.endMs, item.startMs + buffer);
      return { ...item, lane: laneIndex };
    });

    return {
      items: itemsWithLanes,
      minTime,
      maxTime,
      lanesCount: lanes.length
    };
  }, [filteredTimelineItems]);

  // Generate X-axis ticks (Dates)
  const timeTicks = useMemo(() => {
    const { minTime, maxTime } = timelineLayout;
    if (!minTime || !maxTime) return [];

    const ticks = [];
    const span = maxTime - minTime;
    const numTicks = 5;

    for (let i = 0; i < numTicks; i++) {
      const time = minTime + (span * i) / (numTicks - 1);
      ticks.push(new Date(time));
    }
    return ticks;
  }, [timelineLayout]);

  const formatTickDate = (date: Date) => {
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  };

  // Red theme badge matching
  const getSourceBadgeColor = (source: string) => {
    switch (source) {
      case 'BBC': return 'bg-red-950/40 text-red-400 border-red-900/30';
      case 'NPR': return 'bg-red-950/20 text-red-300 border-red-900/20';
      case 'Guardian': return 'bg-red-950/30 text-red-500 border-red-900/25';
      default: return 'bg-neutral-900 text-neutral-400 border-neutral-800/80';
    }
  };

  // High contrast shades of red for timeline nodes
  const getNodeColor = (item: TimelineItem, isSelected: boolean, isHovered: boolean) => {
    // If mixed sources: Amber (Warning/High Volume trend indicator)
    if (item.sources.length > 1) {
      return isSelected 
        ? 'fill-amber-500 stroke-amber-300 shadow-md shadow-amber-500/30' 
        : isHovered 
        ? 'fill-amber-400 stroke-amber-200' 
        : 'fill-amber-500/80 stroke-amber-500/30 hover:fill-amber-400';
    }
    
    const source = item.sources[0];
    if (source === 'BBC') {
      return isSelected 
        ? 'fill-rose-500 stroke-rose-300 shadow-md shadow-rose-500/30' 
        : isHovered 
        ? 'fill-rose-400 stroke-rose-200' 
        : 'fill-rose-500/80 stroke-rose-500/30 hover:fill-rose-450';
    } else if (source === 'NPR') {
      return isSelected 
        ? 'fill-sky-500 stroke-sky-300 shadow-md shadow-sky-500/30' 
        : isHovered 
        ? 'fill-sky-400 stroke-sky-200' 
        : 'fill-sky-500/80 stroke-sky-500/30 hover:fill-sky-400';
    } else {
      // Guardian
      return isSelected 
        ? 'fill-emerald-500 stroke-emerald-300 shadow-md shadow-emerald-500/30' 
        : isHovered 
        ? 'fill-emerald-400 stroke-emerald-200' 
        : 'fill-emerald-500/80 stroke-emerald-500/30 hover:fill-emerald-400';
    }
  };

  return (
    <div className="min-h-screen bg-black text-neutral-200 flex flex-col font-sans select-none antialiased">
      {/* Background Soft Red Mesh overlay */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-red-950/10 rounded-full blur-[100px] pointer-events-none" />
      
      {/* Header */}
      <header className="sticky top-0 z-40 bg-neutral-950/90 backdrop-blur-md border-b border-neutral-900 px-6 py-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <div className="bg-red-600 p-2 rounded-xl text-white shadow-md shadow-red-600/30">
            <Layers className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
              News Pulse
            </h1>
            <p className="text-xs text-neutral-500 font-medium">Topic-Clustered News Timeline</p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-4">
          {backendConnected === false && (
            <div className="hidden md:flex items-center gap-2 text-xs bg-red-950/40 text-red-450 border border-red-900/30 px-3 py-1.5 rounded-lg">
              <AlertCircle className="w-4 h-4" />
              <span>Backend Offline</span>
            </div>
          )}

          {backendConnected === true && (
            <div className="hidden md:flex items-center gap-2 text-xs bg-neutral-900/60 text-neutral-400 border border-neutral-800/80 px-3 py-1.5 rounded-lg">
              <Database className="w-4 h-4 text-red-500" />
              <span>Connected</span>
            </div>
          )}

          <button
            onClick={handleRefreshData}
            disabled={polling}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-200 border ${
              polling
                ? 'bg-[#0a0a0a] text-neutral-500 border-neutral-900 cursor-not-allowed'
                : 'bg-red-600 text-white border-red-500 hover:bg-red-700 shadow-lg shadow-red-600/20 active:scale-95'
            }`}
          >
            <RefreshCw className={`w-4 h-4 ${polling ? 'animate-spin' : ''}`} />
            {polling ? 'Updating feeds...' : 'Refresh Data'}
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 flex flex-col gap-6">
        
        {/* Polling Job Info Overlay */}
        {polling && jobStatus && (
          <div className="bg-[#0a0a0a] border border-red-950/45 rounded-2xl p-4 flex flex-col md:flex-row items-center justify-between gap-4 shadow-xl">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="w-8 h-8 rounded-full border-2 border-red-600/20 border-t-2 border-t-red-600 animate-spin" />
              </div>
              <div>
                <p className="text-sm font-semibold text-neutral-200">
                  {jobStatus.status === 'pending' ? 'Job Initiated' : 'Ingesting & Clustering Feeds'}
                </p>
                <p className="text-xs text-neutral-500">
                  {jobStatus.status === 'pending' 
                    ? 'Preparing python workspace...' 
                    : 'Crawling BBC, NPR, and Guardian RSS feeds. Generating word embeddings.'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs bg-red-950/30 text-red-400 px-3 py-1.5 rounded-lg border border-red-900/20">
              <Clock className="w-3.5 h-3.5" />
              <span>Polling active...</span>
            </div>
          </div>
        )}

        {/* Failed Job Message */}
        {jobStatus?.status === 'failed' && (
          <div className="bg-red-950/20 border border-red-900/40 rounded-2xl p-4 flex gap-3 text-red-300">
            <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold">Feed Update Failed</p>
              <p className="text-xs text-red-450 mt-1 max-h-24 overflow-y-auto font-mono">
                {jobStatus.error_message || 'Unknown pipeline compilation error occurred.'}
              </p>
            </div>
          </div>
        )}

        {/* Filter & Search Toolbar */}
        <div className="bg-[#0a0a0a] border border-neutral-900 rounded-2xl p-4 flex flex-col md:flex-row items-center justify-between gap-4 shadow-sm">
          {/* Search bar */}
          <div className="relative w-full md:max-w-xs">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
            <input
              type="text"
              placeholder="Search topics/keywords..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#050505] border border-neutral-900 rounded-xl py-2 pl-10 pr-4 text-sm text-neutral-200 focus:outline-none focus:border-red-600 placeholder-neutral-550 transition-all focus:ring-1 focus:ring-red-950/40"
            />
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Sources Filter */}
          <div className="flex flex-col sm:flex-row items-center gap-4 w-full md:w-auto justify-end">
            <div className="flex items-center gap-2 text-neutral-400 text-sm">
              <Filter className="w-4 h-4 text-red-500" />
              <span className="font-semibold">Filter Sources:</span>
            </div>

            <div className="flex items-center gap-3">
              {[
                { id: 'BBC', label: 'BBC News', color: 'border-red-500/40 text-red-400', activeBg: 'bg-red-600/10 text-red-400 border-red-600/40 shadow-sm' },
                { id: 'NPR', label: 'NPR News', color: 'border-red-500/20 text-red-300', activeBg: 'bg-red-600/10 text-red-400 border-red-600/40 shadow-sm' },
                { id: 'Guardian', label: 'The Guardian', color: 'border-red-500/30 text-red-500', activeBg: 'bg-red-600/10 text-red-450 border-red-600/40 shadow-sm' }
              ].map((src) => {
                const isActive = selectedSources[src.id as 'BBC' | 'NPR' | 'Guardian'];
                return (
                  <button
                    key={src.id}
                    onClick={() => toggleSource(src.id as 'BBC' | 'NPR' | 'Guardian')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all duration-150 ${
                      isActive ? src.activeBg : 'border-neutral-900 bg-neutral-950 text-neutral-500 hover:text-white hover:bg-neutral-900/30'
                    }`}
                  >
                    {src.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Dashboard Panels */}
        {loading ? (
          <div className="flex-1 flex flex-col items-center justify-center py-24 gap-4 text-center">
            <div className="w-10 h-10 border-4 border-neutral-900 border-t-red-600 rounded-full animate-spin" />
            <div className="space-y-1.5">
              <p className="text-neutral-300 text-sm font-medium">Fetching topic clusters...</p>
              {takingLonger && (
                <p className="text-neutral-500 text-xs max-w-sm mx-auto animate-pulse px-4">
                  The backend server is waking up (Render Free Tier cold start). This usually takes 1-2 minutes. Please hang tight!
                </p>
              )}
            </div>
          </div>
        ) : error ? (
          <div className="flex-1 flex flex-col items-center justify-center border border-neutral-900 bg-neutral-950/40 rounded-3xl p-12 text-center shadow-sm">
            <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
            <h3 className="text-lg font-bold text-white">Database Connection Required</h3>
            <p className="text-sm text-neutral-450 mt-2 max-w-md">
              {error}
            </p>
            <button
              onClick={fetchData}
              className="mt-6 px-5 py-2 text-sm bg-neutral-900 border border-neutral-800 hover:bg-neutral-850 text-neutral-200 rounded-xl font-medium transition-all"
            >
              Retry Connection
            </button>
          </div>
        ) : filteredTimelineItems.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center border border-neutral-900 bg-neutral-950/20 rounded-3xl p-16 text-center shadow-sm">
            <BookOpen className="w-12 h-12 text-neutral-800 mb-4" />
            <h3 className="text-lg font-bold text-neutral-400">No Clustered Topics</h3>
            <p className="text-sm text-neutral-500 mt-2 max-w-md">
              There are no articles or clusters matching the criteria. Click "Refresh Data" above to fetch latest feeds and construct timeline.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {/* Timeline Visualizer Card */}
            <div className="relative bg-[#0a0a0a] border border-neutral-900 rounded-3xl p-6 flex flex-col gap-4 shadow-lg">
              <div className="flex items-center justify-between border-b border-neutral-900 pb-4">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-red-500" />
                  <span className="font-semibold text-sm text-white">Topic-Clustered Time Mapping</span>
                </div>
                <div className="text-xs text-neutral-500 font-medium">
                  Showing {filteredTimelineItems.length} active topics (Hover nodes to preview, Click to inspect stream)
                </div>
              </div>

              {/* Interactive Timeline SVG container */}
              <div ref={timelineRef} className="relative w-full overflow-x-auto select-none pt-2">
                <div style={{ minWidth: '850px' }} className="relative">
                  {timelineLayout.items.length > 0 && (
                    <svg
                      width="100%"
                      height={Math.max(180, timelineLayout.lanesCount * 28 + 60)}
                      className="overflow-visible"
                    >
                      {/* Grid Lines */}
                      {timeTicks.map((tick, i) => {
                        const { minTime, maxTime } = timelineLayout;
                        const pct = ((tick.getTime() - minTime) / (maxTime - minTime)) * 90 + 5; // 5% padding
                        return (
                          <g key={i}>
                            <line
                              x1={`${pct}%`}
                              y1="10"
                              x2={`${pct}%`}
                              y2={Math.max(160, timelineLayout.lanesCount * 28 + 10)}
                              stroke="#171717"
                              strokeWidth="1.5"
                              strokeDasharray="4,4"
                            />
                            <text
                              x={`${pct}%`}
                              y={Math.max(160, timelineLayout.lanesCount * 28 + 35)}
                              fill="#525252"
                              fontSize="10"
                              fontWeight="600"
                              textAnchor="middle"
                            >
                              {formatTickDate(tick)}
                            </text>
                          </g>
                        );
                      })}

                      {/* Timeline Bars / Nodes */}
                      {timelineLayout.items.map((item) => {
                        const { minTime, maxTime } = timelineLayout;
                        const startPct = ((item.startMs - minTime) / (maxTime - minTime)) * 90 + 5;
                        const endPct = ((item.endMs - minTime) / (maxTime - minTime)) * 90 + 5;
                        
                        // Vertical positioning (lane)
                        const y = 20 + item.lane * 28;
                        const isSingleArticle = item.startMs === item.endMs;
                        
                        const widthPct = isSingleArticle ? 0 : Math.max(1.2, endPct - startPct);
                        const isSelected = selectedCluster?.id === item.id;
                        const isHovered = hoveredItem?.id === item.id;

                        // Saturated red theme colors
                        const colorClass = getNodeColor(item, isSelected, isHovered);

                        return (
                          <g
                            key={item.id}
                            className="cursor-pointer transition-all duration-150"
                            onClick={() => handleClusterClick(item.id)}
                            onMouseEnter={() => setHoveredItem(item)}
                            onMouseLeave={() => setHoveredItem(null)}
                            onMouseMove={(e) => {
                              const containerRect = timelineRef.current?.getBoundingClientRect();
                              if (containerRect) {
                                const relativeX = e.clientX - containerRect.left;
                                const relativeY = e.clientY - containerRect.top;
                                
                                // Render tooltip to the left if close to the right edge of the viewport
                                const xPos = relativeX > containerRect.width - 260 ? relativeX - 280 : relativeX + 15;
                                // If hovering elements in top rows, display tooltip below cursor to prevent vertical clipping
                                const yPos = relativeY < 130 ? relativeY + 20 : relativeY - 130;
                                
                                setTooltipPos({
                                  x: xPos,
                                  y: yPos
                                });
                              }
                            }}
                          >
                            {/* Pill / Dots visual ranges */}
                            {!isSingleArticle ? (
                              <rect
                                x={`${startPct}%`}
                                y={y - 7}
                                width={`${widthPct}%`}
                                height="14"
                                rx="7"
                                className={`${colorClass} stroke-[1.5] transition-all`}
                              />
                            ) : (
                              <circle
                                cx={`${startPct}%`}
                                cy={y}
                                r="6"
                                className={`${colorClass} stroke-[1.5] transition-all`}
                              />
                            )}
                          </g>
                        );
                      })}
                    </svg>
                  )}
                </div>

                {/* Floating Rich Tooltip */}
                {hoveredItem && (
                  <div 
                    className="absolute z-50 pointer-events-none bg-neutral-950 border border-red-950/80 p-4 rounded-xl shadow-2xl backdrop-blur-md max-w-sm flex flex-col gap-2 transition-opacity duration-150 text-neutral-200"
                    style={{ left: tooltipPos.x, top: tooltipPos.y }}
                  >
                    <div className="flex gap-2 items-center">
                      <span className="text-[10px] font-bold bg-red-950/40 text-red-400 border border-red-900/30 px-2 py-0.5 rounded-md">
                        {hoveredItem.article_count} {hoveredItem.article_count === 1 ? 'story' : 'stories'}
                      </span>
                      {hoveredItem.sources.map(src => (
                        <span key={src} className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded border ${getSourceBadgeColor(src)}`}>
                          {src}
                        </span>
                      ))}
                    </div>
                    <p className="text-xs font-semibold text-white leading-snug">
                      {hoveredItem.label}
                    </p>
                    <p className="text-[9px] text-neutral-500 font-medium">
                      Time Range: {formatTickDate(new Date(hoveredItem.start_time))}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* List Overview Grid Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredClusters.map((cluster) => {
                const earliest = new Date(cluster.earliest_article);
                const latest = new Date(cluster.latest_article);
                const isSelected = selectedCluster?.id === cluster.id;
                
                return (
                  <div
                    key={cluster.id}
                    onClick={() => handleClusterClick(cluster.id)}
                    className={`p-5 rounded-2xl border text-left cursor-pointer transition-all duration-200 ${
                      isSelected
                        ? 'bg-[#121212] border-red-650/40 shadow-md shadow-red-950/20'
                        : 'bg-[#0a0a0a] border-neutral-900 hover:bg-[#121212] hover:border-red-950/30 shadow-sm'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <h4 className="font-semibold text-neutral-200 text-sm line-clamp-2 leading-relaxed">
                        {cluster.label}
                      </h4>
                      <span className="text-[10px] shrink-0 font-bold bg-red-950/30 text-red-400 border border-red-900/20 px-2 py-0.5 rounded-md">
                        {cluster.article_count} {cluster.article_count === 1 ? 'story' : 'stories'}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 mt-4 text-[10px] text-neutral-500 font-medium">
                      <Calendar className="w-3.5 h-3.5 text-neutral-500" />
                      <span>
                        {earliest.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        {cluster.article_count > 1 && ` - ${latest.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>

      {/* Sliding Sidebar Drawer for Cluster Details */}
      {selectedCluster && (
        <>
          {/* Backdrop */}
          <div 
            className="fixed inset-0 bg-black/60 backdrop-blur-xs z-40 transition-opacity duration-300"
            onClick={() => setSelectedCluster(null)}
          />

          {/* Drawer Panel */}
          <div className="fixed top-0 right-0 h-full w-full max-w-xl bg-[#050505] border-l border-neutral-900 shadow-2xl z-50 flex flex-col transform transition-transform duration-300 overflow-hidden text-neutral-200">
            {/* Drawer Header */}
            <div className="p-6 border-b border-neutral-900 flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[10px] font-bold bg-red-950/30 text-red-450 border border-red-900/25 px-2 py-0.5 rounded-md">
                    Cluster Stream
                  </span>
                  <span className="text-xs text-neutral-450 font-medium">
                    {selectedCluster.article_count} articles grouped
                  </span>
                </div>
                <h3 className="text-base font-bold text-white leading-snug">
                  {selectedCluster.label}
                </h3>
              </div>
              <button 
                onClick={() => setSelectedCluster(null)}
                className="p-1.5 hover:bg-neutral-900 rounded-lg text-neutral-500 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Drawer Articles List */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-black/40">
              {selectedCluster.articles && selectedCluster.articles.length > 0 ? (
                <div className="relative border-l border-neutral-900 ml-3 space-y-6">
                  {selectedCluster.articles.map((article, idx) => {
                    const pubDate = new Date(article.published_at);
                    return (
                      <div key={article.id} className="relative pl-6">
                        {/* Timeline Node Ring */}
                        <div className="absolute -left-[6px] top-1.5 w-3 h-3 rounded-full bg-black border border-red-500 shadow-sm" />

                        {/* Article Card */}
                        <div className="bg-[#0a0a0a] border border-neutral-900 rounded-2xl p-4 space-y-3 hover:border-red-950/30 transition-all shadow-xs">
                          <div className="flex items-center justify-between gap-2">
                            <span className={`text-[10px] font-extrabold px-2.5 py-0.5 rounded-md border ${getSourceBadgeColor(article.source)}`}>
                              {article.source}
                            </span>
                            <div className="flex items-center gap-1.5 text-[10px] text-neutral-500 font-semibold">
                              <Clock className="w-3.5 h-3.5 text-neutral-500" />
                              <span>
                                {pubDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} at{' '}
                                {pubDate.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                          </div>

                          <h4 className="text-sm font-semibold text-white leading-relaxed hover:text-red-400 transition-colors">
                            <a href={article.url} target="_blank" rel="noopener noreferrer">
                              {article.title}
                            </a>
                          </h4>

                          {article.summary && (
                            <p className="text-xs text-neutral-450 leading-relaxed line-clamp-3">
                              {article.summary}
                            </p>
                          )}

                          <div className="pt-2 flex justify-end">
                            <a
                              href={article.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 text-xs text-red-500 hover:text-red-400 font-bold"
                            >
                              <span>Read full article</span>
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-12 text-neutral-500 text-sm font-medium">
                  Fetching cluster details...
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

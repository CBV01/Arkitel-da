"use client";

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/auth';
import { Megaphone, Shield, TrendingUp, Activity, Zap } from 'lucide-react';
import { Preloader } from '@/components/Preloader';


export default function Dashboard() {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Generate date labels for the last 7 days
  const getDateLabels = () => {
    const labels = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      labels.push(`${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')}`);
    }
    return labels;
  };

  const dateLabels = getDateLabels();
  const chartData = stats?.engagement_flow || [0, 0, 0, 0, 0, 0, 0];
  const maxVal = Math.max(...chartData, 10);
  const chartMax = Math.ceil(maxVal / 10) * 10; // Round to nearest 10
  
  // Smooth curve calculation (dynamic scaling)
  const generateSmoothPath = (data: number[]) => {
    if (!data.length) return "";
    const width = 1000;
    const height = 200;
    const padding = 20;
    const chartHeight = height - padding * 2;
    const chartWidth = width - padding * 2;
    const step = chartWidth / (data.length - 1);

    const getY = (val: number) => height - padding - (val / chartMax) * chartHeight;

    let path = `M ${padding} ${getY(data[0])}`;
    
    for (let i = 0; i < data.length - 1; i++) {
        const x1 = padding + i * step;
        const y1 = getY(data[i]);
        const x2 = padding + (i + 1) * step;
        const y2 = getY(data[i + 1]);
        
        const cx = (x1 + x2) / 2;
        path += ` C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`;
    }
    return path;
  };

  const smoothPath = generateSmoothPath(chartData);
  const areaPath = smoothPath + ` L 980 180 L 20 180 Z`;

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await apiFetch('/api/dashboard/stats');
        const text = await res.text();
        if (res.ok) {
          try {
            setStats(JSON.parse(text));
          } catch (e) {
            console.error("Dashboard: Non-JSON response", text);
          }
        }
      } catch (err) {
        console.error("Dashboard: Failed to fetch stats", err);
      } finally {
        setLoading(false);
      }
    };
    fetchStats();
  }, []);

  const getStatusBadge = (status: string) => {
    const colors: any = {
      'pending': 'bg-amber-500/10 text-amber-500 border-amber-500/20',
      'processing': 'bg-indigo-500/10 text-indigo-500 border-indigo-500/20 animate-pulse',
      'completed': 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
      'failed': 'bg-red-500/10 text-red-500 border-red-500/20'
    };
    return colors[status] || 'bg-slate-500/10 text-slate-500 border-slate-500/20';
  };

  if (loading) {
    return <Preloader message="Fetching System Metrics..." />;
  }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-700">
      <header className="flex justify-between items-center mb-10">
        <div>
          <h2 className="text-2xl font-bold mb-1 tracking-tight text-foreground">Overview</h2>
          <p className="text-sm text-foreground/60">Monitor your active automation services and metrics.</p>
        </div>
        <div className="flex gap-3">
          <Link href="/campaigns" className="bg-indigo-500 hover:bg-indigo-600 transition-all text-white px-5 py-2.5 rounded-xl text-sm font-semibold active:scale-95 flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            New Campaign
          </Link>
        </div>
      </header>

      {/* Top Main Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-5 mb-8">
        <div className="bg-card border border-border p-5 rounded-[20px] relative overflow-hidden group hover:border-indigo-500/30 transition-all">
          <div className="flex justify-between items-start mb-2">
            <div className="text-foreground/40 text-[11px] font-bold tracking-wider uppercase font-mono">Transmission Count</div>
            <div className="p-1.5 bg-blue-500/10 rounded-lg text-blue-400"><Activity size={16} /></div>
          </div>
          <div className="text-2xl font-bold text-foreground mb-2">{stats?.counts?.messages ?? '...'}</div>
          <div className="flex items-center gap-1.5 text-[10px] text-foreground/30 font-medium italic">Verified broadcast throughput</div>
        </div>

        <div className="bg-card border border-border p-5 rounded-[20px] relative overflow-hidden group hover:border-indigo-500/30 transition-all">
          <div className="flex justify-between items-start mb-2">
            <div className="text-foreground/40 text-[11px] font-bold tracking-wider uppercase font-mono">Active Nodes</div>
            <div className="p-1.5 bg-indigo-500/10 rounded-lg text-indigo-500"><Zap size={16} /></div>
          </div>
          <div className="text-2xl font-bold text-foreground mb-2">{stats?.counts?.accounts ?? '...'}</div>
          <div className="flex items-center gap-1.5 text-[10px] text-emerald-400/60 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span> {Number(stats?.counts?.accounts) > 0 ? 'Cluster Online' : 'Status: Isolated'}
          </div>
        </div>

        <div className="bg-card border border-border p-5 rounded-[20px] relative overflow-hidden group hover:border-indigo-500/30 transition-all">
          <div className="flex justify-between items-start mb-2">
            <div className="text-foreground/40 text-[11px] font-bold tracking-wider uppercase font-mono">Entity Leads</div>
            <div className="p-1.5 bg-purple-500/10 rounded-lg text-purple-400"><Shield size={16} /></div>
          </div>
          <div className="text-2xl font-bold text-foreground mb-2">{stats?.counts?.leads ?? '...'}</div>
          <div className="flex items-center gap-1.5 text-[10px] text-foreground/30 font-medium italic">Targeted leads analyzed</div>
        </div>

        <div className="bg-card border border-border p-5 rounded-[20px] relative overflow-hidden group hover:border-indigo-500/30 transition-all">
          <div className="flex justify-between items-start mb-2">
            <div className="text-foreground/40 text-[11px] font-bold tracking-wider uppercase font-mono">Queue Depth</div>
            <div className="p-1.5 bg-amber-500/10 rounded-lg text-amber-500"><Activity size={16} /></div>
          </div>
          <div className="text-2xl font-bold text-foreground mb-2">{stats?.counts?.pending ?? '...'}</div>
          <div className="flex items-center gap-1.5 text-[10px] text-amber-400/60 font-medium font-mono">Cycle Overhead Status</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
        <div className="lg:col-span-2 bg-card border border-border rounded-[32px] p-8 relative overflow-hidden group flex flex-col min-h-[420px]">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-emerald-500/10 rounded-xl text-emerald-500">
               <TrendingUp size={24} />
            </div>
            <h3 className="text-2xl font-bold text-foreground tracking-tight">Trends</h3>
          </div>
          <p className="text-sm text-foreground/40 mb-10 font-medium">Message outreach over the last 7 days</p>

          <div className="flex-1 mt-4 flex">
            {/* Y-Axis Labels */}
            <div className="flex flex-col justify-between py-10 pr-3 text-[10px] font-mono text-foreground/50 font-bold h-full w-14 shrink-0 text-right border-r border-border/20">
              {[chartMax, Math.round(chartMax * 0.75), Math.round(chartMax * 0.5), Math.round(chartMax * 0.25), 0].map(val => (
                <span key={val}>{val}</span>
              ))}
            </div>

            <div className="flex-1 relative pl-3">
              {/* Grid Lines */}
              <div className="absolute inset-x-0 inset-y-0 flex flex-col justify-between pointer-events-none opacity-10 py-10 ml-3">
                {[chartMax, 0.75, 0.5, 0.25, 0].map(val => (
                  <div key={val} className="w-full border-t border-dashed border-foreground/50" />
                ))}
              </div>

              <div className="absolute inset-x-0 bottom-0 flex justify-between pointer-events-none ml-3">
                {dateLabels.map(label => (
                  <span key={label} className="text-[10px] font-mono text-foreground/40 font-bold">{label}</span>
                ))}
              </div>

              <svg className="w-full h-full pb-10" viewBox="0 0 1000 200" preserveAspectRatio="none">
              <defs>
                <linearGradient id="areaGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
                </linearGradient>
                <linearGradient id="lineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#4f46e5" />
                  <stop offset="100%" stopColor="#818cf8" />
                </linearGradient>
              </defs>
              
              {/* Fill Area */}
              <path
                d={areaPath}
                fill="url(#areaGradient)"
                className="transition-all duration-1000"
              />

              {/* Main Line */}
              <path
                d={smoothPath}
                fill="none"
                stroke="url(#lineGradient)"
                strokeWidth="4"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="drop-shadow-[0_0_15px_rgba(99,102,241,0.5)] transition-all duration-1000"
              />

              {/* Data Points / Interaction Nodes */}
              {chartData.map((val: number, i: number) => {
                const step = 960 / (chartData.length - 1);
                const x = 20 + i * step;
                const y = 180 - (val / chartMax) * 160;
                return (
                  <circle 
                    key={i} 
                    cx={x} 
                    cy={y} 
                    r="4" 
                    fill="#ffffff" 
                    className="stroke-[3] stroke-indigo-600 hover:r-6 transition-all cursor-pointer"
                  />
                );
              })}
            </svg>
            </div>
          </div>
        </div>

        <div className="bg-card border border-border rounded-[32px] p-8 flex flex-col relative overflow-hidden group">
          <div className="absolute -bottom-10 -right-10 opacity-[0.02] group-hover:scale-110 transition-transform duration-1000">
            <Shield size={200} />
          </div>
          <h3 className="text-xl font-bold text-foreground mb-8 tracking-tight relative z-10">System Vitals</h3>
          <div className="space-y-8 flex-1 relative z-10">
            <div className="space-y-3">
              <div className="flex justify-between text-[11px] font-bold text-foreground/30 uppercase tracking-widest">
                <span>Network Integrity</span>
                <span className="text-emerald-500 tracking-tighter">{stats?.service_health?.database || 'Stable'}</span>
              </div>
              <div className="h-2 bg-foreground/[0.03] rounded-full overflow-hidden border border-border/10 p-[1px]">
                <div className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 w-[100%] rounded-full"></div>
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between text-[11px] font-bold text-foreground/30 uppercase tracking-widest">
                <span>Task Automator</span>
                <span className="text-indigo-500 tracking-tighter">{stats?.service_health?.poller || 'Active'}</span>
              </div>
              <div className="h-2 bg-foreground/[0.03] rounded-full overflow-hidden border border-border/10 p-[1px]">
                <div className="h-full bg-gradient-to-r from-indigo-600 to-indigo-400 w-[85%] rounded-full animate-pulse"></div>
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between text-[11px] font-bold text-foreground/30 uppercase tracking-widest">
                <span>TG API Handshake</span>
                <span className="text-foreground/20 tracking-tighter italic">{stats?.service_health?.api || 'Idle'}</span>
              </div>
              <div className="h-2 bg-foreground/[0.03] rounded-full overflow-hidden border border-border/10 p-[1px]">
                <div className="h-full bg-foreground/10 w-[15%] rounded-full"></div>
              </div>
            </div>
          </div>
          <button className="w-full mt-10 py-4 bg-foreground/[0.03] hover:bg-foreground/[0.06] border border-border rounded-2xl text-[10px] font-bold uppercase tracking-[0.2em] text-foreground/30 hover:text-foreground transition-all relative z-10 group/btn overflow-hidden">
            <span className="relative z-10">Run System Diagnostics</span>
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-foreground/5 to-transparent -translate-x-full group-hover/btn:translate-x-full transition-transform duration-1000"></div>
          </button>
        </div>
      </div>

      {/* Latest Activity Table */}
      <h3 className="text-lg font-bold mb-5 text-foreground tracking-tight">Recent Live Tasks</h3>
      <div className="bg-card border border-border rounded-[24px] overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-border text-foreground/20 text-[11px] uppercase tracking-widest bg-foreground/[0.02]">
              <th className="font-bold p-5 pl-8">Account</th>
              <th className="font-bold p-5">Status</th>
              <th className="font-bold p-5">Message Snippet</th>
              <th className="font-bold p-5 text-right pr-8">Run Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {stats?.recent_tasks?.length > 0 ? (
              stats.recent_tasks.map((task: any, i: number) => (
                <tr key={i} className="hover:bg-foreground/[0.02] transition-colors">
                  <td className="p-5 pl-8">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-500">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                      </div>
                      <span className="text-sm font-semibold text-foreground/80">{task.account}</span>
                    </div>
                  </td>
                  <td className="p-5">
                    <span className={`px-2.5 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider border ${getStatusBadge(task.status)}`}>
                      {task.status}
                    </span>
                  </td>
                  <td className="p-5">
                    <p className="text-xs text-foreground/40 max-w-[300px] truncate">{task.message}</p>
                  </td>
                  <td className="p-5 text-right pr-8 text-xs font-medium text-foreground/30">
                    {new Date(task.time + (task.time.includes('Z') ? '' : 'Z')).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4} className="p-10 text-center text-foreground/20 text-sm italic font-medium">
                  No automation tasks detected in the last cycle.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

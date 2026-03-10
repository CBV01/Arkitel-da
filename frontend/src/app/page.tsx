"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/auth';
import { Megaphone, Shield } from 'lucide-react';

export default function Dashboard() {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

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

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-700">
      <header className="flex justify-between items-center mb-10">
        <div>
          <h2 className="text-2xl font-bold mb-1 tracking-tight text-foreground">Overview</h2>
          <p className="text-sm text-foreground/60">Monitor your active automation services and metrics.</p>
        </div>
        <div className="flex gap-3">
          <Link href="/campaigns" className="bg-indigo-500 hover:bg-indigo-600 transition-all text-white px-5 py-2.5 rounded-xl text-sm font-semibold shadow-lg shadow-indigo-500/20 active:scale-95 flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            New Campaign
          </Link>
        </div>
      </header>

      {/* Top Main Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-5 mb-8">
        <div className="bg-card border border-border p-5 rounded-[20px] relative overflow-hidden group hover:border-indigo-500/30 transition-all shadow-xl">
          <div className="flex justify-between items-start mb-2">
            <div className="text-foreground/40 text-[11px] font-bold tracking-wider uppercase">Messages Sent</div>
            <div className="p-1.5 bg-blue-500/10 rounded-lg text-blue-400"><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg></div>
          </div>
          <div className="text-2xl font-bold text-foreground mb-2">{stats?.counts?.messages ?? '...'}</div>
          <div className="flex items-center gap-1.5 text-[10px] text-foreground/30 font-medium">Total broadcast throughput</div>
        </div>

        <div className="bg-card border border-border p-5 rounded-[20px] relative overflow-hidden group hover:border-indigo-500/30 transition-all shadow-xl">
          <div className="flex justify-between items-start mb-2">
            <div className="text-foreground/40 text-[11px] font-bold tracking-wider uppercase">Accounts</div>
            <div className="p-1.5 bg-indigo-500/10 rounded-lg text-indigo-500"><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg></div>
          </div>
          <div className="text-2xl font-bold text-foreground mb-2">{stats?.counts?.accounts ?? '...'}</div>
          <div className="flex items-center gap-1.5 text-[10px] text-emerald-400/60 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span> {Number(stats?.counts?.accounts) > 0 ? 'Active Fleet' : 'Status: Offline'}
          </div>
        </div>

        <div className="bg-card border border-border p-5 rounded-[20px] relative overflow-hidden group hover:border-indigo-500/30 transition-all shadow-xl">
          <div className="flex justify-between items-start mb-2">
            <div className="text-foreground/40 text-[11px] font-bold tracking-wider uppercase">Leads Captured</div>
            <div className="p-1.5 bg-purple-500/10 rounded-lg text-purple-400"><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg></div>
          </div>
          <div className="text-2xl font-bold text-foreground mb-2">{stats?.counts?.leads ?? '...'}</div>
          <div className="flex items-center gap-1.5 text-[10px] text-foreground/30 font-medium">Potential targets scraped</div>
        </div>

        <div className="bg-card border border-border p-5 rounded-[20px] relative overflow-hidden group hover:border-indigo-500/30 transition-all shadow-xl">
          <div className="flex justify-between items-start mb-2">
            <div className="text-foreground/40 text-[11px] font-bold tracking-wider uppercase">Tasks Queue</div>
            <div className="p-1.5 bg-amber-500/10 rounded-lg text-amber-500"><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg></div>
          </div>
          <div className="text-2xl font-bold text-foreground mb-2">{stats?.counts?.pending ?? '...'}</div>
          <div className="flex items-center gap-1.5 text-[10px] text-amber-400/60 font-medium">Current scheduled overhead</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
        <div className="lg:col-span-2 bg-card border border-border rounded-[32px] p-8 shadow-2xl relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-8 opacity-[0.03] group-hover:opacity-[0.07] transition-all">
            <Megaphone size={120} className="-rotate-12" />
          </div>
          <div className="flex justify-between items-center mb-10 relative z-10">
            <div>
              <h3 className="text-xl font-black text-foreground tracking-tight">Engagement Dynamics</h3>
              <p className="text-[10px] text-foreground/30 font-bold uppercase tracking-widest mt-1">Real-time throughput analysis</p>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 bg-indigo-500/10 rounded-full border border-indigo-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse"></span>
              <span className="text-[10px] font-black text-indigo-500 uppercase tracking-wider">Engine Active</span>
            </div>
          </div>
          <div className="h-56 flex items-end justify-between gap-2.5 pb-2 relative z-10">
            {(stats?.engagement_flow || [30, 60, 40, 80, 50, 70, 90, 45, 85, 100]).map((h: number, i: number) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-3 h-full justify-end group/bar">
                <div className="relative w-full">
                  <div 
                    className="w-full bg-gradient-to-t from-indigo-600/10 via-indigo-600/40 to-indigo-500 rounded-2xl transition-all duration-700 hover:scale-x-110 hover:shadow-[0_0_20px_rgba(99,102,241,0.3)] cursor-pointer" 
                    style={{ height: `${h}%` }}
                  >
                    <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-indigo-600 text-white text-[10px] font-black px-2 py-1 rounded-lg opacity-0 group-hover/bar:opacity-100 transition-all shadow-xl shadow-indigo-500/20">
                      {h}%
                    </div>
                  </div>
                </div>
                <div className="w-1 h-1 rounded-full bg-foreground/10 group-hover/bar:bg-indigo-500 transition-colors"></div>
              </div>
            ))}
          </div>
          <div className="flex justify-between text-foreground/20 text-[9px] font-black uppercase tracking-[0.3em] mt-6 border-t border-border/50 pt-4">
            <span>Historical Cycle Start</span>
            <span>Current Transmission Window</span>
          </div>
        </div>

        <div className="bg-card border border-border rounded-[32px] p-8 shadow-2xl flex flex-col relative overflow-hidden group">
          <div className="absolute -bottom-10 -right-10 opacity-[0.02] group-hover:scale-110 transition-transform duration-1000">
            <Shield size={200} />
          </div>
          <h3 className="text-xl font-black text-foreground mb-8 tracking-tight relative z-10">System Vitals</h3>
          <div className="space-y-8 flex-1 relative z-10">
            <div className="space-y-3">
              <div className="flex justify-between text-[11px] font-black text-foreground/30 uppercase tracking-widest">
                <span>Network Integrity</span>
                <span className="text-emerald-500 tracking-tighter shadow-emerald-500/20 drop-shadow-sm">{stats?.service_health?.database || 'Stable'}</span>
              </div>
              <div className="h-2 bg-foreground/[0.03] rounded-full overflow-hidden border border-border/10 p-[1px]">
                <div className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 w-[100%] rounded-full shadow-[0_0_15px_rgba(16,185,129,0.3)]"></div>
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between text-[11px] font-black text-foreground/30 uppercase tracking-widest">
                <span>Task Automator</span>
                <span className="text-indigo-500 tracking-tighter">{stats?.service_health?.poller || 'Active'}</span>
              </div>
              <div className="h-2 bg-foreground/[0.03] rounded-full overflow-hidden border border-border/10 p-[1px]">
                <div className="h-full bg-gradient-to-r from-indigo-600 to-indigo-400 w-[85%] rounded-full shadow-[0_0_15px_rgba(99,102,241,0.3)] animate-pulse"></div>
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between text-[11px] font-black text-foreground/30 uppercase tracking-widest">
                <span>TG API Handshake</span>
                <span className="text-foreground/20 tracking-tighter italic">{stats?.service_health?.api || 'Idle'}</span>
              </div>
              <div className="h-2 bg-foreground/[0.03] rounded-full overflow-hidden border border-border/10 p-[1px]">
                <div className="h-full bg-foreground/10 w-[15%] rounded-full"></div>
              </div>
            </div>
          </div>
          <button className="w-full mt-10 py-4 bg-foreground/[0.03] hover:bg-foreground/[0.06] border border-border rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] text-foreground/30 hover:text-foreground transition-all relative z-10 group/btn overflow-hidden">
            <span className="relative z-10">Run System Diagnostics</span>
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-foreground/5 to-transparent -translate-x-full group-hover/btn:translate-x-full transition-transform duration-1000"></div>
          </button>
        </div>
      </div>

      {/* Latest Activity Table */}
      <h3 className="text-lg font-bold mb-5 text-foreground tracking-tight">Recent Live Tasks</h3>
      <div className="bg-card border border-border rounded-[24px] overflow-hidden shadow-2xl">
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

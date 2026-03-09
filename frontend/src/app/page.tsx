"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/auth';

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
          <Link href="/campaigns" className="bg-[#7c7fff] hover:bg-[#6c6fef] transition-all text-white px-5 py-2.5 rounded-xl text-sm font-semibold shadow-lg shadow-[#7c7fff]/20 active:scale-95 flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            New Campaign
          </Link>
        </div>
      </header>

      {/* Top Main Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-5 mb-8">
        <div className="bg-[#0b0c10] border border-white/[0.05] p-5 rounded-[20px] relative overflow-hidden group hover:border-[#7c7fff]/30 transition-all shadow-xl">
          <div className="flex justify-between items-start mb-2">
            <div className="text-white/40 text-[11px] font-bold tracking-wider uppercase">Messages Sent</div>
            <div className="p-1.5 bg-blue-500/10 rounded-lg text-blue-400"><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg></div>
          </div>
          <div className="text-2xl font-bold text-white mb-2">{stats?.counts?.messages ?? '...'}</div>
          <div className="flex items-center gap-1.5 text-[10px] text-white/30 font-medium">Total broadcast throughput</div>
        </div>

        <div className="bg-[#0b0c10] border border-white/[0.05] p-5 rounded-[20px] relative overflow-hidden group hover:border-[#7c7fff]/30 transition-all shadow-xl">
          <div className="flex justify-between items-start mb-2">
            <div className="text-white/40 text-[11px] font-bold tracking-wider uppercase">Accounts</div>
            <div className="p-1.5 bg-[#7c7fff]/10 rounded-lg text-[#7c7fff]"><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg></div>
          </div>
          <div className="text-2xl font-bold text-white mb-2">{stats?.counts?.accounts ?? '...'}</div>
          <div className="flex items-center gap-1.5 text-[10px] text-emerald-400/60 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span> {Number(stats?.counts?.accounts) > 0 ? 'Active Fleet' : 'Status: Offline'}
          </div>
        </div>

        <div className="bg-[#0b0c10] border border-white/[0.05] p-5 rounded-[20px] relative overflow-hidden group hover:border-[#7c7fff]/30 transition-all shadow-xl">
          <div className="flex justify-between items-start mb-2">
            <div className="text-white/40 text-[11px] font-bold tracking-wider uppercase">Leads Captured</div>
            <div className="p-1.5 bg-purple-500/10 rounded-lg text-purple-400"><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg></div>
          </div>
          <div className="text-2xl font-bold text-white mb-2">{stats?.counts?.leads ?? '...'}</div>
          <div className="flex items-center gap-1.5 text-[10px] text-white/30 font-medium">Potential targets scraped</div>
        </div>

        <div className="bg-[#0b0c10] border border-white/[0.05] p-5 rounded-[20px] relative overflow-hidden group hover:border-[#7c7fff]/30 transition-all shadow-xl">
          <div className="flex justify-between items-start mb-2">
            <div className="text-white/40 text-[11px] font-bold tracking-wider uppercase">Tasks Queue</div>
            <div className="p-1.5 bg-amber-500/10 rounded-lg text-amber-500"><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg></div>
          </div>
          <div className="text-2xl font-bold text-white mb-2">{stats?.counts?.pending ?? '...'}</div>
          <div className="flex items-center gap-1.5 text-[10px] text-amber-400/60 font-medium">Current scheduled overhead</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
        <div className="lg:col-span-2 bg-[#0b0c10] border border-white/[0.05] rounded-[24px] p-8 shadow-xl">
          <div className="flex justify-between items-center mb-8">
            <h3 className="text-lg font-bold text-white">Engagement Flow</h3>
            <div className="flex gap-2">
              <span className="px-3 py-1 bg-[#7c7fff]/10 rounded-lg text-[10px] font-bold text-[#7c7fff]">REAL-TIME Metrics</span>
            </div>
          </div>
          <div className="h-48 flex items-end justify-between gap-3 border-b border-white/[0.05] pb-4">
            {[30, 60, 40, 80, 50, 70, 90, 45, 85, 100].map((h, i) => (
              <div key={i} className="flex-1 bg-gradient-to-t from-[#7c7fff]/20 to-[#7c7fff] rounded-t-[4px] relative group" style={{ height: `${h}%` }}>
                <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-white text-black text-[10px] font-bold px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-all">
                  {Math.floor(h * 1.5)}%
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-between text-white/20 text-[10px] font-bold uppercase tracking-widest mt-4">
            <span>Systems Online</span>
            <span>Transmission Stable</span>
          </div>
        </div>

        <div className="bg-[#0b0c10] border border-white/[0.05] rounded-[24px] p-8 shadow-xl flex flex-col">
          <h3 className="text-lg font-bold text-white mb-6">Service Health</h3>
          <div className="space-y-6 flex-1">
            <div className="space-y-2">
              <div className="flex justify-between text-xs font-medium text-white/50">
                <span>Database Connectivity (Turso)</span>
                <span className="text-emerald-400">Stable</span>
              </div>
              <div className="h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500 w-[100%] shadow-[0_0_10px_#10b981]"></div>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-xs font-medium text-white/50">
                <span>Underground Task Poller</span>
                <span className="text-[#7c7fff]">Active</span>
              </div>
              <div className="h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
                <div className="h-full bg-[#7c7fff] w-[100%] shadow-[0_0_10px_#7c7fff]"></div>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-xs font-medium text-white/50">
                <span>Telegram API Handshake</span>
                <span className="text-white/30">Idle</span>
              </div>
              <div className="h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
                <div className="h-full bg-white/20 w-[15%]"></div>
              </div>
            </div>
          </div>
          <button className="w-full mt-8 py-3 bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.05] rounded-xl text-xs font-bold text-white/40 hover:text-white transition-all">
            System Diagnostics
          </button>
        </div>
      </div>

      {/* Latest Activity Table */}
      <h3 className="text-lg font-bold mb-5 text-white tracking-tight">Recent Live Tasks</h3>
      <div className="bg-[#0b0c10] border border-white/[0.05] rounded-[24px] overflow-hidden shadow-2xl">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-white/[0.05] text-white/20 text-[11px] uppercase tracking-widest bg-white/[0.02]">
              <th className="font-bold p-5 pl-8">Account</th>
              <th className="font-bold p-5">Status</th>
              <th className="font-bold p-5">Message Snippet</th>
              <th className="font-bold p-5 text-right pr-8">Run Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.05]">
            {stats?.recent_tasks?.length > 0 ? (
              stats.recent_tasks.map((task: any, i: number) => (
                <tr key={i} className="hover:bg-white/[0.02] transition-colors">
                  <td className="p-5 pl-8">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-[#7c7fff]/10 border border-[#7c7fff]/20 flex items-center justify-center text-[#7c7fff]">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                      </div>
                      <span className="text-sm font-semibold text-white/80">{task.account}</span>
                    </div>
                  </td>
                  <td className="p-5">
                    <span className={`px-2.5 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider border ${getStatusBadge(task.status)}`}>
                      {task.status}
                    </span>
                  </td>
                  <td className="p-5">
                    <p className="text-xs text-white/40 max-w-[300px] truncate">{task.message}</p>
                  </td>
                  <td className="p-5 text-right pr-8 text-xs font-medium text-white/30">
                    {new Date(task.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4} className="p-10 text-center text-white/20 text-sm italic font-medium">
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

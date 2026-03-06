"use client";

import React, { useState, useEffect } from 'react';
import { Users, Search, Download, Loader2, Calendar, MessageSquare } from 'lucide-react';
import { apiFetch } from '@/lib/auth';

export default function LeadsPage() {
    const [leads, setLeads] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        const fetchLeads = async () => {
            try {
                const res = await apiFetch('/api/telegram/leads');
                const data = await res.json();
                if (res.ok) setLeads(data.leads || []);
            } catch (err) {
                console.error("Failed to fetch leads", err);
            } finally {
                setLoading(false);
            }
        };
        fetchLeads();
    }, []);

    const filteredLeads = leads.filter(lead => 
        (lead.username?.toLowerCase().includes(searchTerm.toLowerCase()) || 
         lead.first_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
         lead.last_name?.toLowerCase().includes(searchTerm.toLowerCase()))
    );

    const downloadCSV = () => {
        const headers = ["ID", "Username", "First Name", "Last Name", "Group ID", "Scraped At"];
        const rows = leads.map(l => [l.id, l.username, l.first_name, l.last_name, l.group_id, l.created_at]);
        
        const content = [headers, ...rows].map(e => e.join(",")).join("\n");
        const blob = new Blob([content], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `leads_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
    };

    return (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-700">
            <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-10">
                <div>
                    <h2 className="text-2xl font-bold mb-1 tracking-tight text-foreground">Scraped Leads</h2>
                    <p className="text-sm text-foreground/60">View and export all members collected from your target groups.</p>
                </div>
                <div className="flex gap-3 w-full md:w-auto">
                    <div className="relative flex-1 md:w-64">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground/40" size={16} />
                        <input 
                            type="text"
                            placeholder="Search leads..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                        />
                    </div>
                    <button 
                        onClick={downloadCSV}
                        className="bg-white/10 hover:bg-white/15 border border-white/10 text-white px-4 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2 transition-all shadow-lg"
                    >
                        <Download size={16} /> Export CSV
                    </button>
                </div>
            </header>

            {loading ? (
                <div className="flex justify-center py-20">
                    <Loader2 className="animate-spin text-indigo-500/40" size={32} />
                </div>
            ) : leads.length === 0 ? (
                <div className="bg-background/50 border border-white/5 rounded-2xl p-20 flex flex-col items-center justify-center text-center shadow-xl">
                    <div className="w-16 h-16 rounded-full bg-indigo-500/10 flex items-center justify-center text-indigo-500 mb-4">
                        <Users size={32} />
                    </div>
                    <h3 className="text-xl font-bold text-foreground mb-1">No leads found</h3>
                    <p className="text-foreground/50 text-sm max-w-xs">Start scraping groups to collect potential leads for your campaigns.</p>
                </div>
            ) : (
                <div className="bg-background/80 backdrop-blur-3xl border border-white/5 rounded-2xl overflow-hidden shadow-2xl">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="bg-white/5 border-b border-white/5">
                                <tr>
                                    <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-foreground/40">Name</th>
                                    <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-foreground/40">Username</th>
                                    <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-foreground/40">Source Group</th>
                                    <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-foreground/40">Date Added</th>
                                    <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-foreground/40 text-right">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {filteredLeads.map((lead) => (
                                    <tr key={lead.id} className="hover:bg-white/[0.02] transition-colors group">
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500/20 to-purple-500/20 flex items-center justify-center text-indigo-400 text-xs font-bold border border-indigo-500/10">
                                                    {(lead.first_name?.[0] || lead.username?.[0] || "?").toUpperCase()}
                                                </div>
                                                <span className="font-semibold text-foreground/80">{lead.first_name} {lead.last_name}</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-sm text-indigo-400">@{lead.username || "N/A"}</td>
                                        <td className="px-6 py-4 text-sm text-foreground/40">{lead.group_id}</td>
                                        <td className="px-6 py-4 text-xs text-foreground/30">
                                            <div className="flex items-center gap-2">
                                                <Calendar size={12} /> {new Date(lead.created_at).toLocaleDateString()}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <button className="p-2 text-foreground/30 hover:text-indigo-400 transition-colors">
                                                <MessageSquare size={16} />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}

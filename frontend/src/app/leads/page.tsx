"use client";

import React, { useState, useEffect } from 'react';
import { Bookmark, Loader2, UsersRound, Megaphone, CheckCircle2, X, ExternalLink, Plus, Trash2, Search, Filter, Shield, UserPlus } from 'lucide-react';
import { apiFetch } from '@/lib/auth';

interface SavedGroup {
    id: string;
    title: string;
    username: string | null;
    participants_count: number;
    type: string;
    is_private: boolean;
    country: string;
    user_shows: number;
    global_shows: number;
    source: string;
    created_at: string;
}

export default function LeadsPage() {
    const [leads, setLeads] = useState<SavedGroup[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [selectedLeads, setSelectedLeads] = useState<Set<string>>(new Set());
    const [filter, setFilter] = useState<'all' | 'group' | 'channel'>('all');
    const [joining, setJoining] = useState(false);

    // Extraction state
    const [isExtracting, setIsExtracting] = useState(false);
    const [extractingGroup, setExtractingGroup] = useState<string | null>(null);
    const [extractingPhone, setExtractingPhone] = useState('');
    const [accounts, setAccounts] = useState<any[]>([]);

    useEffect(() => {
        fetchLeads();
        fetchAccounts();
    }, []);

    const fetchLeads = async () => {
        setLoading(true);
        try {
            const res = await apiFetch('/api/telegram/leads/groups');
            const data = await res.json();
            if (res.ok) {
                setLeads(data.groups || []);
            } else {
                setError(data.detail || 'Failed to fetch saved leads');
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const fetchAccounts = async () => {
        try {
            const res = await apiFetch('/api/telegram/accounts');
            if (res.ok) {
                const data = await res.json();
                setAccounts(data.accounts || []);
                if (data.accounts?.length > 0) setExtractingPhone(data.accounts[0].phone_number);
            }
        } catch (e) {}
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure you want to remove this lead?')) return;
        try {
            const res = await apiFetch(`/api/telegram/leads/groups/${id}`, { method: 'DELETE' });
            if (res.ok) {
                setLeads(prev => prev.filter(l => l.id !== id));
            }
        } catch (err: any) {
            alert(err.message);
        }
    };

    const handleBulkJoin = async () => {
        if (selectedLeads.size === 0) return;
        setJoining(true);
        try {
            const res = await apiFetch('/api/telegram/bulk-join', {
                method: 'POST',
                body: JSON.stringify({ 
                    group_ids: Array.from(selectedLeads), 
                    phone_number: extractingPhone 
                })
            });
            if (res.ok) {
                alert('Bulk join process started with 10-15s safety intervals.');
                setSelectedLeads(new Set());
            }
        } catch (err: any) {
            alert(err.message);
        } finally {
            setJoining(false);
        }
    };

    const handleExtract = async () => {
        if (!extractingGroup || !extractingPhone) return;
        setIsExtracting(true);
        try {
            const res = await apiFetch('/api/telegram/extract', {
                method: 'POST',
                body: JSON.stringify({ group_id: extractingGroup, phone_number: extractingPhone })
            });
            const data = await res.json();
            if (res.ok) {
                alert(`Successfully extracted ${data.count} members! They are now in your Member Leads section.`);
                setExtractingGroup(null);
            } else {
                alert(data.detail || 'Extraction failed');
            }
        } catch (err: any) {
            alert(err.message);
        } finally {
            setIsExtracting(false);
        }
    };

    const handleSingleJoin = async (id: string, username: string | null) => {
        try {
            const accRes = await apiFetch('/api/telegram/accounts');
            const accData = await accRes.json();
            const phoneNumber = accData.accounts?.[0]?.phone_number;
            if (!phoneNumber) throw new Error("No connected account.");

            const res = await apiFetch('/api/telegram/join', {
                method: 'POST',
                body: JSON.stringify({ group_id: username || id, phone_number: phoneNumber })
            });
            if (res.ok) {
                alert(`Successfully joined the community!`);
            } else {
                const d = await res.json();
                alert(d.detail || 'Join failed');
            }
        } catch (e: any) {
            alert(e.message);
        }
    };

    const toggleSelection = (id: string) => {
        const newSet = new Set(selectedLeads);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setSelectedLeads(newSet);
    };

    const filteredLeads = leads.filter(l => {
        if (filter === 'all') return true;
        return l.type === filter;
    });

    return (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-700">
            <header className="flex justify-between items-center mb-10">
                <div>
                    <h2 className="text-2xl font-bold mb-1 tracking-tight text-foreground flex items-center gap-3">
                        <Bookmark className="text-indigo-500" /> Saved Leads
                    </h2>
                    <p className="text-sm text-foreground/60">Persistent repository of your target communities.</p>
                </div>
                <div className="flex gap-3">
                    {selectedLeads.size > 0 && (
                        <button 
                            onClick={handleBulkJoin}
                            disabled={joining}
                            className="bg-indigo-600 hover:bg-indigo-500 transition-all text-white px-5 py-2.5 rounded-xl text-sm font-semibold shadow-lg shadow-indigo-500/20 active:scale-95 flex items-center gap-2 disabled:opacity-50"
                        >
                            {joining ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} 
                            Bulk Join ({selectedLeads.size})
                        </button>
                    )}
                </div>
            </header>

            {error && (
                <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 text-sm flex items-center justify-between">
                    <span>{error}</span>
                    <button onClick={() => setError('')}><X size={16} /></button>
                </div>
            )}

            <div className="bg-foreground/5 border border-border p-1.5 rounded-2xl flex gap-1 h-fit mb-8 w-fit">
                {(['all', 'group', 'channel'] as const).map((t) => (
                    <button
                        key={t}
                        onClick={() => setFilter(t)}
                        className={`px-6 py-2 rounded-xl text-xs font-bold capitalize transition-all ${filter === t ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20' : 'text-foreground/40 hover:text-foreground hover:bg-foreground/5'}`}
                    >
                        {t}s
                    </button>
                ))}
            </div>

            {loading ? (
                <div className="py-20 flex flex-col items-center">
                    <Loader2 className="w-10 h-10 text-indigo-500 animate-spin mb-4" />
                    <p className="text-sm text-foreground/40 font-medium">Loading your leads...</p>
                </div>
            ) : leads.length === 0 ? (
                <div className="border-2 border-dashed border-border rounded-3xl p-20 flex flex-col items-center text-center">
                    <div className="w-20 h-20 bg-foreground/5 rounded-full flex items-center justify-center mb-6 text-foreground/20">
                        <Bookmark size={40} />
                    </div>
                    <h3 className="text-xl font-bold text-foreground mb-2">No Saved Leads</h3>
                    <p className="text-sm text-foreground/40 max-w-xs mx-auto mb-8 text-balance">
                        Use the Scraper to find groups and channels, then save them here for persistent access.
                    </p>
                    <button 
                        onClick={() => window.location.href = '/scraper'}
                        className="bg-indigo-600 hover:bg-indigo-500 text-white px-8 py-3 rounded-2xl font-bold text-sm transition-all active:scale-95 shadow-xl shadow-indigo-500/20"
                    >
                        Go to Scraper
                    </button>
                </div>
            ) : (
                <div className="bg-background border border-border rounded-2xl shadow-xl overflow-x-auto">
                    <table className="w-full text-left border-collapse min-w-[800px]">
                        <thead>
                            <tr className="border-b border-border text-foreground/40 text-[11px] uppercase tracking-widest bg-foreground/[0.02]">
                                <th className="p-4 pl-6 w-10">Select</th>
                                <th className="p-4">Community</th>
                                <th className="p-4">Type</th>
                                <th className="p-4 text-right">Reach</th>
                                <th className="p-4 text-center pr-6">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {filteredLeads.map((lead) => {
                                const isSelected = selectedLeads.has(lead.id);
                                return (
                                    <tr key={lead.id} className={`transition-colors hover:bg-foreground/[0.01] ${isSelected ? 'bg-indigo-500/5' : ''}`}>
                                        <td className="p-4 pl-6">
                                            <button
                                                onClick={() => toggleSelection(lead.id)}
                                                className={`w-5 h-5 rounded flex items-center justify-center border transition-all ${isSelected ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-border'}`}
                                            >
                                                {isSelected && <CheckCircle2 size={14} />}
                                            </button>
                                        </td>
                                        <td className="p-4 max-w-[300px]">
                                            <div className="flex items-center gap-3">
                                                <div className={`w-10 shrink-0 h-10 rounded-xl flex items-center justify-center ${lead.type === 'channel' ? 'bg-amber-500/10 text-amber-500' : 'bg-blue-500/10 text-blue-500'}`}>
                                                    {lead.type === 'channel' ? <Megaphone size={18} /> : <UsersRound size={18} />}
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <div className="font-bold text-sm text-foreground truncate break-words whitespace-normal line-clamp-2" title={lead.title}>{lead.title}</div>
                                                    {lead.username && (
                                                        <a href={`https://t.me/${lead.username}`} target="_blank" className="text-[10px] text-indigo-500 hover:underline font-mono">@{lead.username}</a>
                                                    )}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="p-4">
                                            <span className="text-[10px] font-black uppercase tracking-tighter px-2 py-1 rounded bg-foreground/5 border border-border">
                                                {lead.type}
                                            </span>
                                        </td>
                                        <td className="p-4 text-right">
                                            <div className="font-bold text-sm text-foreground">{lead.participants_count.toLocaleString()}</div>
                                            <div className="text-[10px] text-foreground/30 font-bold uppercase">{lead.country}</div>
                                        </td>
                                        <td className="p-4 pr-6">
                                            <div className="flex items-center justify-end gap-2">
                                                <button 
                                                    onClick={() => handleSingleJoin(lead.id, lead.username)}
                                                    className="p-2 text-foreground/40 hover:text-emerald-500 transition-colors"
                                                    title="Join Community"
                                                >
                                                    <UserPlus size={18} />
                                                </button>
                                                <button 
                                                    onClick={() => setExtractingGroup(lead.username || lead.id)}
                                                    className="p-2 text-foreground/40 hover:text-indigo-500 transition-colors"
                                                    title="Extract Members"
                                                >
                                                    <Shield size={18} />
                                                </button>
                                                <button 
                                                    onClick={() => handleDelete(lead.id)}
                                                    className="p-2 text-foreground/40 hover:text-red-500 transition-colors"
                                                    title="Remove Lead"
                                                >
                                                    <Trash2 size={18} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Member Extraction Modal */}
            {extractingGroup && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[200] flex items-center justify-center p-6">
                    <div className="bg-card border border-border rounded-[32px] w-full max-w-md shadow-2xl animate-in zoom-in-95 duration-300">
                        <div className="p-8 border-b border-border flex justify-between items-center">
                            <h3 className="font-bold text-xl text-foreground tracking-tight">Extract Members</h3>
                            <button onClick={() => setExtractingGroup(null)} className="text-foreground/20 hover:text-foreground"><X size={24} /></button>
                        </div>
                        <div className="p-8 space-y-6">
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-foreground/30 uppercase tracking-widest">Select Account</label>
                                <select 
                                    className="w-full bg-input border border-border rounded-xl py-4 px-4 text-sm text-foreground"
                                    value={extractingPhone}
                                    onChange={(e) => setExtractingPhone(e.target.value)}
                                >
                                    {accounts.map(acc => <option key={acc.phone_number} value={acc.phone_number}>{acc.phone_number}</option>)}
                                </select>
                            </div>
                            <div className="bg-amber-500/10 p-4 rounded-xl border border-amber-500/20">
                                <p className="text-xs text-amber-500/80 leading-relaxed font-medium">
                                    Member extraction works best on <strong>Public Groups</strong>. Private groups require the account to be a member already.
                                </p>
                            </div>
                            <button 
                                onClick={handleExtract}
                                disabled={isExtracting}
                                className="w-full bg-indigo-500 hover:bg-indigo-600 text-white py-4 rounded-2xl text-sm font-black shadow-xl shadow-indigo-500/20 disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                {isExtracting ? <Loader2 size={18} className="animate-spin" /> : "Start Extraction"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

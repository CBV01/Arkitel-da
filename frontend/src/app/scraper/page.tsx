"use client";

import React, { useState, useRef } from 'react';
import { Search, Loader2, Users, UsersRound, Megaphone, CheckCircle2, X, ExternalLink, Plus, AlertCircle } from 'lucide-react';
import { apiFetch } from '@/lib/auth';

interface ScrapeResult {
    id: string;
    title: string;
    username: string | null;
    participants_count: number;
    type: string;
    is_private: boolean;
    country: string;
    user_shows: number;
    global_shows: number;
}

export default function ScraperPage() {
    const [keyword, setKeyword] = useState('');
    const [country, setCountry] = useState('');
    const [scrapeStatus, setScrapeStatus] = useState('');
    const abortControllerRef = useRef<AbortController | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [results, setResults] = useState<ScrapeResult[]>([]);
    const [searched, setSearched] = useState(false);
    const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
    const [filter, setFilter] = useState<'all' | 'group' | 'channel'>('all');
    const [joining, setJoining] = useState(false);
    const [saving, setSaving] = useState(false);

    // Member Extraction State
    const [isExtracting, setIsExtracting] = useState(false);
    const [extractingTarget, setExtractingTarget] = useState<string | null>(null);
    const [extractedMembers, setExtractedMembers] = useState<any[]>([]);
    const [memberLoading, setMemberLoading] = useState(false);

    const handleExtractMembers = async (groupId: string) => {
        setExtractingTarget(groupId);
        setIsExtracting(true);
        setMemberLoading(true);
        setExtractedMembers([]);
        setError('');
        try {
            // Get first available account for extraction
            const accRes = await apiFetch('/api/telegram/accounts');
            const accData = await accRes.json();
            const phoneNumber = accData.accounts?.[0]?.phone_number;

            if (!phoneNumber) {
                setError('No connected account found for extraction.');
                setMemberLoading(false);
                return;
            }

            const res = await apiFetch('/api/telegram/extract', {
                method: 'POST',
                body: JSON.stringify({ group_id: groupId, phone_number: phoneNumber })
            });
            const data = await res.json();
            if (res.ok) {
                // Success - the backend already saved to DB, so we can just show a success msg or fetch members
                alert(`Successfully extracted ${data.count} members as Leads!`);
                setIsExtracting(false);
            } else {
                setError(data.detail || 'Failed to extract members');
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setMemberLoading(false);
        }
    };

    const handleJoin = async (groupId: string) => {
        try {
            const accRes = await apiFetch('/api/telegram/accounts');
            const accData = await accRes.json();
            const phoneNumber = accData.accounts?.[0]?.phone_number;
            if (!phoneNumber) throw new Error("No connected account.");

            const res = await apiFetch('/api/telegram/join', {
                method: 'POST',
                body: JSON.stringify({ group_id: groupId, phone_number: phoneNumber })
            });
            const data = await res.json();
            if (res.ok) {
                alert(`Successfully joined ${groupId}`);
            } else {
                setError(data.detail || `Error joining: ${data.detail}`);
            }
        } catch (err: any) {
            setError(err.message);
        }
    };

    const handleBulkJoin = async () => {
        if (selectedGroups.size === 0) return;
        setJoining(true);
        setError('');
        try {
            const accRes = await apiFetch('/api/telegram/accounts');
            const accData = await accRes.json();
            const phoneNumber = accData.accounts?.[0]?.phone_number;

            if (!phoneNumber) throw new Error('No connected account found.');

            const res = await apiFetch('/api/telegram/bulk-join', {
                method: 'POST',
                body: JSON.stringify({ 
                    group_ids: Array.from(selectedGroups), 
                    phone_number: phoneNumber 
                })
            });
            const data = await res.json();
            if (res.ok) {
                alert(`Bulk operation complete. Joined ${data.joined} entities with human intervals.`);
                setSelectedGroups(new Set());
            } else {
                setError(data.detail || 'Bulk join failed');
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setJoining(false);
        }
    };

    const handleSaveToLeads = async () => {
        if (selectedGroups.size === 0) return;
        setSaving(true);
        try {
            const groupsToSave = results.filter(r => selectedGroups.has(r.id));
            const res = await apiFetch('/api/telegram/leads/groups/bulk-save', {
                method: 'POST',
                body: JSON.stringify(groupsToSave)
            });
            if (res.ok) {
                alert(`Successfully saved ${selectedGroups.size} groups to Leads.`);
                setSelectedGroups(new Set());
            } else {
                const d = await res.json();
                setError(d.detail || 'Failed to save leads.');
            }
        } catch (e: any) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    };

    const handleSearch = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (!keyword.trim()) return;

        setLoading(true);
        setError('');
        setSearched(true);
        setResults([]);
        setScrapeStatus('Connecting to Scrape Engine...');

        if (abortControllerRef.current) abortControllerRef.current.abort();
        const controller = new AbortController();
        abortControllerRef.current = controller;

        try {
            const token = localStorage.getItem('tg_auth_token') || '';
            const apiBase = (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/$/, '');
            const cStr = country.trim() ? `&country=${encodeURIComponent(' ' + country.trim())}` : '';
            const res = await fetch(`${apiBase}/api/telegram/scrape_stream?query=${encodeURIComponent(keyword)}${cStr}&limit=500`, {
                headers: { 'Authorization': `Bearer ${token}` },
                signal: controller.signal
            });

            if (!res.body) throw new Error("No readable stream available");

            const reader = res.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let done = false;

            while (!done) {
                const { value, done: readerDone } = await reader.read();
                done = readerDone;
                if (value) {
                    const chunk = decoder.decode(value, { stream: true });
                    const lines = chunk.split('\n');
                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const dataStr = line.replace('data: ', '').trim();
                            if (dataStr) {
                                try {
                                    const parsed = JSON.parse(dataStr);
                                    if (parsed.type === 'progress') {
                                        setScrapeStatus(parsed.msg);
                                    } else if (parsed.type === 'result') {
                                        setResults(prev => {
                                            if (prev.find(p => p.id === parsed.data.id)) return prev;
                                            return [...prev, parsed.data];
                                        });
                                    } else if (parsed.type === 'done') {
                                        setScrapeStatus('Scrape Complete!');
                                    } else if (parsed.type === 'error') {
                                        setError(parsed.msg);
                                    }
                                } catch (e) {
                                    console.error("Parse err", e);
                                }
                            }
                        }
                    }
                }
            }
        } catch (err: any) {
            if (err.name === 'AbortError') {
                setScrapeStatus('Stopped by user');
            } else {
                setError(err.message);
            }
        } finally {
            setLoading(false);
            abortControllerRef.current = null;
        }
    };

    const handleStop = () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
            setLoading(false);
            setScrapeStatus('Stopped manually.');
        }
    };

    const toggleSelection = (id: string) => {
        const newSet = new Set(selectedGroups);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setSelectedGroups(newSet);
    };

    const filteredResults = results.filter(r => {
        if (filter === 'all') return true;
        return r.type === filter;
    });

    return (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-700">
            <header className="flex justify-between items-center mb-10">
                <div>
                    <h2 className="text-2xl font-bold mb-1 tracking-tight text-foreground">Scraper</h2>
                    <p className="text-sm text-foreground/60">Discover new groups and extract target members.</p>
                </div>
                <div className="flex gap-3">
                    {selectedGroups.size > 0 && (
                        <button 
                            onClick={handleSaveToLeads}
                            disabled={saving}
                            className="bg-emerald-600 hover:bg-emerald-500 transition-all text-white px-5 py-2.5 rounded-xl text-sm font-semibold shadow-lg shadow-emerald-500/20 active:scale-95 flex items-center gap-2 animate-in slide-in-from-right-4 duration-300 disabled:opacity-50"
                        >
                            {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} 
                            Save {selectedGroups.size} to Leads
                        </button>
                    )}
                    {selectedGroups.size > 0 && (
                        <button 
                            onClick={handleBulkJoin}
                            disabled={joining}
                            className="bg-indigo-600 hover:bg-indigo-500 transition-all text-white px-5 py-2.5 rounded-xl text-sm font-semibold shadow-lg shadow-indigo-500/20 active:scale-95 flex items-center gap-2 animate-in slide-in-from-right-4 duration-300 disabled:opacity-50"
                        >
                            {joining ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} 
                            Bulk Join ({selectedGroups.size})
                        </button>
                    )}
                    {selectedGroups.size > 0 && (
                        <button className="bg-emerald-600 hover:bg-emerald-500 transition-all text-white px-5 py-2.5 rounded-xl text-sm font-semibold shadow-lg shadow-emerald-500/20 active:scale-95 flex items-center gap-2 animate-in slide-in-from-right-4 duration-300">
                            <CheckCircle2 size={16} /> Mark {selectedGroups.size} Targets
                        </button>
                    )}
                </div>
            </header>

            {error && (
                <div className="mb-6 p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-500 text-sm flex items-start gap-3 animate-in slide-in-from-top-2 duration-300">
                    <AlertCircle size={18} className="shrink-0 mt-0.5" />
                    <div className="flex-1">
                        <p className="font-bold mb-0.5">Notification</p>
                        <p className="opacity-80">{error}</p>
                    </div>
                    <button onClick={() => setError('')} className="p-1 hover:bg-red-500/10 rounded-lg transition-colors">
                        <X size={16} />
                    </button>
                </div>
            )}

            <div className="flex flex-col md:flex-row gap-6 mb-8 items-end">
                <form onSubmit={handleSearch} className="flex-1 bg-background border border-white/5 rounded-2xl p-6 shadow-xl relative overflow-hidden group">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/5 rounded-full blur-3xl -mr-10 -mt-10 transition-all group-hover:bg-purple-500/10 z-0"></div>
                    <label className="text-xs font-semibold tracking-wide uppercase text-foreground/50 mb-3 block relative z-10">Keyword Search</label>
                    <div className="flex gap-3 relative z-10 flex-col md:flex-row">
                        <div className="relative flex-1">
                            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-foreground/40">
                                <Search size={20} />
                            </div>
                            <input
                                type="text"
                                value={keyword}
                                onChange={(e) => setKeyword(e.target.value)}
                                className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 text-foreground rounded-xl py-3 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all placeholder:text-foreground/30"
                                placeholder="Main Search Keyword (e.g. Marketing)"
                                required
                            />
                        </div>
                        <div className="relative md:w-48 shrink-0">
                            <input
                                type="text"
                                value={country}
                                onChange={(e) => setCountry(e.target.value)}
                                className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 text-foreground rounded-xl py-3 px-4 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all placeholder:text-foreground/30"
                                placeholder="Suffix (e.g. Europe)"
                            />
                        </div>
                        <button
                            type="submit"
                            disabled={loading || !keyword}
                            className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-70 transition-all text-white px-8 py-3 rounded-xl text-sm font-semibold shadow-lg shadow-indigo-500/20 active:scale-95 flex justify-center items-center gap-2 min-w-[140px]"
                        >
                            {loading ? <Loader2 size={18} className="animate-spin" /> : (
                                <>
                                    Search <Search size={16} />
                                </>
                            )}
                        </button>
                    </div>
                </form>

                <div className="bg-foreground/5 border border-border p-1.5 rounded-2xl flex gap-1 h-fit mb-1">
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
            </div>

            {/* Results Area */}
            {loading && results.length === 0 ? (
                <div className="border border-dashed border-border rounded-3xl p-16 flex flex-col items-center justify-center text-center relative overflow-hidden bg-card shadow-2xl">
                    <div className="absolute inset-0 bg-indigo-500/[0.02] animate-pulse"></div>
                    <Loader2 className="w-12 h-12 text-indigo-500 animate-spin mb-6 relative z-10" />
                    <p className="text-xl text-foreground font-black mb-3 relative z-10 tracking-tight">{scrapeStatus}</p>
                    
                    <div className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 border border-amber-500/20 rounded-full mb-8 relative z-10">
                        <AlertCircle size={14} className="text-amber-500" />
                        <p className="text-[10px] font-black text-amber-500 uppercase tracking-[0.2em]">
                            DO NOT CLOSE OR REFRESH: DISCOVERY IN PROGRESS
                        </p>
                    </div>

                    <button onClick={handleStop} className="px-8 py-3 bg-red-500/10 hover:bg-red-500/20 text-red-500 font-bold rounded-2xl text-xs transition-all border border-red-500/20 relative z-10 shadow-lg shadow-red-500/10 active:scale-95 uppercase tracking-widest">
                        Abort Scan
                    </button>
                </div>
            ) : searched && results.length === 0 && !loading ? (
                <div className="border border-dashed border-black/10 dark:border-white/10 rounded-2xl p-16 flex flex-col items-center justify-center text-center">
                    <div className="w-16 h-16 bg-black/5 dark:bg-white/5 rounded-full flex items-center justify-center mb-4 text-foreground/40">
                        <Search size={24} />
                    </div>
                    <p className="text-sm font-semibold text-foreground mb-1">No results found</p>
                    <p className="text-xs text-foreground/50">Try a different keyword to find Telegram groups.</p>
                </div>
            ) : results.length > 0 ? (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    {loading && (
                        <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-[32px] p-6 flex flex-col md:flex-row gap-6 items-center justify-between shadow-2xl relative overflow-hidden">
                            <div className="absolute top-0 left-0 w-full h-1 bg-indigo-500/20">
                                <div className="h-full bg-indigo-500 animate-[shimmer_2s_infinite] w-full"></div>
                            </div>
                            <div className="flex items-center gap-5">
                                <div className="relative">
                                    <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
                                    <div className="absolute inset-0 bg-indigo-500/20 blur-xl animate-pulse"></div>
                                </div>
                                <div className="flex flex-col">
                                    <h4 className="text-lg font-black text-foreground tracking-tight mb-0.5">{scrapeStatus}</h4>
                                    <div className="flex items-center gap-3">
                                        <p className="text-xs text-foreground/50 font-bold uppercase tracking-wider">Found <span className="text-indigo-400">{results.length}</span> Communities</p>
                                        <div className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                                            <AlertCircle size={10} className="text-amber-500" />
                                            <span className="text-[9px] font-black text-amber-500 uppercase tracking-tighter">Stay on this page</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <button onClick={handleStop} className="px-8 py-3.5 bg-red-500/10 hover:bg-red-500/20 text-red-500 font-black rounded-2xl text-[10px] uppercase tracking-[0.2em] transition-all border border-red-500/20 active:scale-95 whitespace-nowrap shadow-xl shadow-red-500/5">
                                Terminate Feed
                            </button>
                        </div>
                    )}
                    <div className="bg-background border border-white/5 dark:border-white/5 border-black/5 rounded-2xl overflow-x-auto shadow-xl shadow-black/5 dark:shadow-black/20">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-black/5 dark:border-white/5 text-foreground/50 text-[11px] uppercase tracking-wider bg-black/[0.02] dark:bg-white/[0.02]">
                                <th className="font-semibold p-4 pl-6 w-10">Select</th>
                                <th className="font-semibold p-4">Group / Channel Name</th>
                                <th className="font-semibold p-4">Type</th>
                                <th className="font-semibold p-4 text-center">Appearances</th>
                                <th className="font-semibold p-4 text-right">Members</th>
                                <th className="font-semibold p-4 text-center pr-6">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-black/5 dark:divide-white/5 whitespace-nowrap">
                            {filteredResults.map((result) => {
                                const isSelected = selectedGroups.has(result.id);
                                 return (
                                     <tr key={result.id} className={`transition-colors group ${isSelected ? 'bg-indigo-500/5' : 'hover:bg-black/[0.02] dark:hover:bg-white/[0.02]'}`}>
                                         <td className="p-4 pl-6">
                                             <button
                                                 onClick={() => toggleSelection(result.id)}
                                                 className={`w-5 h-5 rounded flex items-center justify-center border transition-all ${isSelected ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-foreground/20 hover:border-indigo-500'}`}
                                             >
                                                 {isSelected && <CheckCircle2 size={14} />}
                                             </button>
                                         </td>
                                         <td className="p-4 max-w-[300px]">
                                             <div className="flex items-center gap-3">
                                                 <div className={`w-10 shrink-0 h-10 rounded-xl flex items-center justify-center ${result.type === 'channel' ? 'bg-amber-500/10 text-amber-500' : 'bg-blue-500/10 text-blue-500'}`}>
                                                     {result.type === 'channel' ? <Megaphone size={18} /> : <UsersRound size={18} />}
                                                 </div>
                                                 <div className="min-w-0 flex-1">
                                                     <div className="font-semibold text-sm text-foreground mb-0.5 leading-tight break-words whitespace-normal line-clamp-2" title={result.title}>{result.title}</div>
                                                     <div className="flex items-center gap-2">
                                                       {result.username ? (
                                                           <a href={`https://t.me/${result.username}`} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-500 hover:text-indigo-400 flex items-center gap-1 font-mono">
                                                               @{result.username} <ExternalLink size={10} />
                                                           </a>
                                                       ) : (
                                                           <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 font-bold tracking-wider uppercase">Private</span>
                                                       )}
                                                       <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 font-bold uppercase tracking-widest">{result.country}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="p-4">
                                            <span className="text-[10px] font-black text-foreground/40 uppercase tracking-widest bg-foreground/5 border border-border px-2.5 py-1.5 rounded-lg">
                                                {result.type}
                                            </span>
                                        </td>
                                        <td className="p-4 text-center">
                                            <div className="flex flex-col items-center gap-1">
                                                <div className="text-[10px] font-bold text-foreground/60 uppercase tracking-wider">
                                                    You: <span className="text-indigo-400">{result.user_shows || 1}</span>
                                                </div>
                                                <div className="text-[10px] font-bold text-foreground/40 uppercase tracking-wider">
                                                    Global: <span className="text-emerald-400">{result.global_shows || 1}</span>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="p-4 text-right">
                                            <span className="text-sm font-bold text-foreground/80 tracking-tight">{result.participants_count.toLocaleString()}</span>
                                            <span className="text-[10px] text-foreground/20 block font-bold uppercase mt-0.5 tracking-tighter">Net Reach</span>
                                        </td>
                                        <td className="p-4 pr-6">
                                            <div className="flex items-center justify-end gap-2">
                                                <button
                                                    onClick={() => handleExtractMembers(result.username || result.id.toString())}
                                                    className="text-[10px] font-black uppercase tracking-widest px-4 py-2 rounded-xl bg-foreground/5 hover:bg-foreground/10 text-foreground/40 hover:text-foreground transition-all border border-border"
                                                >
                                                    Extract
                                                </button>
                                                <button
                                                    onClick={() => handleJoin(result.username || result.id.toString())}
                                                    className="text-[10px] font-black uppercase tracking-widest px-4 py-2 rounded-xl bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-400 transition-all border border-indigo-500/20"
                                                >
                                                    Join
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
                </div>
            ) : (
                /* Initial state */
                <div className="border border-dashed border-black/10 dark:border-white/10 rounded-2xl p-16 flex flex-col items-center justify-center text-center">
                    <div className="w-16 h-16 bg-black/5 dark:bg-white/5 rounded-full flex items-center justify-center mb-4 text-foreground/20">
                        <Search size={32} />
                    </div>
                    <p className="text-sm font-semibold text-foreground mb-1">Enter a keyword</p>
                    <p className="text-xs text-foreground/50">Search for niches to find relevant communities to target.</p>
                </div>
            )}

            {/* Member Extraction Modal */}
            {isExtracting && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
                    <div className="bg-background border border-white/10 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="flex justify-between items-center p-6 border-b border-black/5 dark:border-white/5">
                            <h3 className="font-semibold text-lg text-foreground flex items-center gap-2">
                                <Users size={18} className="text-indigo-500" /> Member Extraction
                            </h3>
                            <button
                                onClick={() => setIsExtracting(false)}
                                className="text-foreground/50 hover:text-foreground transition-colors p-1"
                            >
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-6 max-h-[60vh] overflow-y-auto">
                            {memberLoading ? (
                                <div className="py-12 flex flex-col items-center">
                                    <Loader2 className="w-8 h-8 text-indigo-500 animate-spin mb-4" />
                                    <p className="text-sm text-foreground/60">Fetching participant list...</p>
                                </div>
                            ) : extractedMembers.length > 0 ? (
                                <div className="space-y-3">
                                    {extractedMembers.map((member, idx) => (
                                        <div key={idx} className="flex items-center justify-between p-3 rounded-xl bg-foreground/5 border border-border">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-full bg-indigo-500/20 text-indigo-500 flex items-center justify-center text-xs font-bold">
                                                    {member.first_name?.[0] || 'U'}
                                                </div>
                                                <div>
                                                    <div className="text-sm font-semibold text-foreground">{member.first_name} {member.last_name || ''}</div>
                                                    {member.username && <div className="text-xs text-indigo-500">@{member.username}</div>}
                                                </div>
                                            </div>
                                            {member.is_bot && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 font-bold border border-amber-500/10">BOT</span>}
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-center py-12 text-foreground/50 text-sm">No members found or access restricted.</p>
                            )}
                        </div>
                        <div className="p-6 border-t border-black/5 dark:border-white/5 flex justify-end">
                            <button
                                onClick={() => setIsExtracting(false)}
                                className="px-6 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-500 transition-all shadow-lg shadow-indigo-500/20"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

"use client";

import React, { useState, useRef } from 'react';
import { Search, Loader2, Users, UsersRound, Megaphone, CheckCircle2, X, ExternalLink, Plus, AlertCircle } from 'lucide-react';
import { apiFetch } from '@/lib/auth';
import { Preloader } from '@/components/Preloader';
import { MonetizationOverlay } from '@/components/MonetizationOverlay';

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
    is_member?: boolean;
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
    const [successMsg, setSuccessMsg] = useState('');
    const [bulkJoinProgress, setBulkJoinProgress] = useState<{current: number, total: number, msg: string, logs: string[]}>({current: 0, total: 0, msg: '', logs: []});
    const [isBulkJoining, setIsBulkJoining] = useState(false);

    // Member Extraction State
    const [isExtracting, setIsExtracting] = useState(false);
    const [extractingTarget, setExtractingTarget] = useState<string | null>(null);
    const [extractedMembers, setExtractedMembers] = useState<any[]>([]);
    const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());
    const [memberLoading, setMemberLoading] = useState(false);
    const [bulkSaving, setBulkSaving] = useState(false);

    const handleExtractMembers = async (groupId: string) => {
        setExtractingTarget(groupId);
        setIsExtracting(true);
        setMemberLoading(true);
        setExtractedMembers([]);
        setSelectedMembers(new Set());
        setError('');
        try {
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
                setExtractedMembers(data.members || []);
            } else {
                setError(data.detail || 'Failed to extract members');
                setIsExtracting(false);
            }
        } catch (err: any) {
            setError(err.message);
            setIsExtracting(false);
        } finally {
            setMemberLoading(false);
        }
    };

    const handleSaveMembers = async () => {
        if (selectedMembers.size === 0) return;
        setBulkSaving(true);
        try {
            const toSave = extractedMembers
                .filter(m => selectedMembers.has(m.id))
                .map(m => ({
                    id: m.id,
                    username: m.username,
                    first_name: m.first_name,
                    last_name: m.last_name,
                    phone: m.phone,
                    group_id: extractingTarget
                }));

            const res = await apiFetch('/api/telegram/leads/members/bulk-save', {
                method: 'POST',
                body: JSON.stringify(toSave)
            });

            if (res.ok) {
                setSuccessMsg(`Successfully saved ${selectedMembers.size} members to Leads.`);
                setTimeout(() => setSuccessMsg(''), 5000);
                setIsExtracting(false);
            } else {
                const d = await res.json();
                setError(d.detail || 'Failed to save members.');
            }
        } catch (e: any) {
            setError(e.message);
        } finally {
            setBulkSaving(false);
        }
    };

    const handleJoin = async (groupId: string) => {
        try {
            const accRes = await apiFetch('/api/telegram/accounts');
            const accData = await accRes.json();
            // Find first active account
            const activeAcc = accData.accounts?.find((a: any) => a.status === 'active') || accData.accounts?.[0];
            const phoneNumber = activeAcc?.phone_number;
            if (!phoneNumber) throw new Error("No connected account.");

            const res = await apiFetch('/api/telegram/join', {
                method: 'POST',
                body: JSON.stringify({ group_id: groupId, phone_number: phoneNumber })
            });
            const data = await res.json();
            if (res.ok) {
                setSuccessMsg(`Successfully joined ${groupId}`);
                setTimeout(() => setSuccessMsg(''), 5000);
                // Mark as joined in the results list
                setResults(prev => prev.map(r =>
                    (r.id === groupId || r.username === groupId) ? { ...r, is_member: true } : r
                ));
            } else {
                setError(data.detail || `Error joining: ${data.detail}`);
            }
        } catch (err: any) {
            setError(err.message);
        }
    };

    const handleBulkJoin = async () => {
        if (selectedGroups.size === 0) return;
        setIsBulkJoining(true);
        setBulkJoinProgress({ current: 0, total: selectedGroups.size, msg: 'Initializing automation...', logs: [] });
        setError('');
        
        try {
            const accRes = await apiFetch('/api/telegram/accounts');
            const accData = await accRes.json();
            const activeAcc = accData.accounts?.find((a: any) => a.status === 'active');
            const phoneNumber = activeAcc?.phone_number || accData.accounts?.[0]?.phone_number;
            if (!phoneNumber) throw new Error('No connected account found.');

            const token = localStorage.getItem('tg_auth_token') || '';
            const gIds = JSON.stringify(Array.from(selectedGroups));
            const apiBase = (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/$/, '');
            
            const eventSource = new EventSource(`${apiBase}/api/telegram/bulk-join/stream?group_ids=${encodeURIComponent(gIds)}&phone_number=${phoneNumber}&token=${token}`);

            eventSource.onmessage = (event) => {
                const data = JSON.parse(event.data);
                if (data.type === 'progress') {
                    setBulkJoinProgress(prev => ({
                        ...prev,
                        current: data.idx,
                        msg: data.msg,
                        logs: [data.msg, ...prev.logs].slice(0, 10)
                    }));
                } else if (data.type === 'joined') {
                    setBulkJoinProgress(prev => ({
                        ...prev,
                        msg: `Successfully joined ${data.name}`,
                        logs: [`✅ Joined ${data.name}`, ...prev.logs]
                    }));
                    // Update result list to show joined status
                    setResults(prev => prev.map(r => r.id === data.name || r.username === data.name ? {...r, is_member: true} : r));
                } else if (data.type === 'failed') {
                    setBulkJoinProgress(prev => ({
                        ...prev,
                        logs: [`❌ Failed ${data.name}: ${data.reason}`, ...prev.logs]
                    }));
                } else if (data.type === 'done') {
                    eventSource.close();
                    setSuccessMsg(`Bulk join complete: ${data.joined} joined, ${data.failed} failed.`);
                    setIsBulkJoining(false);
                    setSelectedGroups(new Set());
                } else if (data.type === 'error' || data.type === 'flood') {
                    setError(data.msg);
                    eventSource.close();
                    setIsBulkJoining(false);
                }
            };

            eventSource.onerror = (e) => {
                console.error("SSE Error:", e);
                eventSource.close();
                setIsBulkJoining(false);
                setError("Connection lost during bulk join.");
            };

        } catch (err: any) {
            setError(err.message);
            setIsBulkJoining(false);
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
                setSuccessMsg(`Successfully saved ${selectedGroups.size} groups to Leads.`);
                setTimeout(() => setSuccessMsg(''), 5000);
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

        // Immediately notify sidebar – backend increments keyword count before streaming starts
        window.dispatchEvent(new Event('update_status'));

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

            if (res.status === 403) {
                const data = await res.json();
                setError(data.detail || "Daily usage limit reached for scraping.");
                setLoading(false);
                setScrapeStatus(''); // Clear the connecting status
                return;
            }

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.detail || "Search failed.");
            }

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
                                        // Notify sidebar to refresh keyword count
                                        window.dispatchEvent(new Event('update_status'));
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
            // Always refresh sidebar status counts after scrape ends
            window.dispatchEvent(new Event('update_status'));
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

    const toggleSelection = (id: string | number) => {
        const idStr = String(id);
        const newSet = new Set(selectedGroups);
        if (newSet.has(idStr)) newSet.delete(idStr);
        else newSet.add(idStr);
        setSelectedGroups(newSet);
    };

    const filteredResults = results.filter(r => {
        if (filter === 'all') return true;
        return r.type === filter;
    });

    const toggleSelectAll = () => {
        if (filteredResults.length === 0) return;
        
        const allAlreadySelected = filteredResults.every(r => selectedGroups.has(String(r.id)));
        
        const newSelected = new Set(selectedGroups);
        if (allAlreadySelected) {
            // Deselect only the currently visible ones
            filteredResults.forEach(r => newSelected.delete(String(r.id)));
        } else {
            // Select all visible ones
            filteredResults.forEach(r => newSelected.add(String(r.id)));
        }
        setSelectedGroups(newSelected);
    };

    return (
        <MonetizationOverlay featureName="Group Scraper">
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-700">
            {successMsg && (
                <div className="fixed top-8 right-8 z-[100] bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3 animate-in fade-in slide-in-from-top-4 duration-500">
                    <CheckCircle2 size={20} />
                    <span className="font-bold text-sm">{successMsg}</span>
                </div>
            )}

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
                            disabled={isBulkJoining}
                            className="bg-indigo-600 hover:bg-indigo-500 transition-all text-white px-5 py-2.5 rounded-xl text-sm font-semibold shadow-lg shadow-indigo-500/20 active:scale-95 flex items-center gap-2 animate-in slide-in-from-right-4 duration-300 disabled:opacity-50"
                        >
                            {isBulkJoining ? <Loader2 size={16} className="animate-spin" /> : <Users size={16} />}
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

            {isBulkJoining && (
                <div className="mb-8 p-6 bg-indigo-600/10 border border-indigo-500/20 rounded-[28px] shadow-2xl animate-in slide-in-from-top-4 duration-500 relative overflow-hidden group">
                    <div className="absolute top-0 left-0 h-1 bg-indigo-500 transition-all duration-500" style={{ width: `${(bulkJoinProgress.current / bulkJoinProgress.total) * 100}%` }}></div>
                    <div className="flex items-center gap-4 mb-4">
                        <div className="w-12 h-12 rounded-2xl bg-indigo-500/20 flex items-center justify-center text-indigo-500 shrink-0">
                            <Users size={24} className="animate-pulse" />
                        </div>
                        <div className="flex-1">
                            <h4 className="font-bold text-indigo-400 text-sm uppercase tracking-wider mb-0.5">Automated Bulk Joining</h4>
                            <p className="text-xs text-foreground/60 font-medium">
                                Progress: {bulkJoinProgress.current} / {bulkJoinProgress.total} — <span className="text-indigo-400">{bulkJoinProgress.msg}</span>
                            </p>
                        </div>
                    </div>
                    <div className="space-y-1 max-h-24 overflow-y-auto pr-2">
                        {bulkJoinProgress.logs.map((log, i) => (
                            <div key={i} className={`text-[10px] font-mono ${i === 0 ? 'text-indigo-400' : 'text-foreground/30'}`}>{log}</div>
                        ))}
                    </div>
                </div>
            )}

            {loading && (
                <div className="mb-8 p-6 bg-amber-500/10 border border-amber-500/20 rounded-[28px] flex items-center gap-4 animate-in slide-in-from-top-4 duration-500 shadow-xl shadow-amber-500/5 relative overflow-hidden group">
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-amber-500/5 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-2000"></div>
                    <div className="w-12 h-12 rounded-2xl bg-amber-500/20 flex items-center justify-center text-amber-500 shrink-0">
                        <AlertCircle size={28} className="animate-pulse" />
                    </div>
                    <div>
                        <h4 className="font-bold text-amber-500 text-sm uppercase tracking-wider mb-0.5">Scrape Synchronization in Progress</h4>
                        <p className="text-xs text-amber-500/60 font-medium leading-relaxed">
                            Please do <span className="text-amber-500 underline underline-offset-2">NOT</span> refresh or close this page.
                            Interrupting the stream will cause loss of currently discovered leads.
                        </p>
                    </div>
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
                <Preloader message={scrapeStatus} />
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
                                    <th className="font-semibold p-4 pl-6 w-10 text-center">
                                        <button
                                            onClick={toggleSelectAll}
                                            title={filteredResults.every(r => selectedGroups.has(String(r.id))) && filteredResults.length > 0 ? 'Deselect All' : 'Select All'}
                                            className={`w-5 h-5 rounded flex items-center justify-center border transition-all mx-auto ${
                                                filteredResults.length > 0 && filteredResults.every(r => selectedGroups.has(String(r.id)))
                                                    ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm'
                                                    : 'border-foreground/20 hover:border-indigo-500'
                                            }`}
                                        >
                                            {filteredResults.length > 0 && filteredResults.every(r => selectedGroups.has(String(r.id))) && (
                                                <div className="bg-white rounded-full p-[1px]">
                                                    <CheckCircle2 size={12} className="text-indigo-600 fill-current" />
                                                </div>
                                            )}
                                        </button>
                                    </th>
                                    <th className="font-semibold p-4">Group / Channel Name</th>
                                    <th className="font-semibold p-4">Type</th>
                                    <th className="font-semibold p-4 text-center">Appearances</th>
                                    <th className="font-semibold p-4 text-right">Members</th>
                                    <th className="font-semibold p-4 text-center pr-6">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-black/5 dark:divide-white/5 whitespace-nowrap">
                                {filteredResults.map((result) => {
                                    const isSelected = selectedGroups.has(String(result.id));
                                    return (
                                        <tr key={result.id} className={`transition-colors group ${isSelected ? 'bg-indigo-500/5' : 'hover:bg-black/[0.02] dark:hover:bg-white/[0.02]'}`}>
                                            <td className="p-4 pl-6">
                                                <button
                                                    onClick={() => toggleSelection(result.id)}
                                                    className={`w-5 h-5 rounded flex items-center justify-center border transition-all ${isSelected ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm' : 'border-foreground/20 hover:border-indigo-500'}`}
                                                >
                                                    {isSelected && (
                                                        <div className="bg-white rounded-full p-[1px]">
                                                            <CheckCircle2 size={12} className="text-indigo-600 fill-current" />
                                                        </div>
                                                    )}
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
                                                    {result.is_member ? (
                                                        <span className="text-[10px] font-black uppercase tracking-widest px-6 py-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-2">
                                                            <CheckCircle2 size={12} /> Joined
                                                        </span>
                                                    ) : (
                                                        <>
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
                                                        </>
                                                    )}
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
                            <div>
                                <h3 className="font-semibold text-lg text-foreground flex items-center gap-2">
                                    <Users size={18} className="text-indigo-500" /> Member Extraction
                                </h3>
                                <p className="text-xs text-foreground/40">{extractedMembers.length} members found</p>
                            </div>
                            <div className="flex items-center gap-3">
                                {extractedMembers.length > 0 && (
                                    <button
                                        onClick={() => {
                                            if (selectedMembers.size === extractedMembers.length) setSelectedMembers(new Set());
                                            else setSelectedMembers(new Set(extractedMembers.map(m => m.id)));
                                        }}
                                        className="text-xs font-bold text-indigo-400 hover:text-indigo-300 transition-colors"
                                    >
                                        {selectedMembers.size === extractedMembers.length ? 'Deselect All' : 'Select All'}
                                    </button>
                                )}
                                <button
                                    onClick={() => setIsExtracting(false)}
                                    className="text-foreground/50 hover:text-foreground transition-colors p-1"
                                >
                                    <X size={20} />
                                </button>
                            </div>
                        </div>
                        <div className="p-6 max-h-[60vh] overflow-y-auto">
                            {memberLoading ? (
                                <div className="py-12 flex flex-col items-center">
                                    <Loader2 className="w-8 h-8 text-indigo-500 animate-spin mb-4" />
                                    <p className="text-sm text-foreground/60">Fetching participant list...</p>
                                </div>
                            ) : extractedMembers.length > 0 ? (
                                <div className="space-y-2">
                                    {extractedMembers.map((member, idx) => {
                                        const isSel = selectedMembers.has(member.id);
                                        return (
                                            <div 
                                                key={idx} 
                                                onClick={() => {
                                                    const n = new Set(selectedMembers);
                                                    if (n.has(member.id)) n.delete(member.id);
                                                    else n.add(member.id);
                                                    setSelectedMembers(n);
                                                }}
                                                className={`flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer ${isSel ? 'bg-indigo-500/10 border-indigo-500/30' : 'bg-foreground/5 border-transparent hover:border-white/10'}`}
                                            >
                                                <div className="flex items-center gap-3">
                                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${isSel ? 'bg-indigo-500 text-white' : 'bg-indigo-500/20 text-indigo-500'}`}>
                                                        {isSel ? <CheckCircle2 size={14} /> : (member.first_name?.[0] || 'U')}
                                                    </div>
                                                    <div>
                                                        <div className="text-sm font-semibold text-foreground">{member.first_name} {member.last_name || ''}</div>
                                                        {member.username && <div className="text-xs text-indigo-500">@{member.username}</div>}
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    {member.phone && <span className="text-[10px] text-foreground/30 font-mono">{member.phone}</span>}
                                                    {member.is_bot && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 font-bold border border-amber-500/10">BOT</span>}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <p className="text-center py-12 text-foreground/50 text-sm">No members found or access restricted.</p>
                            )}
                        </div>
                        <div className="p-6 border-t border-black/5 dark:border-white/5 flex justify-between items-center bg-black/20">
                            <p className="text-xs text-foreground/40 font-bold uppercase tracking-wider">
                                {selectedMembers.size} Selected
                            </p>
                            <div className="flex gap-3">
                                <button
                                    onClick={() => setIsExtracting(false)}
                                    className="px-6 py-2 rounded-xl text-foreground/60 text-sm font-semibold hover:text-foreground transition-all"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleSaveMembers}
                                    disabled={selectedMembers.size === 0 || bulkSaving}
                                    className="px-6 py-2 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-500 transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50 flex items-center gap-2"
                                >
                                    {bulkSaving && <Loader2 size={14} className="animate-spin" />}
                                    Add to Leads
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            </div>
        </MonetizationOverlay>
    );
}

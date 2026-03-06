"use client";

import React, { useState } from 'react';
import { Search, Loader2, Users, UsersRound, Megaphone, CheckCircle2, X, ExternalLink, Plus, AlertCircle } from 'lucide-react';
import { apiFetch } from '@/lib/auth';

interface ScrapeResult {
    id: number;
    title: string;
    username: string | null;
    participants_count: number;
    type: string;
}

export default function ScraperPage() {
    const [keyword, setKeyword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [results, setResults] = useState<ScrapeResult[]>([]);
    const [searched, setSearched] = useState(false);
    const [selectedGroups, setSelectedGroups] = useState<Set<number>>(new Set());

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
        try {
            const res = await apiFetch(`/api/telegram/members?group_id=${groupId}`);
            const data = await res.json();
            if (res.ok) {
                setExtractedMembers(data.members || []);
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
            const res = await apiFetch(`/api/telegram/join?group_id=${groupId}`, {
                method: 'POST'
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

    const handleSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!keyword.trim()) return;

        setLoading(true);
        setError('');
        setSearched(true);
        try {
            const res = await apiFetch(`/api/telegram/scrape?query=${encodeURIComponent(keyword)}&limit=15`);
            const data = await res.json();
            if (res.ok) {
                setResults(data.groups || []);
            } else {
                setError(data.detail || 'Failed to scrape results');
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const toggleSelection = (id: number) => {
        const newSet = new Set(selectedGroups);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setSelectedGroups(newSet);
    };

    return (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-700">
            <header className="flex justify-between items-center mb-10">
                <div>
                    <h2 className="text-2xl font-bold mb-1 tracking-tight text-foreground">Scraper</h2>
                    <p className="text-sm text-foreground/60">Discover new groups and extract target members.</p>
                </div>
                {selectedGroups.size > 0 && (
                    <button className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 transition-all text-white px-5 py-2.5 rounded-xl text-sm font-semibold shadow-lg shadow-emerald-500/20 active:scale-95 flex items-center gap-2 animate-in slide-in-from-right-4 duration-300">
                        <CheckCircle2 size={16} /> Added {selectedGroups.size} to Targets
                    </button>
                )}
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

            <form onSubmit={handleSearch} className="bg-background border border-white/5 dark:border-white/5 border-black/5 rounded-2xl p-6 shadow-xl shadow-black/5 dark:shadow-black/20 mb-8 relative overflow-hidden group">
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
                            placeholder="e.g. Crypto, Marketing, Real Estate..."
                            required
                            suppressHydrationWarning={true}
                        />
                    </div>
                    <button
                        type="submit"
                        disabled={loading || !keyword}
                        className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:opacity-70 transition-all text-white px-8 py-3 rounded-xl text-sm font-semibold shadow-lg shadow-indigo-500/20 active:scale-95 flex justify-center items-center gap-2 min-w-[140px]"
                    >
                        {loading ? <Loader2 size={18} className="animate-spin" /> : (
                            <>
                                Search <Search size={16} />
                            </>
                        )}
                    </button>
                </div>
            </form>

            {/* Results Area */}
            {loading ? (
                <div className="border border-dashed border-black/10 dark:border-white/10 rounded-2xl p-16 flex flex-col items-center justify-center text-center">
                    <Loader2 className="w-8 h-8 text-indigo-500 animate-spin mb-4" />
                    <p className="text-sm text-foreground/60 font-medium">Scraping Telegram directories...</p>
                </div>
            ) : searched && results.length === 0 ? (
                <div className="border border-dashed border-black/10 dark:border-white/10 rounded-2xl p-16 flex flex-col items-center justify-center text-center">
                    <div className="w-16 h-16 bg-black/5 dark:bg-white/5 rounded-full flex items-center justify-center mb-4 text-foreground/40">
                        <Search size={24} />
                    </div>
                    <p className="text-sm font-semibold text-foreground mb-1">No results found</p>
                    <p className="text-xs text-foreground/50">Try a different keyword to find Telegram groups.</p>
                </div>
            ) : results.length > 0 ? (
                <div className="bg-background border border-white/5 dark:border-white/5 border-black/5 rounded-2xl overflow-hidden shadow-xl shadow-black/5 dark:shadow-black/20 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-black/5 dark:border-white/5 text-foreground/50 text-[11px] uppercase tracking-wider bg-black/[0.02] dark:bg-white/[0.02]">
                                <th className="font-semibold p-4 pl-6 w-10">Select</th>
                                <th className="font-semibold p-4">Group / Channel Name</th>
                                <th className="font-semibold p-4">Type</th>
                                <th className="font-semibold p-4 text-right">Members</th>
                                <th className="font-semibold p-4 text-center pr-6">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-black/5 dark:divide-white/5 whitespace-nowrap">
                            {results.map((result) => {
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
                                        <td className="p-4">
                                            <div className="flex items-center gap-3">
                                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${result.type === 'channel' ? 'bg-amber-500/10 text-amber-500' : 'bg-blue-500/10 text-blue-500'}`}>
                                                    {result.type === 'channel' ? <Megaphone size={18} /> : <UsersRound size={18} />}
                                                </div>
                                                <div>
                                                    <div className="font-semibold text-sm text-foreground mb-0.5">{result.title}</div>
                                                    {result.username ? (
                                                        <a href={`https://t.me/${result.username}`} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-500 hover:text-indigo-400 flex items-center gap-1">
                                                            @{result.username} <ExternalLink size={10} />
                                                        </a>
                                                    ) : (
                                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/5 text-foreground/50 font-medium tracking-wider">PRIVATE</span>
                                                    )}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="p-4">
                                            <span className="text-xs font-medium text-foreground/60 capitalize bg-black/5 dark:bg-white/5 px-2 py-1 rounded-md">
                                                {result.type.replace('mega', '')}
                                            </span>
                                        </td>
                                        <td className="p-4 text-right">
                                            <span className="text-sm font-semibold text-foreground/80">{result.participants_count.toLocaleString()}</span>
                                            <span className="text-xs text-foreground/40 ml-1 block">subscribers</span>
                                        </td>
                                        <td className="p-4 pr-6">
                                            <div className="flex items-center justify-center gap-2">
                                                <button
                                                    onClick={() => handleExtractMembers(result.username || result.id.toString())}
                                                    className="text-[11px] font-bold px-3 py-1.5 rounded-lg bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/20 text-foreground transition-all flex items-center gap-1.5"
                                                >
                                                    <Users size={12} /> Extract
                                                </button>
                                                <button
                                                    onClick={() => handleJoin(result.username || result.id.toString())}
                                                    className="text-[11px] font-bold px-3 py-1.5 rounded-lg bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-500 transition-all flex items-center gap-1.5 border border-indigo-500/20"
                                                >
                                                    <Plus size={12} /> Join
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
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
                                        <div key={idx} className="flex items-center justify-between p-3 rounded-xl bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5">
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

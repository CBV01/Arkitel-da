"use client";

import React, { useState, useEffect, useRef } from 'react';
import { Bookmark, Loader2, Megaphone, X, Trash2, Search, UserPlus, Users, Check, CheckCircle2, XCircle, AlertTriangle, UsersRound, Shield, ChevronRight, Minus, Maximize2 } from 'lucide-react';
import { apiFetch, getToken } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import { Preloader } from '@/components/Preloader';
import { MonetizationOverlay } from '@/components/MonetizationOverlay';

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
    is_joined?: boolean;
}

interface MemberLead {
    id: number;
    group_id: string;
    username: string | null;
    first_name: string | null;
    last_name: string | null;
    created_at: string;
}

type TabType = 'all' | 'groups' | 'channels' | 'members';

export default function LeadsPage() {
    const router = useRouter();
    const [groups, setGroups] = useState<SavedGroup[]>([]);
    const [members, setMembers] = useState<MemberLead[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [activeTab, setActiveTab] = useState<TabType>('all');
    const [selectedIds, setSelectedIds] = useState<Set<string | number>>(new Set());

    // Actions state
    const [joining, setJoining] = useState(false);
    const [joinedIds, setJoinedIds] = useState<Set<string>>(new Set()); // Tracks which groups have been joined this session
    const [isDeleting, setIsDeleting] = useState(false);
    const [isExtracting, setIsExtracting] = useState(false);
    const [extractingGroup, setExtractingGroup] = useState<string | null>(null);
    const [extractingPhone, setExtractingPhone] = useState('');
    const [accounts, setAccounts] = useState<any[]>([]);
    const [copyStatus, setCopyStatus] = useState<{[key: string]: boolean}>({});

    // Bulk join progress tracker
    const [joinProgress, setJoinProgress] = useState<{
        open: boolean;
        total: number;
        joined: number;
        failed: number;
        done: boolean;
        log: { type: 'joined' | 'failed' | 'flood'; name: string; reason?: string }[];
        failedGroups: { name: string; reason: string }[];
        minimized: boolean;
    }>({
        open: false, total: 0, joined: 0, failed: 0, done: false, log: [], failedGroups: [], minimized: false
    });
    const evtSourceRef = useRef<EventSource | null>(null);

    useEffect(() => {
        fetchAllLeads();
        fetchAccounts();
    }, []);

    const fetchAllLeads = async () => {
        setLoading(true);
        try {
            const [groupsRes, membersRes, joinedRes] = await Promise.all([
                apiFetch('/api/telegram/leads/groups'),
                apiFetch('/api/telegram/leads/members'),
                apiFetch('/api/telegram/leads/joined-status')
            ]);

            const groupsData = await groupsRes.json();
            const membersData = await membersRes.json();
            const joinedData = joinedRes.ok ? await joinedRes.json() : { joined_ids: [] };

            if (groupsRes.ok) setGroups(groupsData.groups || []);
            if (membersRes.ok) setMembers(membersData.members || []);
            if (joinedRes.ok) setJoinedIds(new Set(joinedData.joined_ids || []));

            if (!groupsRes.ok || !membersRes.ok) {
                setError('Some data failed to load.');
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
                const accs = data.accounts || [];
                setAccounts(accs);
                if (accs.length > 0) setExtractingPhone(accs[0].phone_number);
            }
        } catch (e) {
            console.error("Operation failed:", e);
        }
    };

    const handleBulkJoin = async () => {
        const groupIds = Array.from(selectedIds).filter(id => typeof id === 'string') as string[];
        if (groupIds.length === 0) return;

        const activeAcc = accounts.find(a => a.is_active) || accounts.find(a => a.status === 'active') || accounts[0];
        const phoneNumber = activeAcc?.phone_number;
        if (!phoneNumber) { setError('No connected account found.'); return; }

        // Reset and open the progress modal
        setJoinProgress({ open: true, total: groupIds.length, joined: 0, failed: 0, done: false, log: [], failedGroups: [], minimized: false });
        setJoining(true);

        try {
            const token = getToken();
            const params = new URLSearchParams({
                group_ids: JSON.stringify(groupIds),
                phone_number: phoneNumber,
                token: token || ''
            });
            const apiBase = process.env.NEXT_PUBLIC_API_URL || 'https://arkitel.onrender.com';
            const evtSource = new EventSource(`${apiBase}/api/telegram/bulk-join/stream?${params.toString()}`);
            evtSourceRef.current = evtSource;

            evtSource.onmessage = (e) => {
                try {
                    const data = JSON.parse(e.data);
                    if (data.type === 'start') {
                        setJoinProgress(p => ({ ...p, total: data.total }));
                    } else if (data.type === 'joined') {
                        setJoinProgress(p => ({
                            ...p, joined: data.joined, failed: data.failed,
                            log: [{ type: 'joined', name: data.name }, ...p.log.slice(0, 49)]
                        }));
                        // Mark this group as joined in local state so the badge appears
                        setJoinedIds(prev => new Set([...prev, data.name]));
                    } else if (data.type === 'failed') {
                        setJoinProgress(p => ({
                            ...p, joined: data.joined, failed: data.failed,
                            log: [{ type: 'failed', name: data.name, reason: data.reason }, ...p.log.slice(0, 49)]
                        }));
                    } else if (data.type === 'flood') {
                        setJoinProgress(p => ({
                            ...p, log: [{ type: 'flood', name: '⚠️ Flood Wait Detected – Stopped.' }, ...p.log]
                        }));
                    } else if (data.type === 'done') {
                        setJoinProgress(p => ({
                            ...p, done: true, joined: data.joined, failed: data.failed,
                            failedGroups: data.failed_groups || []
                        }));
                        setJoining(false);
                        setSelectedIds(new Set());
                        evtSource.close();
                    } else if (data.type === 'error') {
                        setError(data.msg);
                        setJoinProgress(p => ({ ...p, done: true, log: [{ type: 'failed', name: 'BLOCKER', reason: data.msg }, ...p.log] }));
                        evtSource.close();
                        setJoining(false);
                    } else if (data.type === 'progress') {
                        setJoinProgress(p => {
                            const newLog = [...p.log];
                            // If the latest log is a safety delay or rest, replace it instead of pushing
                            const isCountdown = data.msg.includes('s...') || data.msg.includes('delay');
                            if (isCountdown && newLog.length > 0 && (newLog[0].name.includes('delay') || newLog[0].name.includes('Resuming'))) {
                                newLog[0] = { type: 'joined', name: data.msg };
                            } else {
                                newLog.unshift({ type: 'joined', name: data.msg });
                            }
                            return { ...p, log: newLog.slice(0, 50) };
                        });
                    }
                } catch { }
            };
            evtSource.onerror = () => {
                setJoinProgress(p => ({ ...p, done: true }));
                setJoining(false);
                evtSource.close();
            };
        } catch (err: any) {
            setError(err.message);
            setJoining(false);
        }
    };

    const handleCopy = (id: string | number, text: string) => {
        navigator.clipboard.writeText(text).then(() => {
            setCopyStatus(prev => ({ ...prev, [id]: true }));
            setTimeout(() => {
                setCopyStatus(prev => ({ ...prev, [id]: false }));
            }, 2000);
        }).catch(err => {
            console.error('Failed to copy: ', err);
        });
    };

    const handleBulkDelete = async () => {
        if (selectedIds.size === 0) return;
        if (!confirm(`Are you sure you want to delete ${selectedIds.size} selected leads?`)) return;

        setIsDeleting(true);
        try {
            const groupIds = Array.from(selectedIds).filter(id => typeof id === 'string');
            const memberIds = Array.from(selectedIds).filter(id => typeof id === 'number');

            const promises = [];
            if (groupIds.length > 0) {
                promises.push(apiFetch('/api/telegram/leads/groups/bulk-delete', {
                    method: 'POST',
                    body: JSON.stringify({ ids: groupIds })
                }));
            }
            if (memberIds.length > 0) {
                promises.push(apiFetch('/api/telegram/leads/members/bulk-delete', {
                    method: 'POST',
                    body: JSON.stringify({ ids: memberIds })
                }));
            }

            await Promise.all(promises);
            setSelectedIds(new Set());
            fetchAllLeads();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsDeleting(false);
        }
    };

    const handleAddToCampaign = () => {
        const groupIds = Array.from(selectedIds).filter(id => typeof id === 'string');
        if (groupIds.length === 0) {
            alert("Only groups and channels can be added to campaigns currently.");
            return;
        }
        // Save to session storage and redirect to campaigns with pre-selected groups
        sessionStorage.setItem('selected_lead_groups', JSON.stringify(groupIds));
        router.push('/campaigns?preselect=true');
    };

    const handleSingleJoin = async (id: string, username: string | null) => {
        try {
            const phoneNumber = accounts[0]?.phone_number;
            if (!phoneNumber) throw new Error("No accounts found.");

            const res = await apiFetch('/api/telegram/join', {
                method: 'POST',
                body: JSON.stringify({ group_id: username || id, phone_number: phoneNumber })
            });
            if (res.ok) {
                // Mark as joined immediately in UI so the button changes to a badge
                setJoinedIds(prev => new Set([...prev, id, username || id]));
            } else {
                const d = await res.json();
                setError(d.detail || 'Join failed');
            }
        } catch (e: any) {
            setError(e.message);
        }
    };

    const handleDeleteSingle = async (id: string | number, type: 'group' | 'member') => {
        if (!confirm('Are you sure you want to remove this lead?')) return;
        try {
            const url = type === 'group' ? `/api/telegram/leads/groups/${id}` : `/api/telegram/leads/members/${id}`;
            const res = await apiFetch(url, { method: 'DELETE' });
            if (res.ok) {
                fetchAllLeads();
            }
        } catch (e) {
            console.error("Operation failed:", e);
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
                alert(`Successfully extracted ${data.count} members! Switched to Members tab to view.`);
                setExtractingGroup(null);
                setActiveTab('members');
                fetchAllLeads(); // Refresh both
            } else {
                alert(data.detail || 'Extraction failed');
            }
        } catch (err: any) {
            alert(err.message);
        } finally {
            setIsExtracting(false);
        }
    };

    const toggleSelectAll = (isAll: boolean) => {
        if (isAll) {
            setSelectedIds(new Set());
        } else {
            const newSet = new Set<string | number>();
            visibleLeads.forEach(l => newSet.add(l.id));
            setSelectedIds(newSet);
        }
    };

    const toggleSelection = (id: string | number) => {
        const newSet = new Set(selectedIds);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setSelectedIds(newSet);
    };

    const getVisibleLeads = () => {
        let combined: any[] = [];
        if (activeTab === 'all' || activeTab === 'groups' || activeTab === 'channels') {
            const filteredGroups = groups.filter(g => {
                if (activeTab === 'groups') return g.type === 'group';
                if (activeTab === 'channels') return g.type === 'channel';
                return true;
            });
            combined = [...combined, ...filteredGroups.map(g => ({ ...g, itemType: 'community' }))];
        }

        if (activeTab === 'all' || activeTab === 'members') {
            combined = [...combined, ...members.map(m => ({ ...m, title: `${m.first_name || ''} ${m.last_name || ''}`.trim() || m.username || m.id, itemType: 'member', type: 'member' }))];
        }

        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            combined = combined.filter(l =>
                (l.title?.toLowerCase() || '').includes(q) ||
                (l.username?.toLowerCase() || '').includes(q) ||
                (l.id?.toString().toLowerCase() || '').includes(q)
            );
        }

        return combined;
    };

    const visibleLeads = getVisibleLeads();
    const isAllVisibleSelected = visibleLeads.length > 0 && visibleLeads.every(l => selectedIds.has(l.id));

    return (
        <MonetizationOverlay featureName="Vault Leads">
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 min-h-[calc(100vh-100px)] flex flex-col pt-2">

                {/* ---- Bulk Join Progress Modal ---- */}
                {joinProgress.open && (
                    <div className={`fixed z-[200] transition-all duration-500 ease-in-out ${joinProgress.minimized ? 'bottom-8 right-8 left-auto top-auto' : 'inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4'}`}>
                        <div className={`bg-card border border-border shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300 ${joinProgress.minimized ? 'w-80 rounded-2xl p-4' : 'w-full max-w-lg rounded-[28px]'}`}>

                            {joinProgress.minimized ? (
                                /* MINIMIZED VIEW */
                                <div className="flex flex-col gap-3">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
                                            <span className="text-xs font-bold text-foreground">Joining Progress</span>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <button onClick={() => setJoinProgress(p => ({ ...p, minimized: false }))} className="p-1.5 hover:bg-foreground/5 rounded-lg text-foreground/40 transition-all">
                                                <Maximize2 size={14} />
                                            </button>
                                            <button
                                                onClick={() => {
                                                    if (!confirm("Stop joining process?")) return;
                                                    evtSourceRef.current?.close();
                                                    setJoinProgress(p => ({ ...p, open: false }));
                                                    setJoining(false);
                                                }}
                                                className="p-1.5 hover:bg-red-500/10 hover:text-red-500 rounded-lg text-foreground/40 transition-all"
                                            >
                                                <X size={14} />
                                            </button>
                                        </div>
                                    </div>
                                    <div className="space-y-1">
                                        <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-foreground/30">
                                            <span>{joinProgress.joined + joinProgress.failed}/{joinProgress.total}</span>
                                            <span>{Math.round(((joinProgress.joined + joinProgress.failed) / joinProgress.total) * 100)}%</span>
                                        </div>
                                        <div className="w-full h-1.5 bg-foreground/5 rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-indigo-500 transition-all duration-500"
                                                style={{ width: `${((joinProgress.joined + joinProgress.failed) / joinProgress.total) * 100}%` }}
                                            />
                                        </div>
                                    </div>
                                    <div className="text-[10px] font-medium text-indigo-500/80 truncate">
                                        {joinProgress.log[0]?.name || "Waiting..."}
                                    </div>
                                </div>
                            ) : (
                                /* FULL MODAL VIEW */
                                <>
                                    {/* Header */}
                                    <div className="flex items-center justify-between p-6 border-b border-border">
                                        <div className="flex items-center gap-3">
                                            <div className="p-2 bg-indigo-500/10 rounded-xl text-indigo-500">
                                                <UserPlus size={20} />
                                            </div>
                                            <div>
                                                <h3 className="font-bold text-base text-foreground">Bulk Join Progress</h3>
                                                <p className="text-xs text-foreground/40">Live tracking — {joinProgress.total} groups queued</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {!joinProgress.done && (
                                                <button
                                                    onClick={() => setJoinProgress(p => ({ ...p, minimized: true }))}
                                                    className="text-foreground/30 hover:text-indigo-500 p-1.5 hover:bg-indigo-500/10 rounded-lg transition-all"
                                                    title="Minimize"
                                                >
                                                    <Minus size={18} />
                                                </button>
                                            )}
                                            <button
                                                onClick={() => {
                                                    if (!joinProgress.done && !confirm("Closing will stop the current joining process. Use Minimize to keep it running in the background. Stop anyway?")) return;
                                                    evtSourceRef.current?.close();
                                                    setJoinProgress(p => ({ ...p, open: false }));
                                                    setJoining(false);
                                                }}
                                                className="text-foreground/30 hover:text-red-500 p-1.5 hover:bg-red-500/10 rounded-lg transition-all"
                                                title="Close"
                                            >
                                                <X size={18} />
                                            </button>
                                        </div>
                                    </div>

                                    {/* Progress Bar */}
                                    <div className="px-6 pt-5 pb-3">
                                        <div className="flex justify-between items-end mb-2">
                                            <span className="text-sm font-bold text-foreground">
                                                {joinProgress.joined + joinProgress.failed} of {joinProgress.total} processed
                                            </span>
                                            <span className="text-xs font-bold text-foreground/40 uppercase tracking-widest">
                                                {joinProgress.done ? 'Done' : 'In Progress...'}
                                            </span>
                                        </div>
                                        <div className="w-full h-3 bg-foreground/[0.05] rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 rounded-full transition-all duration-500"
                                                style={{ width: `${joinProgress.total > 0 ? ((joinProgress.joined + joinProgress.failed) / joinProgress.total) * 100 : 0}%` }}
                                            />
                                        </div>
                                        {/* Stats row */}
                                        <div className="flex gap-4 mt-3">
                                            <div className="flex items-center gap-2 text-sm font-bold text-emerald-500">
                                                <CheckCircle2 size={14} /> {joinProgress.joined} Joined
                                            </div>
                                            <div className="flex items-center gap-2 text-sm font-bold text-red-400">
                                                <XCircle size={14} /> {joinProgress.failed} Failed
                                            </div>
                                            {!joinProgress.done && (
                                                <div className="flex items-center gap-2 text-sm font-bold text-foreground/30 ml-auto">
                                                    <Loader2 size={14} className="animate-spin" /> Working...
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Live Log */}
                                    <div className="px-6 pb-3">
                                        <p className="text-[10px] font-bold uppercase tracking-widest text-foreground/30 mb-2">Live Log</p>
                                        <div className="h-40 overflow-y-auto space-y-1 custom-scrollbar pr-1">
                                            {joinProgress.log.map((entry, i) => (
                                                <div key={i} className={`flex items-start gap-2 text-xs rounded-lg px-2 py-1 ${entry.type === 'joined' ? 'bg-emerald-500/5 text-emerald-400' : entry.type === 'flood' ? 'bg-amber-500/5 text-amber-400' : 'bg-red-500/5 text-red-400'}`}>
                                                    {entry.type === 'joined' ? <CheckCircle2 size={12} className="mt-0.5 shrink-0" /> : entry.type === 'flood' ? <AlertTriangle size={12} className="mt-0.5 shrink-0" /> : <XCircle size={12} className="mt-0.5 shrink-0" />}
                                                    <span className="font-medium">{entry.name}{entry.reason && <span className="opacity-60"> — {entry.reason}</span>}</span>
                                                </div>
                                            ))}
                                            {joinProgress.log.length === 0 && <p className="text-foreground/20 text-xs">Waiting for first response...</p>}
                                        </div>
                                    </div>

                                    {/* Final Summary (only on done) */}
                                    {joinProgress.done && joinProgress.failedGroups.length > 0 && (
                                        <div className="mx-6 mb-5 p-4 bg-red-500/5 border border-red-500/10 rounded-2xl">
                                            <p className="text-xs font-bold text-red-400 uppercase tracking-widest mb-2">Failed Groups Breakdown</p>
                                            <div className="space-y-1 max-h-28 overflow-y-auto custom-scrollbar">
                                                {joinProgress.failedGroups.map((g, i) => (
                                                    <div key={i} className="text-xs text-foreground/60">
                                                        <span className="font-bold text-foreground/80">{g.name}</span>
                                                        <span className="ml-2 text-red-400/70">{g.reason}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Close button on done */}
                                    {joinProgress.done && (
                                        <div className="px-6 pb-6">
                                            <button onClick={() => setJoinProgress(p => ({ ...p, open: false }))} className="w-full py-3 bg-indigo-500 hover:bg-indigo-600 text-white font-bold rounded-2xl text-sm transition-all">
                                                Close
                                            </button>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                )}
                <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-6">
                    <div>
                        <h2 className="text-3xl font-semibold mb-2 tracking-tight text-foreground flex items-center gap-3">
                            <Bookmark className="text-indigo-500 w-8 h-8" /> Target Leads
                        </h2>
                        <p className="text-sm text-foreground/50 font-medium mb-4">Manage discovered communities and extracted target members.</p>
                        <div className="bg-amber-500/10 border border-amber-500/20 p-3.5 rounded-2xl flex items-start gap-3 max-w-xl">
                            <AlertTriangle className="text-amber-500 shrink-0 mt-0.5" size={18} />
                            <div>
                                <h4 className="text-amber-500 font-bold text-xs uppercase tracking-widest mb-1">Account Safety & Stability</h4>
                                <p className="text-xs text-amber-500/80 font-medium leading-relaxed">
                                    • Recommend joining <strong>40-50 groups max per day</strong> per account.<br />
                                    • Keep this tab <strong>open and active</strong> during bulk joining to prevent timeouts.
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-3">
                        {/* Master Select All Checkbox */}
                        <button
                            onClick={() => toggleSelectAll(isAllVisibleSelected)}
                            className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 border ${isAllVisibleSelected ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-foreground/5 border-border text-foreground/60 hover:border-indigo-500/50'}`}
                        >
                            <div className={`w-4 h-4 rounded border flex items-center justify-center ${isAllVisibleSelected ? 'bg-white border-white text-indigo-600' : 'border-current'}`}>
                                {isAllVisibleSelected && <Check size={12} strokeWidth={4} />}
                            </div>
                            {isAllVisibleSelected ? 'Deselect All' : 'Select All'}
                        </button>

                        {selectedIds.size > 0 && (
                            <>
                                <button
                                    onClick={handleBulkDelete}
                                    disabled={isDeleting}
                                    className="bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20 px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 shadow-lg shadow-red-500/5"
                                >
                                    <Trash2 size={16} /> Delete Selected ({selectedIds.size})
                                </button>
                                <button
                                    onClick={handleBulkJoin}
                                    disabled={joining}
                                    className="bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2.5 rounded-xl text-xs font-bold shadow-lg shadow-indigo-500/40 transition-all flex items-center gap-2"
                                >
                                    {joining ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
                                    Bulk Join
                                </button>
                                <button
                                    onClick={handleAddToCampaign}
                                    className="bg-foreground text-background px-5 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 hover:opacity-90"
                                >
                                    <Megaphone size={16} /> Add to Campaign
                                </button>
                            </>
                        )}
                    </div>
                </header>

                {/* Filters & Search */}
                <div className="flex flex-col md:flex-row justify-between gap-6 mb-8 items-center bg-card/50 p-4 rounded-[28px] border border-border/50 backdrop-blur-xl">
                    <div className="flex bg-foreground/[0.03] p-1.5 rounded-2xl gap-1">
                        {(['all', 'groups', 'channels', 'members'] as const).map((t) => (
                            <button
                                key={t}
                                onClick={() => { setActiveTab(t); setSelectedIds(new Set()); }}
                                className={`px-5 py-2 rounded-xl text-[11px] font-bold uppercase tracking-tighter transition-all ${activeTab === t ? 'bg-indigo-600 text-white shadow-xl shadow-indigo-500/40' : 'text-foreground/40 hover:text-foreground hover:bg-foreground/5'}`}
                            >
                                {t}
                            </button>
                        ))}
                    </div>

                    <div className="relative w-full md:w-80 group">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-foreground/20 group-focus-within:text-indigo-500 transition-colors" size={18} />
                        <input
                            type="text"
                            placeholder="Search leads, usernames..."
                            className="w-full bg-foreground/[0.03] border border-border rounded-2xl py-3 pl-12 pr-4 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all placeholder:text-foreground/20"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                </div>

                {loading ? (
                    <Preloader message="Synchronizing Lead Intelligence..." />
                ) : visibleLeads.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center bg-card/30 rounded-[32px] border border-border border-dashed py-20">
                        <div className="w-20 h-20 bg-foreground/[0.03] rounded-full flex items-center justify-center mb-6">
                            <Users className="text-foreground/10" size={40} />
                        </div>
                        <p className="text-foreground/40 font-bold mb-2 uppercase tracking-widest text-sm">No leads found</p>
                        <p className="text-foreground/20 text-xs">Try adjusting your filters or search query.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4 animate-in fade-in slide-in-from-bottom-8 duration-700">
                        {visibleLeads.map((l) => (
                            <div
                                key={l.id}
                                onClick={() => toggleSelection(l.id)}
                                className={`group bg-card/60 border border-border/50 rounded-3xl p-5 hover:border-indigo-500/30 transition-all cursor-pointer relative overflow-hidden flex flex-col ${selectedIds.has(l.id) ? 'ring-2 ring-indigo-500 bg-indigo-500/5 border-indigo-500/20' : ''}`}
                            >
                                <div className="flex justify-between items-start mb-4">
                                    <div className={`w-10 h-10 rounded-2xl flex items-center justify-center border ${l.itemType === 'member' ? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-500' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500'}`}>
                                        {l.itemType === 'member' ? <UsersRound size={18} /> : (l.type === 'channel' ? <Megaphone size={18} /> : <Users size={18} />)}
                                    </div>
                                    <div className="flex gap-2">
                                        <div className="flex items-center gap-1.5 transition-all">
                                            {copyStatus[l.id] && (
                                                <span className="text-[10px] font-bold text-emerald-500 animate-in fade-in slide-in-from-right-2">Copied!</span>
                                            )}
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    const text = l.username ? `@${l.username}` : String(l.id);
                                                    handleCopy(l.id, text);
                                                }}
                                                className={`p-1.5 rounded-lg transition-all ${copyStatus[l.id] ? 'bg-emerald-500/10 text-emerald-500' : 'bg-foreground/5 hover:bg-indigo-500/10 hover:text-indigo-500 text-foreground/30'}`}
                                                title="Copy Username/ID"
                                            >
                                                {copyStatus[l.id] ? <Check size={14} /> : <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></svg>}
                                            </button>
                                        </div>

                                        {l.itemType === 'community' && (
                                            <>
                                                {joinedIds.has(l.id) || (l.username && joinedIds.has(l.username)) ? (
                                                    <div
                                                        className="px-2 py-1 h-7 bg-emerald-500/10 text-emerald-500 rounded-lg text-[10px] font-bold tracking-wider uppercase flex items-center justify-center border border-emerald-500/20 shadow-sm"
                                                        title="Joined"
                                                    >
                                                        Joined
                                                    </div>
                                                ) : (
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); handleSingleJoin(l.id, l.username); }}
                                                        className="p-1.5 bg-foreground/5 hover:bg-emerald-500/10 hover:text-emerald-500 rounded-lg text-foreground/30 transition-all"
                                                        title="Join"
                                                    >
                                                        <UserPlus size={14} />
                                                    </button>
                                                )}
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); setExtractingGroup(l.username || l.id); }}
                                                    className="p-1.5 bg-foreground/5 hover:bg-indigo-500/10 hover:text-indigo-500 rounded-lg text-foreground/30 transition-all"
                                                    title="Extract"
                                                >
                                                    <Shield size={14} />
                                                </button>
                                            </>
                                        )}
                                        <button
                                            onClick={(e) => { e.stopPropagation(); handleDeleteSingle(l.id, l.itemType === 'member' ? 'member' : 'group'); }}
                                            className="p-1.5 bg-foreground/5 hover:bg-red-500/10 hover:text-red-500 rounded-lg text-foreground/30 transition-all"
                                            title="Delete"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                </div>

                                <div className="flex-1 min-w-0 mb-4">
                                    <h4 className="font-bold text-sm text-foreground truncate mb-1">{l.title}</h4>
                                    <div className="flex items-center gap-2">
                                        <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-md tracking-tighter ${l.type === 'channel' ? 'bg-blue-500/10 text-blue-500' : (l.type === 'group' ? 'bg-indigo-500/10 text-indigo-500' : 'bg-slate-500/10 text-slate-500')}`}>
                                            {l.type}
                                        </span>
                                        {l.username && <span className="text-[10px] text-indigo-500/70 font-bold truncate">@{l.username}</span>}
                                    </div>
                                </div>

                                <div className="flex items-center justify-between pt-4 border-t border-border/30">
                                    <div className="text-[10px] font-bold text-foreground/30 uppercase tracking-widest">
                                        {l.itemType === 'community' ? (l.participants_count || 0).toLocaleString() + ' Members' : 'Direct Target'}
                                    </div>
                                    <div className="text-[10px] font-bold text-foreground/20 uppercase">
                                        {l.country || "Global"}
                                    </div>
                                </div>

                                {/* Selection Checkmark */}
                                {selectedIds.has(l.id) && (
                                    <div className="absolute top-2 right-2 p-1 bg-indigo-500 rounded-full text-white">
                                        <Check size={10} />
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                {/* Member Extraction Modal */}
                {extractingGroup && (
                    <div className="fixed inset-0 bg-background/80 backdrop-blur-3xl z-[200] flex items-center justify-center p-6 animate-in fade-in duration-300">
                        <div className="bg-card border border-border rounded-[32px] w-full max-w-md shadow-2xl animate-in zoom-in-95 duration-500 max-h-[90vh] flex flex-col overflow-hidden">
                            <div className="p-8 border-b border-border flex justify-between items-center shrink-0">
                                <h3 className="font-bold text-2xl text-foreground tracking-tighter">Extracting Targets</h3>
                                <button onClick={() => setExtractingGroup(null)} className="p-2 bg-foreground/5 rounded-full text-foreground/20 hover:text-foreground transition-all focus:rotate-90"><X size={20} /></button>
                            </div>
                            <div className="p-8 space-y-6 overflow-y-auto custom-scrollbar flex-1">
                                <div className="space-y-3">
                                    <label className="text-[10px] font-bold text-foreground/30 uppercase tracking-[0.2em] ml-1">Select Account Proxy</label>
                                    <select
                                        className="w-full bg-foreground/[0.03] border border-border rounded-2xl py-4 px-5 text-sm font-bold text-foreground focus:ring-2 focus:ring-indigo-500/20 transition-all appearance-none cursor-pointer"
                                        value={extractingPhone}
                                        onChange={(e) => setExtractingPhone(e.target.value)}
                                    >
                                        {accounts.map(acc => <option key={acc.phone_number} value={acc.phone_number} className="bg-card">{acc.phone_number}</option>)}
                                    </select>
                                    <p className="text-[10px] text-foreground/30 px-1 leading-relaxed italic">
                                        * Platforms use your account as a secure gateway to fetch members. This ensures higher data fidelity and lower ban risk.
                                    </p>
                                </div>
                                <div className="bg-indigo-500/5 p-5 rounded-2xl border border-indigo-500/10">
                                    <div className="flex items-center gap-2 mb-2">
                                        <Shield size={16} className="text-indigo-500" />
                                        <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider">Proxy Logic</span>
                                    </div>
                                    <p className="text-[11px] text-foreground/40 leading-relaxed font-medium">
                                        Account Proxying utilizes your existing Telegram sessions to tunnel requests. This bypasses common scraping blocks while maintaining account safety through intelligent request staggering.
                                    </p>
                                </div>
                                <div className="bg-amber-500/10 p-5 rounded-2xl border border-amber-500/20 relative overflow-hidden group">
                                    <div className="absolute top-0 right-0 p-2 opacity-10"><Shield size={40} className="text-amber-500" /></div>
                                    <p className="text-xs text-amber-500/80 leading-relaxed font-bold">
                                        Member extraction uses your account for scanning. High-speed protocol active (limit: 1000 targets).
                                    </p>
                                </div>
                                <button
                                    onClick={handleExtract}
                                    disabled={isExtracting}
                                    className="w-full bg-indigo-500 hover:bg-indigo-600 text-white h-16 rounded-[20px] text-sm font-bold shadow-xl shadow-indigo-500/20 disabled:opacity-50 flex items-center justify-center gap-3 transition-all active:scale-[0.98]"
                                >
                                    {isExtracting ? <Loader2 size={18} className="animate-spin" /> : <ChevronRight size={18} />}
                                    {isExtracting ? 'Extracting...' : 'Start Extraction'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </MonetizationOverlay>
    );
}

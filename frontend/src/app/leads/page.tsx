"use client";

import React, { useState, useEffect } from 'react';
import { Bookmark, Loader2, UsersRound, Megaphone, CheckCircle2, X, ExternalLink, Plus, Trash2, Search, Filter, Shield, UserPlus, Users, MessageCircle, ChevronRight, Check } from 'lucide-react';
import { apiFetch } from '@/lib/auth';
import { useRouter } from 'next/navigation';

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
    const [isDeleting, setIsDeleting] = useState(false);
    const [isExtracting, setIsExtracting] = useState(false);
    const [extractingGroup, setExtractingGroup] = useState<string | null>(null);
    const [extractingPhone, setExtractingPhone] = useState('');
    const [accounts, setAccounts] = useState<any[]>([]);

    useEffect(() => {
        fetchAllLeads();
        fetchAccounts();
    }, []);

    const fetchAllLeads = async () => {
        setLoading(true);
        try {
            const [groupsRes, membersRes] = await Promise.all([
                apiFetch('/api/telegram/leads/groups'),
                apiFetch('/api/telegram/leads/members')
            ]);
            
            const groupsData = await groupsRes.json();
            const membersData = await membersRes.json();
            
            if (groupsRes.ok) setGroups(groupsData.groups || []);
            if (membersRes.ok) setMembers(membersData.members || []);
            
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
        } catch (e) {}
    };

    const handleBulkJoin = async () => {
        const groupIds = Array.from(selectedIds).filter(id => typeof id === 'string');
        if (groupIds.length === 0) return;
        
        setJoining(true);
        setError('');
        try {
            const phoneNumber = accounts[0]?.phone_number;
            if (!phoneNumber) throw new Error("No connected account found.");

            const res = await apiFetch('/api/telegram/bulk-join', {
                method: 'POST',
                body: JSON.stringify({ group_ids: groupIds, phone_number: phoneNumber })
            });
            const data = await res.json();
            if (res.ok) {
                alert(`Bulk Join started! Joined: ${data.joined}, Failed: ${data.failed}. Check your Telegram account.`);
                setSelectedIds(new Set());
            } else {
                setError(data.detail || 'Bulk join failed');
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setJoining(false);
        }
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
                alert(`Successfully joined!`);
            } else {
                const d = await res.json();
                alert(d.detail || 'Join failed');
            }
        } catch (e: any) {
            alert(e.message);
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
        } catch (e) {}
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
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 min-h-[calc(100vh-100px)] flex flex-col pt-2">
            <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-10">
                <div>
                    <h2 className="text-3xl font-black mb-2 tracking-tight text-foreground flex items-center gap-3">
                        <Bookmark className="text-indigo-500 w-8 h-8" /> Target Leads
                    </h2>
                    <p className="text-sm text-foreground/50 font-medium">Manage discovered communities and extracted target members.</p>
                </div>

                <div className="flex flex-wrap gap-3">
                    {selectedIds.size > 0 && (
                        <>
                            <button 
                                onClick={handleBulkDelete}
                                disabled={isDeleting}
                                className="bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20 px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2"
                            >
                                <Trash2 size={16} /> Delete Selected ({selectedIds.size})
                            </button>
                            <button 
                                onClick={handleAddToCampaign}
                                className="bg-indigo-500 hover:bg-indigo-600 text-white px-5 py-2.5 rounded-xl text-xs font-bold shadow-lg shadow-indigo-500/20 transition-all flex items-center gap-2"
                            >
                                <Megaphone size={16} /> Add to Campaign
                            </button>
                            <button 
                                onClick={handleBulkJoin}
                                disabled={joining}
                                className="bg-foreground text-background px-5 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2"
                            >
                                {joining ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />} 
                                Bulk Join
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
                            className={`px-5 py-2 rounded-xl text-[11px] font-black uppercase tracking-tighter transition-all ${activeTab === t ? 'bg-indigo-600 text-white shadow-xl shadow-indigo-500/40' : 'text-foreground/40 hover:text-foreground hover:bg-foreground/5'}`}
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
                <div className="flex-1 flex flex-col items-center justify-center bg-card/30 rounded-[32px] border border-border border-dashed py-20 grayscale opacity-50">
                    <Loader2 className="w-12 h-12 text-indigo-500 animate-spin mb-4" />
                    <p className="text-sm font-bold text-foreground/40 animate-pulse uppercase tracking-[0.2em]">Synchronizing database...</p>
                </div>
            ) : visibleLeads.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center bg-card/30 rounded-[32px] border border-border border-dashed py-20">
                    <div className="w-20 h-20 bg-foreground/[0.03] rounded-full flex items-center justify-center mb-6">
                        <Users className="text-foreground/10" size={40} />
                    </div>
                    <p className="text-foreground/40 font-bold mb-2 uppercase tracking-widest text-sm">No leads found</p>
                    <p className="text-foreground/20 text-xs">Try adjusting your filters or search query.</p>
                </div>
            ) : (
                <div className="bg-card border border-border rounded-[32px] overflow-hidden shadow-2xl overflow-x-auto">
                    <table className="w-full text-left border-collapse min-w-[800px]">
                        <thead>
                            <tr className="border-b border-border text-[10px] font-black uppercase tracking-[0.2em] text-foreground/30 bg-foreground/[0.01]">
                                <th className="p-6 w-12 text-center">
                                    <button 
                                        onClick={() => toggleSelectAll(isAllVisibleSelected)}
                                        className={`w-5 h-5 rounded-md border flex items-center justify-center transition-all ${isAllVisibleSelected ? 'bg-indigo-500 border-indigo-500 text-white' : 'border-border bg-foreground/5 hover:border-foreground/30'}`}
                                    >
                                        {isAllVisibleSelected && <Check size={12} />}
                                    </button>
                                </th>
                                <th className="p-6">Lead / Entity</th>
                                <th className="p-6">Identifiers</th>
                                <th className="p-6 text-center">Type</th>
                                <th className="p-6 text-right">Metrics / Info</th>
                                <th className="p-6 text-right pr-10">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {visibleLeads.map((l) => {
                                const isSelected = selectedIds.has(l.id);
                                return (
                                    <tr 
                                        key={l.id} 
                                        className={`group hover:bg-foreground/[0.01] transition-all cursor-pointer ${isSelected ? 'bg-indigo-500/[0.03]' : ''}`}
                                        onClick={() => toggleSelection(l.id)}
                                    >
                                        <td className="p-6 text-center" onClick={(e) => e.stopPropagation()}>
                                            <button 
                                                onClick={() => toggleSelection(l.id)}
                                                className={`w-5 h-5 rounded-md border flex items-center justify-center transition-all ${isSelected ? 'bg-indigo-500 border-indigo-500 text-white shadow-lg shadow-indigo-500/20' : 'border-border bg-foreground/[0.02] hover:border-foreground/20'}`}
                                            >
                                                {isSelected && <Check size={12} />}
                                            </button>
                                        </td>
                                        <td className="p-6">
                                            <div className="flex items-center gap-4">
                                                <div className={`w-10 h-10 rounded-2xl flex items-center justify-center border shadow-sm ${l.itemType === 'member' ? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-500' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500'}`}>
                                                    {l.itemType === 'member' ? <UsersRound size={18} /> : (l.type === 'channel' ? <Megaphone size={18} /> : <Users size={18} />)}
                                                </div>
                                                <div className="max-w-[200px]">
                                                    <div className="font-bold text-sm text-foreground truncate">{l.title}</div>
                                                    <div className="text-[10px] text-foreground/30 font-black uppercase tracking-widest">{l.itemType}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="p-6">
                                            {l.username ? (
                                                <div className="flex items-center gap-1.5 text-indigo-500 font-bold text-xs bg-indigo-500/5 px-2.5 py-1 rounded-full w-fit">
                                                    @{l.username}
                                                </div>
                                            ) : (
                                                <div className="text-[10px] text-foreground/20 font-medium">ID: {l.id}</div>
                                            )}
                                        </td>
                                        <td className="p-6 text-center">
                                            <span className={`text-[10px] font-black uppercase px-2.5 py-1 rounded-md tracking-tighter ${l.type === 'channel' ? 'bg-blue-500/10 text-blue-500' : (l.type === 'group' ? 'bg-indigo-500/10 text-indigo-500' : 'bg-slate-500/10 text-slate-500')}`}>
                                                {l.type}
                                            </span>
                                        </td>
                                        <td className="p-6 text-right">
                                            {l.itemType === 'community' ? (
                                                <>
                                                    <div className="font-bold text-sm text-foreground">{(l.participants_count || 0).toLocaleString()}</div>
                                                    <div className="text-[10px] text-foreground/20 font-black uppercase">{l.country || "Global"}</div>
                                                </>
                                            ) : (
                                                <div className="text-[10px] text-foreground/20 font-black uppercase italic">Direct Target</div>
                                            )}
                                        </td>
                                        <td className="p-6 text-right pr-8" onClick={(e) => e.stopPropagation()}>
                                            <div className="flex items-center justify-end gap-1 font-bold">
                                                {l.itemType === 'community' && (
                                                    <>
                                                        <button 
                                                            onClick={() => handleSingleJoin(l.id, l.username)}
                                                            className="p-2 text-foreground/30 hover:text-emerald-500 hover:bg-emerald-500/10 rounded-xl transition-all"
                                                            title="Join Community"
                                                        >
                                                            <UserPlus size={18} />
                                                        </button>
                                                        <button 
                                                            onClick={() => setExtractingGroup(l.username || l.id)}
                                                            className="p-2 text-foreground/30 hover:text-indigo-500 hover:bg-indigo-500/10 rounded-xl transition-all"
                                                            title="Extract Members"
                                                        >
                                                            <Shield size={18} />
                                                        </button>
                                                    </>
                                                )}
                                                <button 
                                                    onClick={() => handleDeleteSingle(l.id, l.itemType === 'member' ? 'member' : 'group')}
                                                    className="p-2 text-foreground/30 hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-all"
                                                    title="Remove Lead"
                                                >
                                                    <Trash2 size={18} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Member Extraction Modal */}
            {extractingGroup && (
                <div className="fixed inset-0 bg-background/80 backdrop-blur-3xl z-[200] flex items-center justify-center p-6 animate-in fade-in duration-300">
                    <div className="bg-card border border-border rounded-[32px] w-full max-w-md shadow-2xl animate-in zoom-in-95 duration-500">
                        <div className="p-8 border-b border-border flex justify-between items-center">
                            <h3 className="font-black text-2xl text-foreground tracking-tighter">Extracting Targets</h3>
                            <button onClick={() => setExtractingGroup(null)} className="p-2 bg-foreground/5 rounded-full text-foreground/20 hover:text-foreground transition-all focus:rotate-90"><X size={20} /></button>
                        </div>
                        <div className="p-8 space-y-6">
                            <div className="space-y-3">
                                <label className="text-[10px] font-black text-foreground/30 uppercase tracking-[0.2em] ml-1">Account Proxy</label>
                                <select 
                                    className="w-full bg-foreground/[0.03] border border-border rounded-2xl py-4 px-5 text-sm font-bold text-foreground focus:ring-2 focus:ring-indigo-500/20 transition-all appearance-none cursor-pointer"
                                    value={extractingPhone}
                                    onChange={(e) => setExtractingPhone(e.target.value)}
                                >
                                    {accounts.map(acc => <option key={acc.phone_number} value={acc.phone_number} className="bg-card">{acc.phone_number}</option>)}
                                </select>
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
                                className="w-full bg-indigo-500 hover:bg-indigo-600 text-white h-16 rounded-[20px] text-sm font-black shadow-xl shadow-indigo-500/20 disabled:opacity-50 flex items-center justify-center gap-3 transition-all active:scale-[0.98]"
                            >
                                {isExtracting ? <Loader2 size={18} className="animate-spin" /> : <ChevronRight size={18} />}
                                {isExtracting ? 'Extracting...' : 'Start Extraction'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

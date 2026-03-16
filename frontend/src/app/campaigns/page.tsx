"use client";

import React, { useState, useEffect } from 'react';
import { Megaphone, Plus, Clock, Users, X, Send, Calendar, CheckCircle2, Loader2, Search, Check, ChevronLeft, ChevronRight, Trash2, MessageCircle, AlertCircle, Pause, Play } from 'lucide-react';
import { apiFetch } from '@/lib/auth';
import { Preloader } from '@/components/Preloader';

export default function CampaignsPage() {
    const [isCreating, setIsCreating] = useState(false);
    const [campaigns, setCampaigns] = useState<any[]>([]);
    const [accounts, setAccounts] = useState<any[]>([]);
    const [dialogs, setDialogs] = useState<any[]>([]);
    const [searchTerm, setSearchTerm] = useState("");
    const [filterType, setFilterType] = useState<'all' | 'groups' | 'channels'>('all');
    const [fetchingDialogs, setFetchingDialogs] = useState(false);
    const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
    const [excludedGroups, setExcludedGroups] = useState<string[]>([]);
    const [selectionMode, setSelectionMode] = useState<'include' | 'exclude'>('include');

    const [campaignData, setCampaignData] = useState({
        name: '',
        phone_number: '',
        schedule_time: '',
        message: '',
        interval_hours: '0',
        interval_minutes: '0'
    });
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [creationError, setCreationError] = useState("");

    const [spintaxInput, setSpintaxInput] = useState("");
    const [isSpintaxOpen, setIsSpintaxOpen] = useState(false);

    const [loadingTasks, setLoadingTasks] = useState(true);
    const [currentPage, setCurrentPage] = useState(1);
    const pageSize = 15;

    const [userStatus, setUserStatus] = useState<any>(null);

    const fetchStatus = async () => {
        try {
            const res = await apiFetch('/api/monetization/status');
            if (res.ok) {
                const data = await res.json();
                setUserStatus(data);
            }
        } catch (e) { }
    };

    useEffect(() => {
        fetchStatus();
    }, []);

    useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('preselect') === 'true') {
            const preselected = sessionStorage.getItem('selected_lead_groups');
            if (preselected) {
                try {
                    setSelectedGroups(JSON.parse(preselected));
                    sessionStorage.removeItem('selected_lead_groups');
                    setIsCreating(true);
                } catch (e) { }
            }
        }
    }, []);

    const fetchCampaigns = async () => {
        try {
            const res = await apiFetch('/api/telegram/campaigns');
            const text = await res.text();
            if (res.ok) {
                const data = JSON.parse(text);
                setCampaigns(data.campaigns || []);
            }
        } catch (err) {
            console.error("Failed to fetch campaigns", err);
        } finally {
            setLoadingTasks(false);
        }
    };

    const fetchDialogs = async (phone: string) => {
        if (!phone) return;
        setFetchingDialogs(true);
        setDialogs([]);
        setCurrentPage(1); // Reset to first page
        try {
            const res = await apiFetch('/api/telegram/dialogs', {
                method: 'POST',
                body: JSON.stringify({ phone_number: phone })
            });
            const text = await res.text();
            if (res.ok) {
                const data = JSON.parse(text);
                setDialogs(data.dialogs || []);
            }
        } catch (err) {
            console.error("Failed to fetch dialogs", err);
        } finally {
            setFetchingDialogs(false);
        }
    };

    const fetchAccounts = async () => {
        try {
            const res = await apiFetch('/api/telegram/accounts');
            if (res.ok) {
                const data = await res.json();
                const accs = data.accounts || [];
                setAccounts(accs);

                // If there's an active/primary account, pre-select it for the user
                const active = accs.find((a: any) => a.is_active) || accs.find((a: any) => a.status === 'active');
                if (active && !editingId) {
                    setCampaignData(prev => ({ ...prev, phone_number: active.phone_number }));
                    if (!dialogs.length) fetchDialogs(active.phone_number);
                }
            }
        } catch (err) {
            console.error("Failed to fetch accounts", err);
        }
    };

    useEffect(() => {
        let isMounted = true;
        let isPolling = false;

        const loadInitial = async () => {
            await Promise.all([fetchAccounts(), fetchCampaigns()]);
            isPolling = true;
        };
        loadInitial();

        const interval = setInterval(() => {
            if (isPolling && isMounted) {
                // Background poll without resetting loading state
                apiFetch('/api/telegram/campaigns')
                    .then(res => res.json())
                    .then(data => {
                        if (isMounted) setCampaigns(data.campaigns || []);
                    })
                    .catch(() => { });
            }
        }, 15000);

        return () => {
            isMounted = false;
            clearInterval(interval);
        };
    }, []);

    const toggleGroup = (id: string) => {
        setSelectedGroups(prev => {
            if (prev.includes(id)) {
                return prev.filter(g => g !== id);
            } else {
                return [...prev, id];
            }
        });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (selectedGroups.length === 0) {
            alert("Please select at least one group/channel.");
            return;
        }

        const localDate = new Date(campaignData.schedule_time);
        const utcScheduleTime = localDate.toISOString().slice(0, 16);

        setLoading(true);
        setCreationError("");
        try {
            const url = editingId ? `/api/telegram/campaigns/${editingId}` : '/api/telegram/campaigns';
            const method = editingId ? 'PUT' : 'POST';
            const res = await apiFetch(url, {
                method,
                body: JSON.stringify({
                    name: campaignData.name,
                    phone_number: campaignData.phone_number,
                    schedule_time: utcScheduleTime,
                    message: campaignData.message,
                    message_text: campaignData.message, // Ensure both are sent for compatibility
                    interval_hours: parseInt(campaignData.interval_hours),
                    interval_minutes: parseInt(campaignData.interval_minutes),
                    groups: selectedGroups,
                    target_groups: selectedGroups, // For PUT edit
                    exclude_groups: excludedGroups
                })
            });
            if (res.ok) {
                setSuccess(true);
                fetchCampaigns();
                // Refresh sidebar usage counters
                window.dispatchEvent(new Event('update_status'));
                setTimeout(() => {
                    setSuccess(false);
                    setIsCreating(false);
                    setEditingId(null);
                    setCampaignData({ name: '', phone_number: '', schedule_time: '', message: '', interval_hours: '0', interval_minutes: '0' });
                    setSelectedGroups([]);
                    setExcludedGroups([]);
                }, 2000);
            } else {
                const errData = await res.json();
                setCreationError(errData.detail || "Failed to create campaign. Please try again.");
            }
        } catch (err: any) {
            console.error(err);
            setCreationError(err.message || "Network error. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    const handleEdit = (camp: any) => {
        setEditingId(camp.id);
        const utcDate = new Date(camp.scheduled_time + (camp.scheduled_time.includes('Z') ? '' : 'Z'));
        // Convert back to local for the datetime-local input
        const localISO = new Date(utcDate.getTime() - (utcDate.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
        setCampaignData({
            name: camp.name || '',
            phone_number: camp.phone_number,
            schedule_time: localISO,
            message: camp.message_text || camp.message || '',
            interval_hours: (camp.interval_hours || 0).toString(),
            interval_minutes: (camp.interval_minutes || 0).toString()
        });

        let groups: string[] = [];
        try {
            // target_groups might be stored as a raw python string like "['-100123']" instead of strict JSON '["-100123"]'.
            const sanitized = camp.target_groups.replace(/'/g, '"');
            groups = JSON.parse(sanitized);
            if (!Array.isArray(groups)) groups = [groups];
        } catch (e) {
            groups = [camp.target_groups].filter(Boolean);
        }
        setSelectedGroups(groups);

        let excluded: string[] = [];
        try {
            const sanitizedEx = (camp.exclude_groups || '[]').replace(/'/g, '"');
            excluded = JSON.parse(sanitizedEx);
            if (!Array.isArray(excluded)) excluded = [excluded];
        } catch (e) {
            excluded = [camp.exclude_groups].filter(Boolean);
        }
        setExcludedGroups(excluded);

        setIsCreating(true);
        fetchDialogs(camp.phone_number);
    };

    const isSpintaxValid = (text: string) => {
        if (!text) return true;
        return text.includes('{') && text.includes('}') && text.includes('|');
    };

    const handleTogglePause = async (id: number, currentStatus: string) => {
        const action = currentStatus === 'processing' ? 'Pause' : 'Resume';
        if (!confirm(`${action} this campaign?`)) return;
        try {
            const res = await apiFetch(`/api/telegram/campaigns/${id}/toggle-pause`, { method: 'POST' });
            if (res.ok) {
                fetchCampaigns();
            } else {
                alert(`Failed to ${action.toLowerCase()} campaign.`);
            }
        } catch (e: any) {
            alert(e.message);
        }
    };

    const handleDelete = async (id: number) => {
        if (!confirm("Are you sure you want to delete this campaign?")) return;
        try {
            const res = await apiFetch(`/api/telegram/campaigns/${id}`, { method: 'DELETE' });
            if (res.ok) {
                setCampaigns(prev => prev.filter(c => c.id !== id));
            } else {
                alert('Failed to delete campaign.');
            }
        } catch (e: any) {
            alert(e.message);
        }
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'completed': return 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20';
            case 'processing': return 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20 animate-pulse';
            case 'failed': return 'text-red-500 bg-red-500/10 border-red-500/20';
            case 'paused': return 'text-amber-500 bg-amber-500/10 border-amber-500/20';
            default: return 'text-foreground/50 bg-foreground/5 border-foreground/10';
        }
    };

    const filteredDialogs = dialogs.filter((d: any) => {
        const matchesSearch = d.title?.toLowerCase().includes(searchTerm.toLowerCase()) || d.id?.toString().includes(searchTerm);
        if (!matchesSearch) return false;
        if (filterType === 'groups') return d.is_group;
        if (filterType === 'channels') return d.is_channel && !d.is_group;
        return true;
    });

    return (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-700">
            <header className="flex justify-between items-center mb-10">
                <div>
                    <h2 className="text-2xl font-bold mb-1 tracking-tight text-foreground">Campaigns</h2>
                    <p className="text-sm text-foreground/40 font-medium">Underground scheduling for autonomous broadcasts.</p>
                </div>
                <button
                    onClick={() => setIsCreating(true)}
                    className="bg-indigo-500 hover:bg-indigo-600 transition-all text-white px-5 py-2.5 rounded-xl text-sm font-bold shadow-lg shadow-indigo-500/20 active:scale-95 flex items-center gap-2"
                >
                    <Plus size={16} /> New Campaign
                </button>
            </header>

            {loadingTasks ? (
                <Preloader message="Reading Distribution Archives..." />
            ) : campaigns.length === 0 ? (
                <div className="bg-card border border-border rounded-[24px] p-20 flex flex-col items-center justify-center text-center relative overflow-hidden">
                    <div className="w-20 h-20 rounded-2xl bg-foreground/[0.03] flex items-center justify-center text-indigo-500 mb-6 border border-border ring-8 ring-foreground/[0.01]">
                        <Megaphone className="w-10 h-10" />
                    </div>
                    <h3 className="text-2xl font-bold text-foreground mb-3">No active campaigns</h3>
                    <p className="text-sm text-foreground/40 max-w-sm mb-10 leading-relaxed font-medium">Deploy your first broadcast campaign to start reaching groups autonomously.</p>
                    <button
                        onClick={() => setIsCreating(true)}
                        className="bg-card hover:bg-foreground/[0.05] transition-all text-foreground px-8 py-3.5 rounded-xl text-sm font-bold border border-border"
                    >
                        Create My First Campaign
                    </button>
                </div>
            ) : (
                <div className="space-y-3">
                    {campaigns.map((camp) => (
                        <div key={camp.id} className="bg-background border border-border rounded-2xl p-4 hover:border-indigo-500/40 transition-all flex items-center justify-between group/card">
                            <div className="flex items-center gap-4">
                                <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${camp.status === 'completed' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-indigo-500/10 text-indigo-500'}`}>
                                    <Megaphone size={22} />
                                </div>
                                <div className="space-y-0.5">
                                    <h4 className="font-bold text-foreground text-sm tracking-tight">{camp.phone_number}</h4>
                                    <div className="flex items-center gap-3">
                                        <div className="flex items-center gap-1.5 text-[10px] text-foreground/40 font-bold uppercase tracking-wider">
                                            <Calendar size={12} className="text-indigo-500/50" />
                                            {(() => {
                                                try {
                                                    const dateStr = camp.scheduled_time;
                                                    if (!dateStr) return 'No Date';
                                                    // Handle various ISO formats including those with offsets
                                                    const cleanDate = dateStr.includes('Z') || dateStr.includes('+') ? dateStr : dateStr + 'Z';
                                                    return new Date(cleanDate).toLocaleString();
                                                } catch (e) {
                                                    return 'Invalid Date';
                                                }
                                            })()}
                                        </div>
                                        {(camp.interval_hours > 0 || camp.interval_minutes > 0) && (
                                            <div className="flex items-center gap-1 text-[10px] text-amber-500/50 font-bold uppercase tracking-wider">
                                                <Clock size={12} /> {camp.interval_hours > 0 ? `${camp.interval_hours}h ` : ''}{camp.interval_minutes > 0 ? `${camp.interval_minutes}m ` : ''}Repeat • Batch {camp.batch_number || 1}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="flex flex-col md:flex-row md:items-center gap-4 md:gap-8 mt-4 md:mt-0">
                                <div className="flex-1 w-full md:w-48">
                                    <div className="flex justify-between items-center mb-1.5">
                                        <div className="flex items-center gap-2">
                                            <p className="text-[9px] uppercase tracking-widest text-foreground/40 font-bold">Delivery Progress</p>
                                            {(() => {
                                                try {
                                                    const failed = JSON.parse(camp.failed_groups || '[]');
                                                    if (failed.length > 0) {
                                                        return <span className="text-[9px] font-bold text-red-400 uppercase tracking-widest bg-red-400/10 px-1.5 py-0.5 rounded-md">{failed.length} Failed</span>
                                                    }
                                                } catch (e) { }
                                                return null;
                                            })()}
                                        </div>
                                        <p className="text-[10px] font-bold text-indigo-400">{camp.sent_count || 0} / {camp.total_targets || 0}</p>
                                    </div>
                                    <div className="w-full h-1.5 bg-foreground/5 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-indigo-500 rounded-full transition-all duration-1000 ease-out"
                                            style={{ width: `${Math.min(100, ((camp.sent_count || 0) / Math.max(1, camp.total_targets || 1)) * 100)}%` }}
                                        />
                                    </div>
                                </div>

                                <div className="hidden lg:block w-32 shrink-0">
                                    <p className="text-[9px] uppercase tracking-widest text-foreground/20 font-bold mb-1">Preview</p>
                                    <p className="text-[11px] text-foreground/40 truncate font-medium">"{camp.message_text || camp.message || '...'}"</p>
                                </div>

                                <div className="flex items-center justify-between md:justify-end gap-4 w-full md:w-auto">
                                    <div className={`px-3 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-widest border ${getStatusColor(camp.status)}`}>
                                        {camp.status}
                                    </div>

                                    <div className="flex items-center gap-1 opacity-100 md:opacity-0 group-hover/card:opacity-100 transition-opacity">
                                        {(() => {
                                            try {
                                                const failed = JSON.parse(camp.failed_groups || '[]');
                                                if (failed.length > 0) {
                                                    return (
                                                        <button
                                                            onClick={() => alert(`Failures:\n\n${failed.map((f: any) => `${f.name}: ${f.reason}`).join('\n')}`)}
                                                            className="p-2 text-red-400 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all"
                                                            title="View Failures"
                                                        >
                                                            <AlertCircle size={16} />
                                                        </button>
                                                    )
                                                }
                                            } catch (e) { }
                                            return null;
                                        })()}
                                        {(camp.status === 'processing' || camp.status === 'paused') && (
                                            <button
                                                onClick={() => handleTogglePause(camp.id, camp.status)}
                                                className={`p-2 rounded-lg transition-all ${camp.status === 'processing' ? 'text-amber-500 hover:text-amber-600 hover:bg-amber-500/10' : 'text-emerald-500 hover:text-emerald-600 hover:bg-emerald-500/10'}`}
                                                title={camp.status === 'processing' ? "Pause Campaign" : "Resume Campaign"}
                                            >
                                                {camp.status === 'processing' ? <Pause size={16} /> : <Play size={16} />}
                                            </button>
                                        )}
                                        <button
                                            onClick={() => handleEdit(camp)}
                                            className="p-2 text-foreground/40 hover:text-indigo-400 hover:bg-indigo-400/10 rounded-lg transition-all"
                                            title="Edit Campaign"
                                        >
                                            <Search size={16} />
                                        </button>
                                        <button
                                            onClick={() => handleDelete(camp.id)}
                                            className="p-2 text-foreground/40 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all"
                                            title="Delete Campaign"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Campaign Modal Overlay */}
            {isCreating && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100] flex items-center justify-center p-6">
                    <div className="bg-card border border-border rounded-[32px] w-full max-w-4xl shadow-2xl relative animate-in zoom-in-95 duration-300 max-h-[90vh] flex flex-col overflow-hidden">
                        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1/2 h-[2px] bg-gradient-to-r from-transparent via-indigo-500 to-transparent"></div>

                        <div className="flex justify-between items-center p-8 border-b border-border shrink-0">
                            <div className="flex items-center gap-4">
                                <div className="p-3 bg-indigo-500/10 rounded-2xl text-indigo-500">
                                    <Megaphone size={24} />
                                </div>
                                <div>
                                    <h3 className="font-bold text-xl text-foreground tracking-tight">{editingId ? 'Modify Transmission' : 'Create Underground Campaign'}</h3>
                                    <p className="text-xs text-foreground/30 font-medium">Configure autonomous broadcasting parameters.</p>
                                </div>
                            </div>
                            <button onClick={() => { setIsCreating(false); setEditingId(null); }} className="text-foreground/20 hover:text-foreground p-2 hover:bg-foreground/5 rounded-full"><X size={24} /></button>
                        </div>

                        <div className="p-8 overflow-y-auto custom-scrollbar flex-1">
                            {success ? (
                                <div className="text-center py-20">
                                    <div className="w-20 h-20 bg-emerald-500/10 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-6"><CheckCircle2 size={40} /></div>
                                    <h4 className="text-2xl font-bold text-foreground mb-3">Transmission Scheduled</h4>
                                    <p className="text-sm text-foreground/40">Your campaign has been successfully queued.</p>
                                </div>
                            ) : (
                                <form onSubmit={handleSubmit} className="space-y-8">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                        <div className="space-y-6">
                                            <div className="space-y-2">
                                                <label className="text-xs font-bold text-foreground/30 uppercase tracking-widest">Sending Account</label>
                                                <select
                                                    required
                                                    value={campaignData.phone_number}
                                                    onChange={(e) => {
                                                        const val = e.target.value;
                                                        setCampaignData({ ...campaignData, phone_number: val });
                                                        fetchDialogs(val);
                                                    }}
                                                    className="w-full bg-input border border-border rounded-xl py-3.5 px-4 text-sm text-foreground focus:ring-2 focus:ring-indigo-500/50 outline-none"
                                                >
                                                    <option value="">Select an account...</option>
                                                    {accounts.map((acc, idx) => (<option key={idx} value={acc.phone_number}>{acc.phone_number}</option>))}
                                                </select>
                                            </div>

                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="space-y-2">
                                                    <label className="text-xs font-bold text-foreground/30 uppercase tracking-widest">First Run (Local)</label>
                                                    <input
                                                        type="datetime-local"
                                                        required
                                                        value={campaignData.schedule_time}
                                                        onChange={(e) => setCampaignData({ ...campaignData, schedule_time: e.target.value })}
                                                        className="w-full bg-input border border-border rounded-xl py-3 px-4 text-sm text-foreground"
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <label className="text-xs font-bold text-foreground/30 uppercase tracking-widest">Repeat (Hrs/Min)</label>
                                                    <div className="flex gap-2">
                                                        <select
                                                            value={campaignData.interval_hours}
                                                            onChange={(e) => setCampaignData({ ...campaignData, interval_hours: e.target.value })}
                                                            className="flex-1 bg-input border border-border rounded-xl py-3 px-4 text-sm text-foreground focus:ring-2 focus:ring-indigo-500/50 outline-none"
                                                        >
                                                            <option value="0">0h</option>
                                                            <option value="1">1h</option>
                                                            <option value="2">2h</option>
                                                            <option value="5">5h</option>
                                                            <option value="12">12h</option>
                                                            <option value="24">24h</option>
                                                        </select>
                                                        <select
                                                            value={campaignData.interval_minutes}
                                                            onChange={(e) => setCampaignData({ ...campaignData, interval_minutes: e.target.value })}
                                                            className="flex-1 bg-input border border-border rounded-xl py-3 px-4 text-sm text-foreground focus:ring-2 focus:ring-indigo-500/50 outline-none"
                                                        >
                                                            <option value="0">0m</option>
                                                            <option value="15">15m</option>
                                                            <option value="30">30m</option>
                                                            <option value="45">45m</option>
                                                        </select>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="space-y-4">
                                                <div className="bg-indigo-500/5 border border-indigo-500/10 rounded-2xl p-4">
                                                    <h4 className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                                                        <MessageCircle size={14} /> Optimization Guide (ChatGPT Prompt)
                                                    </h4>
                                                    <div className="text-[10px] text-foreground/50 leading-relaxed font-medium space-y-2">
                                                        <p>1. Copy your raw message content.</p>
                                                        <p>2. Paste this prompt into ChatGPT:</p>
                                                        <div className="bg-background/50 p-2 rounded-lg border border-border mt-2 font-mono text-[9px] relative group">
                                                            I need you to change the provided content below in to a SPINTAX format following the sample below <br />
                                                            ____ Sample _____ <br />
                                                            {'{Hello|Hi|Hey} {{First Name}}, ...'} <br />
                                                            Now here is my content to convert: {'{ PASTE YOUR CONTENT HERE }'}
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    navigator.clipboard.writeText("I need you to change the provided content below in to a SPINTAX format following the sample below \n____ Sample _____\n\n{Hello|Hi|Hey} {{First Name}},\n\n{I was checking out {{Company}} online and couldn’t find a website for your services|I looked for {{Company}} online but couldn’t spot a website for your services|I tried to find a website for {{Company}} but didn’t see one} {just wanted to make sure I wasn’t missing it—are you still active with clients?|wanted to confirm—are you still taking clients?|thought I’d check—are you still serving clients?}\n\nNow here is my content you have to convert to SPINTAX based on provided instructions { PASTE YOUR CONTENT HERE }");
                                                                    alert("Prompt copied to clipboard!");
                                                                }}
                                                                className="absolute top-2 right-2 p-1.5 bg-indigo-500 text-white rounded-md opacity-0 group-hover:opacity-100 transition-all shadow-lg"
                                                            >
                                                                <Check size={12} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="space-y-2">
                                                    <div className="flex justify-between items-center px-1">
                                                        <label className="text-xs font-bold text-foreground/30 uppercase tracking-widest">Message Payload</label>
                                                        {!isSpintaxValid(campaignData.message) && campaignData.message.length > 0 && (
                                                            <span className="text-[9px] font-bold text-amber-500 uppercase">Non-Spintax detected</span>
                                                        )}
                                                    </div>
                                                    <textarea
                                                        rows={5}
                                                        required
                                                        value={campaignData.message}
                                                        onChange={(e) => setCampaignData({ ...campaignData, message: e.target.value })}
                                                        placeholder="Paste your Spintax content here..."
                                                        className={`w-full bg-input border rounded-2xl p-5 text-sm text-foreground resize-none focus:ring-2 transition-all outline-none ${!isSpintaxValid(campaignData.message) && campaignData.message.length > 0 ? 'border-amber-500/50 focus:ring-amber-500/20' : 'border-border focus:ring-indigo-500/20'}`}
                                                    />
                                                </div>
                                            </div>
                                                                      <div className="space-y-3 flex flex-col h-full">
                                            <div className="flex justify-between items-end mt-4">
                                                <div className="flex items-center gap-4">
                                                    <label className="text-xs font-bold text-foreground/30 uppercase tracking-widest">Target Groups</label>
                                                    <div className="flex bg-foreground/5 p-1 rounded-lg">
                                                        <button 
                                                            type="button"
                                                            onClick={() => setSelectionMode('include')}
                                                            className={`px-2 py-1 rounded-md text-[9px] font-bold uppercase transition-all ${selectionMode === 'include' ? 'bg-indigo-500 text-white' : 'text-foreground/40'}`}
                                                        >
                                                            Include
                                                        </button>
                                                        <button 
                                                            type="button"
                                                            onClick={() => setSelectionMode('exclude')}
                                                            className={`px-2 py-1 rounded-md text-[9px] font-bold uppercase transition-all ${selectionMode === 'exclude' ? 'bg-red-500 text-white' : 'text-foreground/40'}`}
                                                        >
                                                            Exclude
                                                        </button>
                                                    </div>
                                                </div>
                                                <div className="flex gap-3">
                                                    <span className="text-[10px] font-bold text-indigo-500">{selectedGroups.length} Included</span>
                                                    <span className="text-[10px] font-bold text-red-500">{excludedGroups.length} Excluded</span>
                                                </div>
                                            </div>

                                            {/* Filters & Toggles */}
                                            <div className="flex items-center justify-between gap-4 mb-2">
                                                <div className="flex bg-foreground/5 p-1 rounded-xl w-fit">
                                                    {(['all', 'groups', 'channels'] as const).map(t => (
                                                        <button
                                                            key={t}
                                                            type="button"
                                                            onClick={() => { setFilterType(t); setCurrentPage(1); }}
                                                            className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all ${filterType === t ? 'bg-indigo-500 text-white shadow-md' : 'text-foreground/40 hover:text-foreground'}`}
                                                        >
                                                            {t}
                                                        </button>
                                                    ))}
                                                </div>

                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        const visibleIds = filteredDialogs.map((d: any) => d.id);
                                                        if (selectionMode === 'include') {
                                                            const allSelected = visibleIds.length > 0 && visibleIds.every((id: any) => selectedGroups.includes(id));
                                                            if (allSelected) {
                                                                setSelectedGroups(prev => prev.filter(id => !visibleIds.includes(id)));
                                                            } else {
                                                                setSelectedGroups(prev => Array.from(new Set([...prev, ...visibleIds])));
                                                                setExcludedGroups(prev => prev.filter(id => !visibleIds.includes(id)));
                                                            }
                                                        } else {
                                                            const allExcluded = visibleIds.length > 0 && visibleIds.every((id: any) => excludedGroups.includes(id));
                                                            if (allExcluded) {
                                                                setExcludedGroups(prev => prev.filter(id => !visibleIds.includes(id)));
                                                            } else {
                                                                setExcludedGroups(prev => Array.from(new Set([...prev, ...visibleIds])));
                                                                setSelectedGroups(prev => prev.filter(id => !visibleIds.includes(id)));
                                                            }
                                                        }
                                                    }}
                                                    className={`text-[10px] font-bold uppercase tracking-widest px-4 py-2 hover:bg-foreground/10 transition-all rounded-xl border flex items-center gap-2
                                                        ${(selectionMode === 'include' ? filteredDialogs.every((d: any) => selectedGroups.includes(d.id)) : filteredDialogs.every((d: any) => excludedGroups.includes(d.id))) && filteredDialogs.length > 0
                                                            ? (selectionMode === 'include' ? 'bg-indigo-500/10 text-indigo-500 border-indigo-500/20' : 'bg-red-500/10 text-red-500 border-red-500/20')
                                                            : 'bg-foreground/5 text-foreground border-transparent'
                                                        }`}
                                                >
                                                    {((selectionMode === 'include' ? filteredDialogs.every((d: any) => selectedGroups.includes(d.id)) : filteredDialogs.every((d: any) => excludedGroups.includes(d.id))) && filteredDialogs.length > 0)
                                                        ? <><Check size={12} strokeWidth={4} /> Deselect Visible</>
                                                        : 'Select All Visible'
                                                    }
                                                </button>
                                            </div>            </div>

                                            <div className="relative">
                                                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground/20"><Search size={14} /></div>
                                                <input
                                                    type="text"
                                                    placeholder="Search targets..."
                                                    className="w-full bg-input border border-border rounded-xl py-2 pl-9 pr-4 text-xs text-foreground"
                                                    value={searchTerm}
                                                    onChange={(e) => setSearchTerm(e.target.value)}
                                                />
                                            </div>

                                            <div className="flex flex-col flex-1 bg-input border border-border rounded-2xl overflow-hidden min-h-[400px]">
                                                <div className="p-3 border-b border-border bg-foreground/[0.02] flex justify-between items-center">
                                                    <div className="flex items-center gap-2">
                                                        <button type="button" disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} className="p-1 hover:bg-foreground/5 rounded-lg disabled:opacity-20"><ChevronLeft size={16} /></button>
                                                        <span className="text-[10px] font-bold text-foreground/40">Page {currentPage} / {Math.max(1, Math.ceil(filteredDialogs.length / pageSize))}</span>
                                                        <button type="button" disabled={currentPage * pageSize >= filteredDialogs.length} onClick={() => setCurrentPage(p => p + 1)} className="p-1 hover:bg-foreground/5 rounded-lg disabled:opacity-20"><ChevronRight size={16} /></button>
                                                    </div>
                                                </div>
                                                <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
                                                    {fetchingDialogs ? (
                                                        <div className="flex flex-col items-center justify-center h-full opacity-20"><Loader2 className="animate-spin" /></div>
                                                    ) : filteredDialogs.length === 0 ? (
                                                        <div className="text-center py-10 text-[10px] text-foreground/20 uppercase font-bold">No results</div>
                                                    ) : (
                                                        filteredDialogs.slice((currentPage - 1) * pageSize, currentPage * pageSize).map((d: any) => (
                                                            <div
                                                                key={d.id}
                                                                onClick={() => toggleGroup(d.id)}
                                                                className={`p-3 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${selectedGroups.includes(d.id) ? 'bg-indigo-500/10 border-indigo-500/30' : excludedGroups.includes(d.id) ? 'bg-red-500/10 border-red-500/30' : 'bg-background border-border hover:bg-foreground/[0.02]'}`}
                                                            >
                                                                <div className="flex items-center gap-3 min-w-0">
                                                                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${selectedGroups.includes(d.id) ? 'bg-indigo-500 text-white' : excludedGroups.includes(d.id) ? 'bg-red-500 text-white' : 'bg-foreground/5 text-foreground/40'}`}>
                                                                        {d.title?.charAt(0) || '?'}
                                                                    </div>
                                                                    <div className="min-w-0">
                                                                        <p className="text-xs font-bold text-foreground truncate">{d.title}</p>
                                                                        <p className="text-[10px] text-foreground/30">ID: {d.id}</p>
                                                                    </div>
                                                                </div>
                                                                <div className={`w-4 h-4 rounded-full border-2 shrink-0 ${selectedGroups.includes(d.id) ? 'bg-indigo-500 border-indigo-500' : excludedGroups.includes(d.id) ? 'bg-red-500 border-red-500' : 'border-border'}`}>
                                                                    {(selectedGroups.includes(d.id) || excludedGroups.includes(d.id)) && <Check size={10} className="text-white mx-auto mt-0.5" />}
                                                                </div>
                                                            </div>
                                                        ))
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {creationError && (
                                        <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-500 text-xs font-bold mb-4">
                                            <AlertCircle size={14} />
                                            {creationError}
                                        </div>
                                    )}
                                    <div className="flex justify-end gap-4 pt-4 border-t border-border">
                                        <button type="button" onClick={() => { setIsCreating(false); setEditingId(null); setCreationError(""); }} className="px-8 py-3.5 rounded-2xl text-sm font-bold text-foreground/40 hover:text-foreground">Abort</button>
                                        <button type="submit" disabled={loading || selectedGroups.length === 0} className="bg-indigo-500 hover:bg-indigo-600 text-white px-10 py-3.5 rounded-2xl text-sm font-bold shadow-xl shadow-indigo-500/20 disabled:opacity-30">
                                            {loading ? <Loader2 size={18} className="animate-spin" /> : (editingId ? 'Update & Deploy' : 'Launch Underground')}
                                        </button>
                                    </div>
                                </form>
                            )}
                        </div>
                    </div>
                </div>
            )}
       </div >
    );
}

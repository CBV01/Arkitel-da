"use client";

import React, { useState, useEffect } from 'react';
import { Megaphone, Plus, Clock, Users, X, Send, Calendar, CheckCircle2, Loader2, Search, Check, ChevronLeft, ChevronRight, Trash2, MessageCircle } from 'lucide-react';
import { apiFetch } from '@/lib/auth';

export default function CampaignsPage() {
    const [isCreating, setIsCreating] = useState(false);
    const [campaigns, setCampaigns] = useState<any[]>([]);
    const [accounts, setAccounts] = useState<any[]>([]);
    const [dialogs, setDialogs] = useState<any[]>([]);
    const [searchTerm, setSearchTerm] = useState("");
    const [fetchingDialogs, setFetchingDialogs] = useState(false);
    const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
    
    const [campaignData, setCampaignData] = useState({
        name: '',
        phone_number: '',
        schedule_time: '',
        message: '',
        interval_hours: '0' // 0 means no repeat
    });
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);
    const [editingId, setEditingId] = useState<number | null>(null);

    const [spintaxInput, setSpintaxInput] = useState("");
    const [isSpintaxOpen, setIsSpintaxOpen] = useState(false);

    const [loadingTasks, setLoadingTasks] = useState(true);
    const [currentPage, setCurrentPage] = useState(1);
    const pageSize = 15;

    useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('preselect') === 'true') {
            const preselected = sessionStorage.getItem('selected_lead_groups');
            if (preselected) {
                try {
                    setSelectedGroups(JSON.parse(preselected));
                    sessionStorage.removeItem('selected_lead_groups');
                    setIsCreating(true);
                } catch (e) {}
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

    useEffect(() => {
        const fetchAccounts = async () => {
            try {
                const res = await apiFetch('/api/telegram/accounts');
                const text = await res.text();
                if (res.ok) {
                    try {
                        const data = JSON.parse(text);
                        setAccounts(data.accounts || []);
                    } catch (e) {
                        console.error("Campaigns: Non-JSON response for accounts", text);
                    }
                }
            } catch (err) {
                console.error("Failed to fetch accounts", err);
            }
        };
        fetchAccounts();
        fetchCampaigns();
    }, []);

    const toggleGroup = (id: string) => {
        setSelectedGroups(prev => 
            prev.includes(id) ? prev.filter(g => g !== id) : [...prev, id]
        );
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (selectedGroups.length === 0) {
            alert("Please select at least one group/channel.");
            return;
        }

        const localDate = new Date(campaignData.schedule_time);
        const utcMs = localDate.getTime() + (localDate.getTimezoneOffset() * 60 * 1000);
        const utcDate = new Date(utcMs);
        const pad = (n: number) => String(n).padStart(2, '0');
        const utcScheduleTime = `${utcDate.getUTCFullYear()}-${pad(utcDate.getUTCMonth()+1)}-${pad(utcDate.getUTCDate())}T${pad(utcDate.getUTCHours())}:${pad(utcDate.getUTCMinutes())}`;

        setLoading(true);
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
                    groups: selectedGroups,
                    target_groups: selectedGroups // For PUT edit
                })
            });
            if (res.ok) {
                setSuccess(true);
                fetchCampaigns();
                setTimeout(() => {
                    setSuccess(false);
                    setIsCreating(false);
                    setEditingId(null);
                    setCampaignData({ name: '', phone_number: '', schedule_time: '', message: '', interval_hours: '0' });
                    setSelectedGroups([]);
                }, 2000);
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleEdit = (camp: any) => {
        setEditingId(camp.id);
        const schedStr = camp.scheduled_time.split('Z')[0].substring(0, 16);
        setCampaignData({
            name: camp.name || '',
            phone_number: camp.phone_number,
            schedule_time: schedStr,
            message: camp.message_text || camp.message || '',
            interval_hours: (camp.interval_hours || 0).toString()
        });
        
        let groups = [];
        try {
            groups = JSON.parse(camp.target_groups);
        } catch(e) {
            groups = [camp.target_groups].filter(Boolean);
        }
        setSelectedGroups(groups);
        setIsCreating(true);
        fetchDialogs(camp.phone_number);
    };

    const isSpintaxValid = (text: string) => {
        if (!text) return true;
        return text.includes('{') && text.includes('}') && text.includes('|');
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
            default: return 'text-amber-500 bg-amber-500/10 border-amber-500/20';
        }
    };

    const filteredDialogs = dialogs.filter(d => 
        d.title?.toLowerCase().includes(searchTerm.toLowerCase()) || 
        d.id?.toString().includes(searchTerm)
    );

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
                <div className="flex flex-col items-center justify-center py-24 gap-4">
                    <Loader2 className="animate-spin text-indigo-500" size={40} />
                    <p className="text-sm font-bold text-foreground/20 uppercase tracking-widest">Reading Archive...</p>
                </div>
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
                                            <Calendar size={12} className="text-indigo-500/50" /> {new Date(camp.scheduled_time + (camp.scheduled_time.includes('Z') ? '' : 'Z')).toLocaleString()}
                                        </div>
                                        {camp.interval_hours > 0 && (
                                            <div className="flex items-center gap-1 text-[10px] text-amber-500/50 font-bold uppercase tracking-wider">
                                                <Clock size={12} /> {camp.interval_hours}h Repeat
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                            
                            <div className="flex items-center gap-8">
                                <div className="hidden lg:block">
                                    <p className="text-[9px] uppercase tracking-widest text-foreground/20 font-black mb-1">Preview</p>
                                    <p className="text-[11px] text-foreground/40 max-w-[150px] truncate font-medium">"{camp.message_text || camp.message || '...'}"</p>
                                </div>
                                
                                <div className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest border ${getStatusColor(camp.status)}`}>
                                    {camp.status}
                                </div>

                                <div className="flex items-center gap-1 opacity-0 group-hover/card:opacity-100 transition-opacity">
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
                    ))}
                </div>
            )}

            {/* Campaign Modal Overlay */}
            {isCreating && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100] flex items-center justify-center p-6 overflow-y-auto">
                    <div className="bg-card border border-border rounded-[32px] w-full max-w-4xl shadow-2xl relative animate-in zoom-in-95 duration-300 my-auto">
                        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1/2 h-[2px] bg-gradient-to-r from-transparent via-indigo-500 to-transparent"></div>
                        
                        <div className="flex justify-between items-center p-8 border-b border-border">
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

                        <div className="p-8">
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
                                                    <label className="text-xs font-bold text-foreground/30 uppercase tracking-widest">Repeat (Hrs)</label>
                                                    <select
                                                        value={campaignData.interval_hours}
                                                        onChange={(e) => setCampaignData({ ...campaignData, interval_hours: e.target.value })}
                                                        className="w-full bg-input border border-border rounded-xl py-3 px-4 text-sm text-foreground"
                                                    >
                                                        <option value="0">No Repeat</option>
                                                        <option value="1">1 Hour</option>
                                                        <option value="5">5 Hours</option>
                                                        <option value="12">12 Hours</option>
                                                        <option value="24">24 Hours</option>
                                                    </select>
                                                </div>
                                            </div>

                                            <div className="space-y-4">
                                                <div className="bg-indigo-500/5 border border-indigo-500/10 rounded-2xl p-4">
                                                    <h4 className="text-[10px] font-black text-indigo-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                                                        <MessageCircle size={14} /> Optimization Guide (ChatGPT Prompt)
                                                    </h4>
                                                    <div className="text-[10px] text-foreground/50 leading-relaxed font-medium space-y-2">
                                                        <p>1. Copy your raw message content.</p>
                                                        <p>2. Paste this prompt into ChatGPT:</p>
                                                        <div className="bg-background/50 p-2 rounded-lg border border-border mt-2 font-mono text-[9px] relative group">
                                                            I need you to change the provided content below in to a SPINTAX format following the sample below <br/>
                                                            ____ Sample _____ <br/>
                                                            {'{Hello|Hi|Hey} {{First Name}}, ...'} <br/>
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
                                                            <span className="text-[9px] font-black text-amber-500 uppercase">Non-Spintax detected</span>
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
                                        </div>

                                        <div className="space-y-3 flex flex-col h-full">
                                            <div className="flex justify-between items-end">
                                                <label className="text-xs font-bold text-foreground/30 uppercase tracking-widest">Target Groups</label>
                                                <span className="text-[10px] font-bold text-indigo-500">{selectedGroups.length} Selected</span>
                                            </div>
                                            
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
                                                        <div className="text-center py-10 text-[10px] text-foreground/20 uppercase font-black">No results</div>
                                                    ) : (
                                                        filteredDialogs.slice((currentPage - 1) * pageSize, currentPage * pageSize).map((d: any) => (
                                                            <div 
                                                                key={d.id} 
                                                                onClick={() => toggleGroup(d.id)}
                                                                className={`p-3 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${selectedGroups.includes(d.id) ? 'bg-indigo-500/10 border-indigo-500/30' : 'bg-background border-border hover:bg-foreground/[0.02]'}`}
                                                            >
                                                                <div className="flex items-center gap-3 min-w-0">
                                                                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${selectedGroups.includes(d.id) ? 'bg-indigo-500 text-white' : 'bg-foreground/5 text-foreground/40'}`}>
                                                                        {d.title?.charAt(0) || '?'}
                                                                    </div>
                                                                    <div className="min-w-0">
                                                                        <p className="text-xs font-bold text-foreground truncate">{d.title}</p>
                                                                        <p className="text-[10px] text-foreground/30">ID: {d.id}</p>
                                                                    </div>
                                                                </div>
                                                                <div className={`w-4 h-4 rounded-full border-2 shrink-0 ${selectedGroups.includes(d.id) ? 'bg-indigo-500 border-indigo-500' : 'border-border'}`}>
                                                                    {selectedGroups.includes(d.id) && <Check size={10} className="text-white mx-auto mt-0.5" />}
                                                                </div>
                                                            </div>
                                                        ))
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex justify-end gap-4 pt-8 border-t border-border">
                                        <button type="button" onClick={() => { setIsCreating(false); setEditingId(null); }} className="px-8 py-3.5 rounded-2xl text-sm font-bold text-foreground/40 hover:text-foreground">Abort</button>
                                        <button type="submit" disabled={loading || selectedGroups.length === 0} className="bg-indigo-500 hover:bg-indigo-600 text-white px-10 py-3.5 rounded-2xl text-sm font-black shadow-xl shadow-indigo-500/20 disabled:opacity-30">
                                            {loading ? <Loader2 size={18} className="animate-spin" /> : (editingId ? 'Update & Deploy' : 'Launch Underground')}
                                        </button>
                                    </div>
                                </form>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

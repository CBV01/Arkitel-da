"use client";

import React, { useState } from 'react';
import { Megaphone, Plus, Clock, Users, X, Send, Calendar, CheckCircle2, Loader2, Search } from 'lucide-react';
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

    const [loadingTasks, setLoadingTasks] = useState(true);
    const [currentPage, setCurrentPage] = useState(1);
    const pageSize = 50;

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

    React.useEffect(() => {
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

        // SYNC TIME: Convert local time picking to UTC for the backend poller
        // Date.toISOString() gives YYYY-MM-DDTHH:mm:ss.sssZ (always in UTC)
        const utcScheduleTime = new Date(campaignData.schedule_time).toISOString().slice(0, 16);

        setLoading(true);
        try {
            const res = await apiFetch('/api/telegram/campaigns', {
                method: 'POST',
                body: JSON.stringify({
                    ...campaignData,
                    schedule_time: utcScheduleTime,
                    groups: selectedGroups
                })
            });
            if (res.ok) {
                setSuccess(true);
                fetchCampaigns();
                setTimeout(() => {
                    setSuccess(false);
                    setIsCreating(false);
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

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'completed': return 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20';
            case 'processing': return 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20 animate-pulse';
            case 'failed': return 'text-red-500 bg-red-500/10 border-red-500/20';
            default: return 'text-amber-500 bg-amber-500/10 border-amber-500/20';
        }
    };

    return (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-700">
            <header className="flex justify-between items-center mb-10">
                <div>
                    <h2 className="text-2xl font-bold mb-1 tracking-tight text-white">Campaigns</h2>
                    <p className="text-sm text-white/40 font-medium">Underground scheduling for autonomous broadcasts.</p>
                </div>
                <button
                    onClick={() => setIsCreating(true)}
                    className="bg-[#7c7fff] hover:bg-[#6c6fef] transition-all text-white px-5 py-2.5 rounded-xl text-sm font-bold shadow-lg shadow-[#7c7fff]/20 active:scale-95 flex items-center gap-2"
                >
                    <Plus size={16} /> New Campaign
                </button>
            </header>

            {loadingTasks ? (
                <div className="flex flex-col items-center justify-center py-24 gap-4">
                    <Loader2 className="animate-spin text-[#7c7fff]" size={40} />
                    <p className="text-sm font-bold text-white/20 uppercase tracking-widest">Reading Archive...</p>
                </div>
            ) : campaigns.length === 0 ? (
                <div className="bg-[#0b0c10] border border-white/[0.05] rounded-[24px] p-20 flex flex-col items-center justify-center text-center shadow-2xl relative overflow-hidden">
                    <div className="w-20 h-20 rounded-2xl bg-white/[0.03] flex items-center justify-center text-[#7c7fff] mb-6 border border-white/[0.05] ring-8 ring-white/[0.01]">
                        <Megaphone className="w-10 h-10" />
                    </div>
                    <h3 className="text-2xl font-bold text-white mb-3">No active campaigns</h3>
                    <p className="text-sm text-white/40 max-w-sm mb-10 leading-relaxed font-medium">Deploy your first broadcast campaign to start reaching groups autonomously.</p>
                    <button
                        onClick={() => setIsCreating(true)}
                        className="bg-white/5 hover:bg-white/10 transition-all text-white px-8 py-3.5 rounded-xl text-sm font-bold border border-white/[0.05]"
                    >
                        Create My First Campaign
                    </button>
                </div>
            ) : (
                <div className="grid grid-cols-1 gap-5">
                    {campaigns.map((camp) => (
                        <div key={camp.id} className="bg-[#0b0c10] border border-white/[0.05] rounded-[20px] p-7 flex items-center justify-between group hover:border-[#7c7fff]/30 transition-all shadow-xl">
                            <div className="flex items-center gap-6">
                                <div className="w-14 h-14 rounded-xl bg-[#7c7fff]/5 border border-[#7c7fff]/10 flex items-center justify-center text-[#7c7fff] group-hover:scale-105 transition-transform duration-500">
                                    <Megaphone size={28} />
                                </div>
                                <div className="space-y-1.5">
                                    <h4 className="font-bold text-white text-lg tracking-tight">{camp.phone_number}</h4>
                                    <div className="flex items-center gap-4">
                                        <p className="text-xs text-white/30 font-bold uppercase tracking-widest flex items-center gap-1.5">
                                            <Calendar size={13} className="text-[#7c7fff]" /> {new Date(camp.schedule_time).toLocaleDateString()}
                                        </p>
                                        <div className="h-1 w-1 rounded-full bg-white/10"></div>
                                        <p className="text-xs text-white/30 font-bold uppercase tracking-widest flex items-center gap-1.5">
                                            <Clock size={13} className="text-[#7c7fff]" /> {new Date(camp.schedule_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </p>
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center gap-12">
                                <div className="hidden lg:block text-right">
                                    <p className="text-[10px] uppercase tracking-[0.2em] text-white/20 font-black mb-1.5">Payload Preview</p>
                                    <p className="text-xs text-white/40 max-w-[220px] truncate italic font-medium">"{camp.message}"</p>
                                </div>
                                <div className={`px-4 py-2 rounded-lg text-[11px] font-black uppercase tracking-wider border shadow-sm ${getStatusColor(camp.status)}`}>
                                    {camp.status}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Campaign Modal Overlay */}
            {isCreating && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100] flex items-center justify-center p-6 overflow-y-auto">
                    <div className="bg-[#0b0c10] border border-white/[0.08] rounded-[32px] w-full max-w-4xl shadow-2xl relative animate-in zoom-in-95 duration-300 my-auto">
                        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1/2 h-[2px] bg-gradient-to-r from-transparent via-[#7c7fff] to-transparent"></div>
                        
                        {/* Modal Header */}
                        <div className="flex justify-between items-center p-8 border-b border-white/[0.05]">
                            <div className="flex items-center gap-4">
                                <div className="p-3 bg-[#7c7fff]/10 rounded-2xl text-[#7c7fff]">
                                    <Megaphone size={24} />
                                </div>
                                <div>
                                    <h3 className="font-bold text-xl text-white tracking-tight">Create Underground Campaign</h3>
                                    <p className="text-xs text-white/30 font-medium">Configure autonomous broadcasting parameters.</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setIsCreating(false)}
                                className="text-white/20 hover:text-white transition-colors p-2 hover:bg-white/5 rounded-full"
                            >
                                <X size={24} />
                            </button>
                        </div>

                        {/* Modal Body */}
                        <div className="p-8">
                            {success ? (
                                <div className="text-center py-20 animate-in zoom-in-95 duration-500">
                                    <div className="w-20 h-20 bg-emerald-500/10 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-6 ring-[12px] ring-emerald-500/5">
                                        <CheckCircle2 size={40} />
                                    </div>
                                    <h4 className="text-2xl font-bold text-white mb-3 tracking-tight">Transmission Scheduled</h4>
                                    <p className="text-sm text-white/40 font-medium">Your campaign has been successfully queued for the poller.</p>
                                </div>
                            ) : (
                                <form onSubmit={handleSubmit} className="space-y-8">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                        {/* Left Column: Account & Time */}
                                        <div className="space-y-6">
                                            <div className="space-y-2">
                                                <label className="text-xs font-bold text-white/30 uppercase tracking-[0.15em]">Sending Account</label>
                                                <select
                                                    required
                                                    value={campaignData.phone_number}
                                                    onChange={(e) => {
                                                        const val = e.target.value;
                                                        setCampaignData({ ...campaignData, phone_number: val });
                                                        fetchDialogs(val);
                                                    }}
                                                    className="w-full bg-[#1c2231] border border-white/[0.05] rounded-xl py-3.5 px-4 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#7c7fff]/50 appearance-none font-medium"
                                                >
                                                    <option value="">Select an account...</option>
                                                    {accounts.map((acc, idx) => (
                                                        <option key={idx} value={acc.phone_number}>{acc.phone_number}</option>
                                                    ))}
                                                </select>
                                            </div>

                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="space-y-2">
                                                    <label className="text-xs font-bold text-white/30 uppercase tracking-[0.15em]">First Run</label>
                                                    <input
                                                        type="datetime-local"
                                                        required
                                                        value={campaignData.schedule_time}
                                                        onChange={(e) => setCampaignData({ ...campaignData, schedule_time: e.target.value })}
                                                        className="w-full bg-[#1c2231] border border-white/[0.05] rounded-xl py-3 px-4 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#7c7fff]/50 appearance-none [color-scheme:dark] font-medium"
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <label className="text-xs font-bold text-white/30 uppercase tracking-[0.15em]">Repeat (Hrs)</label>
                                                    <select
                                                        value={campaignData.interval_hours}
                                                        onChange={(e) => setCampaignData({ ...campaignData, interval_hours: e.target.value })}
                                                        className="w-full bg-[#1c2231] border border-white/[0.05] rounded-xl py-3 px-4 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#7c7fff]/50 appearance-none font-medium text-center"
                                                    >
                                                        <option value="0">No Repeat</option>
                                                        <option value="1">1 Hour</option>
                                                        <option value="5">5 Hours</option>
                                                        <option value="12">12 Hours</option>
                                                        <option value="24">24 Hours</option>
                                                    </select>
                                                </div>
                                            </div>

                                            <div className="space-y-2">
                                                <label className="text-xs font-bold text-white/30 uppercase tracking-[0.15em]">Message Payload</label>
                                                <textarea
                                                    rows={6}
                                                    required
                                                    value={campaignData.message}
                                                    onChange={(e) => setCampaignData({ ...campaignData, message: e.target.value })}
                                                    placeholder="Enter broadcast message text..."
                                                    className="w-full bg-[#1c2231] border border-white/[0.05] rounded-2xl p-5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#7c7fff]/50 resize-none font-medium leading-relaxed"
                                                />
                                            </div>
                                        </div>

                                        {/* Right Column: Groups Selector */}
                                        <div className="space-y-3 flex flex-col h-full">
                                            <div className="flex justify-between items-end mb-1">
                                                <label className="text-xs font-bold text-white/30 uppercase tracking-[0.15em]">Target Audiences</label>
                                                <span className="text-[10px] font-bold text-[#7c7fff] uppercase tracking-wider">{selectedGroups.length} Selected targets</span>
                                            </div>
                                            
                                            <div className="relative mb-3">
                                                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-white/20">
                                                    <Search size={14} />
                                                </div>
                                                <input 
                                                    type="text"
                                                    placeholder="Search groups or channels..."
                                                    className="w-full bg-[#1c2231] border border-white/10 rounded-xl py-2 pl-9 pr-4 text-xs text-white focus:outline-none focus:border-[#7c7fff]/50 transition-all font-medium"
                                                    value={searchTerm}
                                                    onChange={(e) => setSearchTerm(e.target.value)}
                                                    suppressHydrationWarning={true}
                                                />
                                            </div>

                                            <div className="flex-1 bg-[#1c2231] border border-white/[0.05] rounded-2xl overflow-hidden flex flex-col min-h-[400px]">
                                                {fetchingDialogs ? (
                                                    <div className="flex-1 flex flex-col items-center justify-center gap-3">
                                                        <Loader2 className="animate-spin text-[#7c7fff]/40" size={24} />
                                                        <p className="text-[10px] font-bold text-white/20 uppercase tracking-widest">Fetching Groups...</p>
                                                    </div>
                                                ) : dialogs.length > 0 ? (
                                                    <>
                                                        <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
                                                            {dialogs
                                                                .filter(d => 
                                                                    d.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                                                                    (d.username && d.username.toLowerCase().includes(searchTerm.toLowerCase()))
                                                                )
                                                                .slice((currentPage - 1) * pageSize, currentPage * pageSize)
                                                                .map((d) => (
                                                                    <div 
                                                                        key={d.id}
                                                                        onClick={() => toggleGroup(d.id)}
                                                                        className={`p-3 rounded-xl border cursor-pointer transition-all flex items-center justify-between group/item ${selectedGroups.includes(d.id) ? 'bg-[#7c7fff]/10 border-[#7c7fff]/30' : 'bg-white/[0.02] border-white/[0.05] hover:bg-white/[0.04]'}`}
                                                                    >
                                                                    <div className="flex items-center gap-3 overflow-hidden">
                                                                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${d.is_channel ? 'bg-indigo-500/10 text-indigo-400' : 'bg-blue-500/10 text-blue-400'}`}>
                                                                            {d.is_channel ? <Send size={14} /> : <Users size={14} />}
                                                                        </div>
                                                                        <span className="text-xs font-bold text-white/80 truncate">{d.name}</span>
                                                                    </div>
                                                                    <div className={`w-4 h-4 rounded-full border-2 transition-all flex items-center justify-center ${selectedGroups.includes(d.id) ? 'bg-[#7c7fff] border-[#7c7fff]' : 'border-white/10'}`}>
                                                                        {selectedGroups.includes(d.id) && <CheckCircle2 size={10} className="text-white" />}
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                        {/* Pagination Controls */}
                                                        <div className="p-4 border-t border-white/[0.05] flex items-center justify-between bg-white/[0.01]">
                                                            <button 
                                                                type="button"
                                                                disabled={currentPage === 1}
                                                                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                                                className="text-[10px] font-black uppercase tracking-widest text-white/40 hover:text-[#7c7fff] disabled:opacity-20 transition-colors"
                                                            >
                                                                Prev
                                                            </button>
                                                            <span className="text-[10px] font-bold text-white/20 uppercase tracking-widest">
                                                                Page {currentPage} of {Math.ceil(dialogs.filter(d => d.name.toLowerCase().includes(searchTerm.toLowerCase()) || (d.username && d.username.toLowerCase().includes(searchTerm.toLowerCase()))).length / pageSize)}
                                                            </span>
                                                            <button 
                                                                type="button"
                                                                disabled={currentPage >= Math.ceil(dialogs.filter(d => d.name.toLowerCase().includes(searchTerm.toLowerCase()) || (d.username && d.username.toLowerCase().includes(searchTerm.toLowerCase()))).length / pageSize)}
                                                                onClick={() => setCurrentPage(p => p + 1)}
                                                                className="text-[10px] font-black uppercase tracking-widest text-white/40 hover:text-[#7c7fff] disabled:opacity-20 transition-colors"
                                                            >
                                                                Next
                                                            </button>
                                                        </div>
                                                    </>
                                                ) : (
                                                    <div className="flex-1 flex flex-col items-center justify-center text-center p-10">
                                                        <p className="text-xs text-white/20 font-bold uppercase tracking-widest">Select an account to load targets</p>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex justify-end gap-4 pt-8 border-t border-white/[0.05]">
                                        <button
                                            type="button"
                                            onClick={() => setIsCreating(false)}
                                            className="px-8 py-3.5 rounded-2xl text-sm font-bold text-white/40 hover:text-white hover:bg-white/5 transition-all"
                                        >
                                            Abort
                                        </button>
                                        <button
                                            type="submit"
                                            disabled={loading || selectedGroups.length === 0}
                                            className="bg-[#7c7fff] hover:bg-[#6c6fef] text-white px-10 py-3.5 rounded-2xl text-sm font-black transition-all flex items-center gap-3 shadow-xl shadow-[#7c7fff]/20 disabled:opacity-30 disabled:scale-100 active:scale-95"
                                        >
                                            {loading ? <Loader2 size={18} className="animate-spin" /> : 'Launch Underground'}
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
